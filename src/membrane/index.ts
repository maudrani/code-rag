import { estimateCost } from '../answer/cost.js'
import { scoreGate } from '../answer/score-gate.js'
import { createBus } from '../bus/index.js'
import { ingestAndChunk, initParser } from '../chunk/index.js'
import type {
  AnswerChunk,
  ConsumerIntent,
  CreateEngine,
  Engine,
  EngineConfig,
  Event,
  IngestReport,
  Projection,
  Provider,
  Turn,
  Unsubscribe,
} from '../contracts/index.js'
import { Bm25Index } from '../index/bm25.js'
import { createClaudeProvider } from '../provider/claude.js'
import { type RetrieveDeps, retrieve } from '../retrieve/retrieve.js'
import { buildStructuralIndex } from '../retrieve/structural.js'
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

export const createEngine: CreateEngine = (config: EngineConfig = {}): Engine => {
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
  let bm25Handle: Bm25Index | null = null
  let ingestStats = { filesIndexed: 0, chunks: 0 }
  let queryCounter = 0

  async function ingest(repoPath: string = corpusPath): Promise<IngestReport> {
    const started = Date.now()
    await initParser() // async tree-sitter init — required before chunking
    const { chunks, files } = ingestAndChunk(repoPath)
    bm25Handle?.close() // release the previous SQLite handle on re-ingest
    const bm25 = new Bm25Index()
    bm25.index(chunks)
    bm25Handle = bm25
    deps = {
      bm25,
      structural: buildStructuralIndex(chunks),
      chunks: new Map(chunks.map((c) => [c.id, c])),
    }
    ingestStats = { filesIndexed: files.length, chunks: chunks.length }
    return { ...ingestStats, durationMs: Date.now() - started }
  }

  async function query(
    question: string,
    history: Turn[],
    _intent: ConsumerIntent,
  ): Promise<Projection> {
    if (!deps) throw new Error('membrane: ingest() must run before query()')
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
    const results = await retrieve(resolvedQuery, deps, { k: TOP_K })
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
    return projection
  }

  async function* answer(projection: Projection, history: Turn[]): AsyncIterable<AnswerChunk> {
    // Refuse short-circuit: the provider throws on band==='refuse', so never call it.
    if (projection.decision.band === 'refuse') return
    const { tier } = projection.decision
    for await (const chunk of getProvider().answer(projection.question, projection, history)) {
      if (chunk.type === 'usage') {
        const estCost = estimateCost(
          { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens },
          tier,
        )
        // L5 — the only probabilistic layer; the cost is the membrane's to compute + emit.
        bus.emit({
          queryId: projection.queryId,
          layer: 'L5',
          type: 'answer.usage',
          payload: { tokens: chunk.inputTokens + chunk.outputTokens, tier, estCost },
        })
      }
      yield chunk
    }
  }

  function on(handler: (event: Event) => void): Unsubscribe {
    return bus.on(handler)
  }

  return { ingest, query, answer, on }
}
