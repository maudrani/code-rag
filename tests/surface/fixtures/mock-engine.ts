import type { Engine, IngestReport, Unsubscribe } from '../../../src/contracts/engine.js'
import type { Event } from '../../../src/contracts/events.js'
import type { ConsumerIntent, Projection, Turn } from '../../../src/contracts/projection.js'
import type { AnswerChunk } from '../../../src/contracts/provider.js'
import type {
  Consumer,
  EngineTelemetry,
  HealthReport,
  Observable,
  QueryLogEntry,
} from '../../../src/contracts/telemetry.js'
import {
  type L5CostPayload,
  makeAnswerStream,
  makeL5CostEvent,
  makeQueryEventSequence,
} from './events.js'
import { makeAnswerProjection } from './projections.js'

/** A deterministic, fully-populated holding snapshot — fixed values so telemetry() is stable. */
export const MOCK_TELEMETRY: EngineTelemetry = {
  ingest: {
    filesWalked: 3,
    filesIndexed: 3,
    skipped: 0,
    chunks: 7,
    byLang: { ts: 7 },
    errors: [],
    durationMs: 2,
  },
  chunk: { count: 7, byKind: { function: 5, class: 2 }, byLang: { ts: 7 }, glueFallbacks: 0 },
  index: { docs: 7, sizeBytes: null, builtAt: 1000, staleMs: 0 },
  lastQuery: {
    retrieve: {
      ts: 2000,
      queryId: 'q1',
      consumer: 'mcp',
      query: 'where is foo',
      resultCount: 1,
      scoresByLeg: { bm25: 0.7, dense: 0, structural: 0.1 },
      band: 'answer',
      latencyMs: 9,
    },
    answer: {
      band: 'answer',
      tier: 'cheap',
      model: 'claude-haiku-4-5',
      tokens: 150,
      estCost: 0.0004,
    },
  },
}

export const MOCK_HEALTH: HealthReport = {
  status: 'ok',
  checks: { indexed: { ok: true }, provider: { ok: false, detail: 'no api key' } },
  ts: 1000,
}

export interface MockEngineConfig {
  /** the Projection query() returns (default: a band='answer' projection). */
  projection?: Projection
  /** token chunks answer() streams before the usage record. */
  tokens?: readonly string[]
  /** the usage record answer() ends with. */
  usage?: { inputTokens: number; outputTokens: number }
  /** the L5 cost payload emitted on usage (estCost source for the wire — G3). */
  cost?: L5CostPayload
  /** Observable.telemetry() output (default: MOCK_TELEMETRY — fixed, deterministic). */
  telemetry?: EngineTelemetry
  /** Observable.health() output (default: MOCK_HEALTH). */
  health?: HealthReport
  /** Observable.queryLog() source (default: MOCK_TELEMETRY.lastQuery.retrieve, else []). */
  queryLog?: QueryLogEntry[]
  /** Observable.replay(queryId) — the buffered events for the ws-trace replay (default: []). */
  replay?: (queryId: string) => Event[]
}

/**
 * makeMockEngine — an in-memory Engine (src/contracts/engine.ts) for surface tests.
 * The real membrane (createEngine) lands at master integration; this unblocks
 * surface in parallel (charter). It mirrors the real event flow:
 *   - query() emits the L0..membrane sequence, then returns the Projection
 *   - answer() streams token chunks, then on `usage` emits the L5 cost event
 *     (so /query can read estCost from the bus — G3) and yields the usage chunk
 *
 * D1: `on` is a local Set<handler>, NOT src/bus — a fixture must not depend on
 *     the SUT (TKT-402 owns + tests the real bus).
 * D4: answer() yields nothing when decision.band !== 'answer' (contract).
 */
export function makeMockEngine(config: MockEngineConfig = {}): Engine & Observable {
  const projection = config.projection ?? makeAnswerProjection()
  const tokens = config.tokens ?? ['foo ', 'lives ', 'in ', 'src/foo.ts']
  const usage = config.usage ?? { inputTokens: 120, outputTokens: 30 }
  const cost: L5CostPayload = config.cost ?? { tokens: 150, tier: 'cheap', estCost: 0.0004 }
  const telemetry = config.telemetry ?? MOCK_TELEMETRY
  const health = config.health ?? MOCK_HEALTH
  const ledger = config.queryLog ?? (telemetry.lastQuery ? [telemetry.lastQuery.retrieve] : [])

  const handlers = new Set<(event: Event) => void>()
  const emit = (event: Event): void => {
    // snapshot so a handler unsubscribing mid-emit can't corrupt iteration
    for (const handler of [...handlers]) handler(event)
  }

  return {
    async ingest(_repoPath: string): Promise<IngestReport> {
      return { filesIndexed: 1, chunks: 1, durationMs: 0 }
    },

    async query(question: string, _history: Turn[], _intent: ConsumerIntent): Promise<Projection> {
      const result: Projection = { ...projection, question, resolvedQuery: question }
      for (const event of makeQueryEventSequence(result.queryId)) emit(event)
      return result
    },

    async *answer(proj: Projection, _history: Turn[]): AsyncIterable<AnswerChunk> {
      // D4: the contract streams an answer only when the gate decided to answer.
      if (proj.decision.band !== 'answer') return
      for await (const chunk of makeAnswerStream(tokens, usage)) {
        // D2/D3: the membrane emits the L5 cost event on usage; estCost lives there.
        if (chunk.type === 'usage') emit(makeL5CostEvent(proj.queryId, cost))
        yield chunk
      }
    },

    on(handler: (event: Event) => void): Unsubscribe {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },

    // ─── Observable (telemetry.ts §5.2) — fixed, deterministic output for parity tests ───
    telemetry: () => telemetry,
    health: () => health,
    replay: (queryId: string): Event[] => (config.replay ? config.replay(queryId) : []),
    queryLog(opts?: { consumer?: Consumer; limit?: number }): QueryLogEntry[] {
      let entries = [...ledger]
      if (opts?.consumer !== undefined)
        entries = entries.filter((e) => e.consumer === opts.consumer)
      if (opts?.limit !== undefined) entries = entries.slice(0, opts.limit)
      return entries
    },
  }
}
