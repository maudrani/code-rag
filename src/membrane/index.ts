import { scoreGate } from '../answer/score-gate.js'
import { buildAnswerTelemetry } from '../answer/telemetry.js'
import { createBus } from '../bus/index.js'
import {
  collectChunkTelemetry,
  collectIngestTelemetry,
  ingestAndChunk,
  initParser,
} from '../chunk/index.js'
import type { Chunk, SymbolEntry } from '../contracts/chunk.js'
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
import {
  createOnnxEmbedder,
  DEFAULT_EMBED_DTYPE,
  DEFAULT_EMBED_MODEL,
  type Embedder,
} from '../index/embed.js'
import { statFiles } from '../index/manifest.js'
import { type ChunkChanged, SqliteStore } from '../index/store.js'
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

/** The embedder identity persisted in the warm-restart manifest — a change forces a cold rebuild. */
const EMBED_MODEL_ID = `${DEFAULT_EMBED_MODEL}:${DEFAULT_EMBED_DTYPE}`

/** Events buffered per queryId before the oldest is evicted (the replay backlog cap). */
const REPLAY_CAP = 50

export const createEngine: CreateEngine = (config: EngineConfig = {}): Engine & Observable => {
  const bus = createBus()
  let corpusPath = config.corpusPath ?? DEFAULT_CORPUS // mutable: engine.reindex retargets it (FTR-5 P4)

  // Lazy provider: a standalone `query` (no rewrite) needs no API key (seam K) — the
  // client is only constructed when the LLM residue or `answer` is actually used.
  let providerInstance: Provider | null = null
  const getProvider = (): Provider => {
    // FTR-4 TKT-003: an injected provider (test seam) wins; else lazily build the real Claude provider.
    providerInstance ??= config.provider ?? createClaudeProvider(config.apiKey)
    return providerInstance
  }

  // Index state — built at ingest, held for every query. The membrane is the holder.
  let deps: RetrieveDeps | null = null
  let storeHandle: SqliteStore | null = null
  let embedderHandle: Embedder | null = null
  let ingestStats = { filesIndexed: 0, chunks: 0 }
  let indexing: Promise<IngestReport> | null = null
  let queryCounter = 0

  // FTR-4 TKT-004: the single time source — an injected clock (test seam) or Date.now (prod).
  const now = config.now ?? Date.now

  // ─── observability state (master-owned seam; telemetry.ts) ────────────────────────────
  // The holding (non-per-query) telemetry, the per-query ledger, and the last L5 telemetry.
  let ingestTelemetry: IngestTelemetry | null = null
  let chunkTelemetry: ChunkTelemetry | null = null
  let indexBuiltAt: number | null = null
  const ledger: QueryLogEntry[] = []
  // FTR-3 P2: the L5 outcome keyed by queryId (generalizes the old single lastAnswer slot). Joined
  // onto ledger entries at read time, so it survives past the most-recent query (append-only kept).
  const answerByQueryId = new Map<string, AnswerTelemetry>()

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
    const started = now()
    await initParser() // async tree-sitter init — required before chunking
    const { chunks, files } = ingestAndChunk(repoPath)
    storeHandle?.close() // release the previous store handle on re-ingest
    await embedderHandle?.dispose?.() // release the previous ONNX pipeline (adopt B2/FTR-038)
    // Dense is OPT-IN (config.dense / CODE_RAG_DENSE=true). The local ONNX embed runs once per chunk, so
    // a cold whole-repo embed can peg CPU + swap and FREEZE a laptop — the SAFE, zero-config default is
    // BM25 + structural (heat-free, fully offline, no ~25MB model download). Opt in for the semantic leg
    // (recall 0.50 / exact-id 1.00). buildIndexedStore threads ONE embedder through index() +
    // retrievalDeps() so the leg is all-or-nothing (FTR-22).
    const denseOn = config.dense ?? false
    const embedder = denseOn ? createOnnxEmbedder() : undefined
    embedderHandle = embedder ?? null
    if (config.indexPath) {
      // Warm-restart (FTR-57): persist at indexPath + stat-check; re-embed ONLY changed files. `files`
      // and chunk.path are the SAME root-relative form (ingestAndChunk), so the byPath lookup is exact.
      const store = new SqliteStore({ path: config.indexPath })
      const current = await statFiles(files, repoPath)
      const byPath = new Map<string, Chunk[]>()
      for (const c of chunks) {
        const arr = byPath.get(c.path)
        if (arr) arr.push(c)
        else byPath.set(c.path, [c])
      }
      const chunkChanged: ChunkChanged = (paths) => paths.flatMap((p) => byPath.get(p) ?? [])
      await store.syncIndex(current, chunkChanged, {
        modelId: EMBED_MODEL_ID,
        ...(embedder ? { embedder } : {}),
      })
      storeHandle = store
      deps = store.retrievalDeps(embedder)
    } else {
      const built = await buildIndexedStore(chunks, embedder ? { embedder } : {})
      storeHandle = built.store
      deps = built.deps
    }
    ingestStats = { filesIndexed: files.length, chunks: chunks.length }

    // Hold the per-layer telemetry the Observable surface reads, via the specialists' pure
    // collectors (FTR-12 seam, RULE-019): collectChunkTelemetry projects the emitted Chunk[] (L2),
    // collectIngestTelemetry projects the ingest result (L1). `skipped: []` for now (the walker's
    // skips are not yet threaded here); the IngestTelemetry invariant filesWalked === filesIndexed +
    // skipped + errors.length stays honest by construction inside collectIngestTelemetry.
    const durationMs = now() - started
    chunkTelemetry = collectChunkTelemetry(chunks)
    ingestTelemetry = collectIngestTelemetry({
      files,
      skipped: [],
      chunkCount: chunks.length,
      durationMs,
    })
    indexBuiltAt = now()
    return { ...ingestStats, durationMs }
  }

  // FTR-5 P4: swap the active corpus at runtime. Build the new index off to the side (buildIndexedStore,
  // in-memory), THEN install it atomically — so a failed build keeps the previous corpus (no empty-index
  // window, GAP-P4-E) and in-flight queries hit the old index until the swap. Local path only (the clone
  // is consume's). indexPath warm-restart is the initial ingest's; a reindexed corpus is in-memory (M1).
  async function reindex(newCorpusPath: string): Promise<IngestReport> {
    const started = now()
    await initParser()
    const { chunks, files } = ingestAndChunk(newCorpusPath) // throws on a bad path -> BEFORE any swap
    const denseOn = config.dense ?? false
    const embedder = denseOn ? createOnnxEmbedder() : undefined
    const built = await buildIndexedStore(chunks, embedder ? { embedder } : {})
    // ── atomic swap: install the new index, retarget the corpus, then release the old ──
    const oldStore = storeHandle
    const oldEmbedder = embedderHandle
    storeHandle = built.store
    embedderHandle = embedder ?? null
    deps = built.deps
    corpusPath = newCorpusPath
    ingestStats = { filesIndexed: files.length, chunks: chunks.length }
    const durationMs = now() - started
    chunkTelemetry = collectChunkTelemetry(chunks)
    ingestTelemetry = collectIngestTelemetry({
      files,
      skipped: [],
      chunkCount: chunks.length,
      durationMs,
    })
    indexBuiltAt = now()
    oldStore?.close() // release the previous store AFTER the swap is live
    void oldEmbedder?.dispose?.()
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
    const queryStart = now()
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
    // The distinct files this query surfaced, in rank order (a file with many chunks appears once),
    // capped so a ledger line stays small. Lets the Live feed show WHICH code a query returned without
    // re-running the search (the per-card re-query that used to pollute the ledger).
    const resultPaths = [...new Set(results.map((r) => r.chunk.path))].slice(0, 12)
    ledger.push({
      ts: now(),
      queryId,
      consumer: intent,
      query: question,
      resultCount: results.length,
      resultPaths,
      scoresByLeg,
      band: projection.decision.band,
      // FTR-3 P1: the routing decision, per query (from the gate SSOT; reused, not re-derived).
      tier: projection.decision.tier,
      model: projection.decision.model,
      latencyMs: now() - queryStart,
    })

    // A refused query never reaches the provider, so answer() early-returns and would leave
    // lastQuery.answer null — making the cost-control story ("refused -> $0 spent") unobservable.
    // Record the ZERO-COST AnswerTelemetry HERE (no usage -> tokens/estCost 0) so telemetry()
    // surfaces the refuse instead of null. Keyed by queryId, identical to the answered path.
    if (projection.decision.band === 'refuse') {
      answerByQueryId.set(queryId, buildAnswerTelemetry(projection.decision))
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
        answerByQueryId.set(projection.queryId, telemetry)
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
            staleMs: now() - indexBuiltAt,
          }
    const lastEntry = ledger[ledger.length - 1]
    const lastQuery =
      lastEntry === undefined
        ? null
        : {
            retrieve: lastEntry,
            // attach the L5 telemetry ONLY when it belongs to this same query (keyed by queryId).
            answer: answerByQueryId.get(lastEntry.queryId) ?? null,
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
      ts: now(),
    }
  }

  // The buffered events for a queryId (the late-subscriber replay); [] if never-seen/evicted.
  function replay(queryId: string): Event[] {
    const buf = replayBuffer.get(queryId)
    return buf === undefined ? [] : [...buf] // defensive copy
  }

  // FTR-3 P2: join the L5 outcome (answered/tokens/estCost) onto an entry by queryId. Read-time only
  // — the stored entry stays append-only. answered = the outcome band is 'answer' (a refuse -> false,
  // zero cost); a search-only query has no outcome entry, so the fields stay undefined.
  function withAnswerOutcome(e: QueryLogEntry): QueryLogEntry {
    const a = answerByQueryId.get(e.queryId)
    if (a === undefined) return e
    return { ...e, answered: a.band === 'answer', tokens: a.tokens, estCost: a.estCost }
  }

  // The cross-consumer ledger, newest-first; filtered by consumer, limited by limit; each entry
  // joined with its L5 outcome (FTR-3 P2).
  function queryLog(opts?: { consumer?: Consumer; limit?: number }): QueryLogEntry[] {
    let entries = [...ledger].reverse()
    const consumer = opts?.consumer
    if (consumer !== undefined) entries = entries.filter((e) => e.consumer === consumer)
    if (opts?.limit !== undefined) entries = entries.slice(0, opts.limit)
    return entries.map(withAnswerOutcome)
  }

  // The corpus symbol read-surface — ensures the index, then projects each chunk to its identity.
  async function symbols(): Promise<SymbolEntry[]> {
    const ready = await ensureIndexed()
    return [...ready.chunks.values()].map((c) => ({
      path: c.path,
      symbol: c.symbol,
      kind: c.kind,
      lang: c.lang,
      span: c.span,
    }))
  }

  return { ingest, reindex, query, answer, on, telemetry, health, replay, queryLog, symbols }
}
