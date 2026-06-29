import type { Event, EventLayer } from '../../../src/contracts/events.js'
import type { AnswerChunk } from '../../../src/contracts/provider.js'

/** Build a single Event with sane defaults. Deterministic ts/ids — no Date.now (D5). */
export function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    queryId: 'q-test',
    layer: 'membrane',
    type: 'test.event',
    payload: { note: 'fixture' },
    ts: 1,
    ...overrides,
  }
}

/** The L5 cost-event payload (ADR-006): refs + counts, never blobs. */
export interface L5CostPayload {
  tokens: number
  tier: 'cheap' | 'strong'
  estCost: number
}

/**
 * The L5 cost event the membrane emits on the `usage` AnswerChunk. The HTTP
 * /query handler reads estCost from HERE (G3) — `done` "mirrors the L5 event".
 */
export function makeL5CostEvent(queryId: string, payload: L5CostPayload): Event {
  return { queryId, layer: 'L5', type: 'answer.usage', payload, ts: 6 }
}

/** Ordered per-layer sequence a query produces (L0..membrane); L5 comes from answer(). */
export function makeQueryEventSequence(queryId: string): Event[] {
  const layers: EventLayer[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'membrane']
  return layers.map((layer, i) => ({
    queryId,
    layer,
    type: `${layer}.done`,
    payload: { step: i },
    ts: i + 1,
  }))
}

/** An AnswerChunk stream: N token chunks, then the final usage record (ADR-005 seam 2). */
export async function* makeAnswerStream(
  tokens: readonly string[],
  usage: { inputTokens: number; outputTokens: number },
): AsyncGenerator<AnswerChunk> {
  for (const text of tokens) {
    yield { type: 'token', text }
  }
  yield { type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
}
