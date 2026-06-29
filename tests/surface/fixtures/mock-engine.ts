import type { Engine, IngestReport, Unsubscribe } from '../../../src/contracts/engine.js'
import type { Event } from '../../../src/contracts/events.js'
import type { ConsumerIntent, Projection, Turn } from '../../../src/contracts/projection.js'
import type { AnswerChunk } from '../../../src/contracts/provider.js'
import {
  type L5CostPayload,
  makeAnswerStream,
  makeL5CostEvent,
  makeQueryEventSequence,
} from './events.js'
import { makeAnswerProjection } from './projections.js'

export interface MockEngineConfig {
  /** the Projection query() returns (default: a band='answer' projection). */
  projection?: Projection
  /** token chunks answer() streams before the usage record. */
  tokens?: readonly string[]
  /** the usage record answer() ends with. */
  usage?: { inputTokens: number; outputTokens: number }
  /** the L5 cost payload emitted on usage (estCost source for the wire — G3). */
  cost?: L5CostPayload
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
export function makeMockEngine(config: MockEngineConfig = {}): Engine {
  const projection = config.projection ?? makeAnswerProjection()
  const tokens = config.tokens ?? ['foo ', 'lives ', 'in ', 'src/foo.ts']
  const usage = config.usage ?? { inputTokens: 120, outputTokens: 30 }
  const cost: L5CostPayload = config.cost ?? { tokens: 150, tier: 'cheap', estCost: 0.0004 }

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
  }
}
