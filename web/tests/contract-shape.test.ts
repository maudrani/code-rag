import { describe, expect, it } from 'vitest'
// Type-only bridge to the master-owned wire contract (ADR-008). If the @web/@contracts
// aliases or the bridge re-export break, `tsc --noEmit` fails here — proving the bridge
// is load-bearing (TKT-501 D6). At runtime these type imports are elided.
import type { QuerySseEvent, WireProjection } from '../src/contract'

describe('wire contract bridge (ADR-008)', () => {
  it('builds a WireProjection from the contract types', () => {
    const projection: WireProjection = {
      queryId: 'q1',
      question: 'where is the score gate?',
      resolvedQuery: 'where is the score gate?',
      results: [],
      citations: [],
      decision: { groundingScore: 0.91, band: 'answer', tier: 'cheap', model: 'mock' },
    }
    expect(projection.queryId).toBe('q1')
    expect(projection.decision.band).toBe('answer')
    expect(projection.decision.tier).toBe('cheap')
  })

  it('discriminates each QuerySseEvent variant by its `event` tag', () => {
    const meta: QuerySseEvent = {
      event: 'meta',
      data: {
        queryId: 'q1',
        question: 'q',
        resolvedQuery: 'q',
        results: [],
        citations: [],
        decision: { groundingScore: 1, band: 'answer', tier: 'strong', model: 'mock' },
      },
    }
    const token: QuerySseEvent = { event: 'token', data: { text: 'hello' } }
    const done: QuerySseEvent = { event: 'done', data: { tokensTotal: 1, estCost: 0.001 } }
    const stream: QuerySseEvent[] = [meta, token, done]

    expect(stream.map((e) => e.event)).toEqual(['meta', 'token', 'done'])
  })

  it('models a refuse stream as meta + done with no token (ADR-008)', () => {
    const meta: QuerySseEvent = {
      event: 'meta',
      data: {
        queryId: 'q2',
        question: 'unanswerable',
        resolvedQuery: 'unanswerable',
        results: [],
        citations: [],
        decision: { groundingScore: 0.12, band: 'refuse', tier: 'cheap', model: 'mock' },
      },
    }
    const done: QuerySseEvent = { event: 'done', data: { tokensTotal: 0, estCost: 0 } }
    const refuseStream: QuerySseEvent[] = [meta, done]

    expect(refuseStream.some((e) => e.event === 'token')).toBe(false)
  })
})
