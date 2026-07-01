import { scoreGate } from '../answer/score-gate.js'
import { buildAnswerTelemetry } from '../answer/telemetry.js'
import { createBus } from '../bus/index.js'
import {
  collectChunkTelemetry,
  collectIngestTelemetry,
  ingestAndChunk,
  initParser,
} from '../chunk/index.js'
import type {
  AnswerChunk,
  AnswerTelemetry,
  ChunkTelemetry,
  Consumer,
  ConsumerIntent,
  CreateEngine,
  Engine,
  EngineConfig,
  EngineTelemetry,
  Event,
  HealthReport,
  IndexTelemetry,
  IngestReport,
  IngestTelemetry,
  Observable,
  Projection,
  Provider,
  QueryLogEntry,
  Turn,
  Unsubscribe,
} from '../contracts/index.js'
import { buildIndexedStore } from '../index/build.js'
import { createOnnxEmbedder, type Embedder } from '../index/embed.js'
import type { SqliteStore } from '../index/store.js'
import { createClaudeProvider } from '../provider/claude.js'
import { type RetrieveDeps, retrieve } from '../retrieve/retrieve.js'
import { topScoresByLeg } from '../retrieve/telemetry.js'
import { project } from './project.js'
import { needsRewrite } from './resolve.js'

/**
 * The membrane — master-owned seam (ADR-002). It is the stateful holder that composes
 * the pure specialist layers behind the Projection contract and owns the cross-cutting
 * concerns no single layer can: building + holding the retrieval index, assembling
 * citations + context, the deterministic L0 gate, the event bus, the queryId, and the
 * L5 cost. Only L5 (answer) is probabilistic; everything up to it is exact.
 */

const DEFAULT_CORPUS = '.'
const TOP_K = 10

/** Events buffered per queryId before the oldest is evicted (the replay backlog cap). */
const REPLAY_CAP = 50

export const createEngine: CreateEngine = (config: EngineConfig = {}): Engine & Observable => {
  const bus = createBus()
  const corpusPath = config.corpusPath ?? DEFAULT_CORPUS

  // Lazy provider: a standalone `query` (no rewrite) needs no API key (seam K) — the
  // client is only constructed when the LLM residue or `answer` is actually used.
  let providerInstance: Provider | null = null
  const getProvider = (): Provider => {
    providerInstance ??= createClaudeProvider(config.apiKey)
    return providerInstance
  }

  // Index state — built at ingest, held for every query. The membrane is the holder.
  let deps: RetrieveDeps | null = null
  let storeHandle: SqliteStore | null = null
  let embedderHandle: Embedder | null = null
  let ingestStats = { filesIndexed: 0, chunks: 0 }
  let indexing: Promise<IngestReport> | null = null
  let queryCounter = 0

  // ─── observability state (master-owned seam; telemetry.ts) ────────────────────────────
  // The holding (non-per-query) telemetry, the per-query ledger, and the last L5 telemetry.
  let ingestTelemetry: IngestTelemetry | null = null
  let chunkTelemetry: ChunkTelemetry | null = null
  let indexBuiltAt: number | null = null
  const ledger: QueryLogEntry[] = []
  let lastAnswer: { queryId: string; telemetry: AnswerTelemetry } | null = null

  // Ring buffer of events per queryId. The membrane subscribes to its OWN bus at construction,
  // so every event is captured from L0 onward; a client that subscribes LATE (after L0–L4 have
  // already fired) calls replay(queryId) to drain this backlog, then on() to tail live. THIS is
  // the fix for the trace late-subscriber race (telemetry.ts §4).
  const replayBuffer = new Map<string, Event[]>()
  bus.on((event) => {
    let buf = replayBuffer.get(event.queryId)
    if (buf === undefined) {
      buf = []
      replayBuffer.set(event.queryId, buf)
      // Map preserves insertion order: evict the oldest queryId once past the cap.
      if (replayBuffer.size > REPLAY_CAP) {
        const oldest = replayBuffer.keys().next().value
        if (oldest !== undefined) replayBuffer.delete(oldest)
      }
    }
    buf.push(event)
  })

  async function ingest(repoPath: string = corpusPath): Promise<IngestReport> {
    const started = Date.now()
    await initParser() // async tree-sitter init — required before chunking
    const { chunks, files } = ingestAndChunk(repoPath)
    storeHandle?.close() // release the previous store handle on re-ingest
    await embedderHandle?.dispose?.() // release the previous ONNX pipeline (adopt B2/FTR-038)
    // Dense ON for a live process (recall 0.50 / exact-id 1.00), OFF under vitest (no 25MB model
    // download -> fast deterministic tests); `config.dense` overrides either way. buildIndexedStore
    // threads ONE embedder through index() + retrievalDeps() so the leg is all-or-nothing (FTR-22).
    const denseOn = config.dense ?? process.env.VITEST === undefined
    const embedder = denseOn ? createOnnxEmbedder() : undefined
    embedderHandle = embedder ?? null
    const built = await buildIndexedStore(chunks, embedder ? { embedder } : {})
    storeHandle = built.store
    deps = built.deps
    ingestStats = { filesIndexed: files.length, chunks: chunks.length }

    // Hold the per-layer telemetry the Observable surface reads, via the specialists' pure
    // collectors (FTR-12 seam, RULE-019): collectChunkTelemetry projects the emitted Chunk[] (L2),
    // collectIngestTelemetry projects the ingest result (L1). `skipped: []` for now (the walker's
    // skips are not yet threaded here); the IngestTelemetry invariant filesWalked === filesIndexed +
    // skipped + errors.length stays honest by construction inside collectIngestTelemetry.
    const durationMs = Date.now() - started
    chunkTelemetry = collectChunkTelemetry(chunks)
    ingestTelemetry = collectIngestTelemetry({
      files,
      skipped: [],
      chunkCount: chunks.length,
      durationMs,
    })
    indexBuiltAt = Date.now()
    return { ...ingestStats, durationMs }
  }

  // Lazy single-flight self-index: a consumer that queries before calling ingest() gets
  // the corpus indexed on first use (the HTTP server relies on this). Concurrent first
  // queries share one ingest; a failure clears it so the next query can retry.
  function ensureIndexed(): Promise<RetrieveDeps> {
    if (deps) return Promise.resolve(deps)
    if (!indexing) {
      indexing = ingest(corpusPath).catch((err) => {
        indexing = null
        throw err
      })
    }
    return indexing.then(() => {
      if (!deps) throw new Error('membrane: ingest produced no index')
      return deps
    })
  }

  async function query(
    question: string,
    history: Turn[],
    intent: ConsumerIntent,
  ): Promise<Projection> {
    const queryStart = Date.now()
    const ready = await ensureIndexed()
    const queryId = `q${++queryCounter}`

    // L0 — deterministic gate, then the conditional LLM rewrite residue.
    const resolvedQuery = needsRewrite(question, history)
      ? await getProvider().rewrite(question, history)
      : question
    bus.emit({
      queryId,
      layer: 'L0',
      type: 'resolve',
      payload: { rewritten: resolvedQuery !== question },
    })

    // L1–L3 restate the held index this query runs against (the compute happened at ingest).
    bus.emit({ queryId, layer: 'L1', type: 'corpus', payload: { files: ingestStats.filesIndexed } })
    bus.emit({ queryId, layer: 'L2', type: 'chunked', payload: { chunks: ingestStats.chunks } })
    bus.emit({ queryId, layer: 'L3', type: 'indexed', payload: { chunks: ingestStats.chunks } })

    // L4 — hybrid retrieval over the held legs.
    const results = await retrieve(resolvedQuery, ready, { k: TOP_K })
    bus.emit({
      queryId,
      layer: 'L4',
      type: 'retrieve',
      payload: { retrieved: results.length, topScore: results[0]?.fused ?? 0 },
    })

    // membrane — project the SSOT (gate + citations + assembled context).
    const projection = project({ queryId, question, resolvedQuery, results, scoreGate })
    bus.emit({
      queryId,
      layer: 'membrane',
      type: 'project',
      payload: {
        band: projection.decision.band,
        tier: projection.decision.tier,
        citations: projection.citations.length,
      },
    })

    // L4 ledger entry — the cross-consumer record (adopt peripheral QueryLogEntry; scoresByLeg
    // + consumer are novel here). scoresByLeg via the L4 specialist's topScoresByLeg SSOT — a
    // byte-identical swap of the prior inline spread that makes the DD-1 leg-sum invariant
    // unit-assertable (fresh copy of the TOP result's per-leg scores; all-zero if none).
    const scoresByLeg = topScoresByLeg(results)
    ledger.push({
      ts: Date.now(),
      queryId,
      consumer: intent,
      query: question,
      resultCount: results.length,
      scoresByLeg,
      band: projection.decision.band,
      latencyMs: Date.now() - queryStart,
    })

    // A refused query never reaches the provider, so answer() early-returns and would leave
    // lastQuery.answer null — making the cost-control story ("refused -> $0 spent") unobservable.
    // Record the ZERO-COST AnswerTelemetry HERE (no usage -> tokens/estCost 0) so telemetry()
    // surfaces the refuse instead of null. Keyed by queryId, identical to the answered path.
    if (projection.decision.band === 'refuse') {
      lastAnswer = { queryId, telemetry: buildAnswerTelemetry(projection.decision) }
    }
    return projection
  }

  async function* answer(projection: Projection, history: Turn[]): AsyncIterable<AnswerChunk> {
    // Refuse short-circuit: the provider throws on band==='refuse', so never call it.
    if (projection.decision.band === 'refuse') return
    const { tier } = projection.decision
    for await (const chunk of getProvider().answer(projection.question, projection, history)) {
      if (chunk.type === 'usage') {
        // L5 — the only probabilistic layer. The answer specialist's pure buildAnswerTelemetry
        // is the SSOT for the band/tier/model/tokens/estCost struct (RULE-019); the bus event
        // and the held telemetry both read it, so the cost is computed once and can never diverge.
        const telemetry = buildAnswerTelemetry(projection.decision, {
          inputTokens: chunk.inputTokens,
          outputTokens: chunk.outputTokens,
        })
        bus.emit({
          queryId: projection.queryId,
          layer: 'L5',
          type: 'answer.usage',
          payload: { tokens: telemetry.tokens, tier, estCost: telemetry.estCost },
        })
        // Hold the L5 telemetry for telemetry().lastQuery.answer — keyed by queryId so it
        // only attaches to ITS query (a later answer-less query reads null, not this).
        lastAnswer = { queryId: projection.queryId, telemetry }
      }
      yield chunk
    }
  }

  function on(handler: (event: Event) => void): Unsubscribe {
    return bus.on(handler)
  }

  // ─── Observable — the PULL read-surface every transport calls (telemetry.ts §5.2) ─────

  // The holding (non-per-query) snapshot: ingest + index struct, plus the last query.
  function telemetry(): EngineTelemetry {
    const index: IndexTelemetry | null =
      indexBuiltAt === null
        ? null
        : {
            docs: ingestStats.chunks,
            sizeBytes: null, // the live index is :memory: — no on-disk size
            builtAt: indexBuiltAt,
            staleMs: Date.now() - indexBuiltAt,
          }
    const lastEntry = ledger[ledger.length - 1]
    const lastQuery =
      lastEntry === undefined
        ? null
        : {
            retrieve: lastEntry,
            // attach the L5 telemetry ONLY when it belongs to this same query.
            answer:
              lastAnswer !== null && lastAnswer.queryId === lastEntry.queryId
                ? lastAnswer.telemetry
                : null,
          }
    // ingest + chunk are the held collectIngestTelemetry / collectChunkTelemetry outputs (L1/L2).
    return { ingest: ingestTelemetry, chunk: chunkTelemetry, index, lastQuery }
  }

  // The aggregate health surface. Status is driven by `indexed`; the provider check reports
  // whether a key is available to construct the client — we never PING the LLM (cost/latency).
  function health(): HealthReport {
    const indexed = indexBuiltAt !== null
    const providerOk = config.apiKey !== undefined || process.env.ANTHROPIC_API_KEY !== undefined
    return {
      status: indexed ? 'ok' : 'degraded',
      checks: { indexed: { ok: indexed }, provider: { ok: providerOk } },
      ts: Date.now(),
    }
  }

  // The buffered events for a queryId (the late-subscriber replay); [] if never-seen/evicted.
  function replay(queryId: string): Event[] {
    const buf = replayBuffer.get(queryId)
    return buf === undefined ? [] : [...buf] // defensive copy
  }

  // The cross-consumer ledger, newest-first; filtered by consumer, limited by limit.
  function queryLog(opts?: { consumer?: Consumer; limit?: number }): QueryLogEntry[] {
    let entries = [...ledger].reverse()
    const consumer = opts?.consumer
    if (consumer !== undefined) entries = entries.filter((e) => e.consumer === consumer)
    if (opts?.limit !== undefined) entries = entries.slice(0, opts.limit)
    return entries
  }

  return { ingest, query, answer, on, telemetry, health, replay, queryLog }
}
