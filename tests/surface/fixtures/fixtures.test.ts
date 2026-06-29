import { describe, expect, it } from 'vitest'
import type { Event } from '../../../src/contracts/events.js'
import type { AnswerChunk } from '../../../src/contracts/provider.js'
import { makeMockEngine } from './mock-engine.js'
import { makeRefuseProjection } from './projections.js'

// Smoke test for the shared fixture (TKT-401): it proves the mock conforms to the
// Engine contract + the event/answer flow surface's HTTP tests rely on. Behavior,
// not implementation (skill: tdd-vitest-typescript).
describe('mock Engine fixture', () => {
  it('query() returns a Projection and emits the L0..membrane event sequence', async () => {
    const engine = makeMockEngine()
    const events: Event[] = []
    engine.on((e) => events.push(e))

    const projection = await engine.query('where is foo?', [], 'http')

    expect(projection.question).toBe('where is foo?')
    expect(projection.resolvedQuery).toBe('where is foo?')
    expect(projection.decision.band).toBe('answer')
    expect(events.map((e) => e.layer)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'membrane'])
    expect(events.every((e) => typeof e.ts === 'number')).toBe(true)
  })

  it('answer() streams token chunks then a final usage record (band=answer)', async () => {
    const engine = makeMockEngine()
    const projection = await engine.query('q', [], 'http')
    const chunks: AnswerChunk[] = []
    for await (const chunk of engine.answer(projection, [])) chunks.push(chunk)

    expect(chunks.slice(0, -1).every((c) => c.type === 'token')).toBe(true)
    const last = chunks.at(-1)
    expect(last?.type).toBe('usage')
    if (last?.type === 'usage') {
      expect(last.inputTokens).toBeGreaterThan(0)
      expect(last.outputTokens).toBeGreaterThan(0)
    }
  })

  it('answer() emits the L5 cost event — the estCost source for the wire (G3)', async () => {
    const engine = makeMockEngine()
    const projection = await engine.query('q', [], 'http')
    const events: Event[] = []
    engine.on((e) => events.push(e))
    const drained: AnswerChunk[] = []
    for await (const chunk of engine.answer(projection, [])) drained.push(chunk)

    const l5 = events.find((e) => e.layer === 'L5')
    expect(l5).toBeDefined()
    expect(l5?.payload).toMatchObject({ tier: 'cheap', estCost: expect.any(Number) })
  })

  it('answer() yields NOTHING on band=refuse — negative: no tokens, no cost event', async () => {
    const engine = makeMockEngine({ projection: makeRefuseProjection() })
    const projection = await engine.query('q', [], 'http')
    const events: Event[] = []
    engine.on((e) => events.push(e))
    const chunks: AnswerChunk[] = []
    for await (const chunk of engine.answer(projection, [])) chunks.push(chunk)

    expect(chunks).toHaveLength(0)
    expect(events.some((e) => e.layer === 'L5')).toBe(false)
  })

  it('on() returns an Unsubscribe that stops delivery', async () => {
    const engine = makeMockEngine()
    const events: Event[] = []
    const unsub = engine.on((e) => events.push(e))
    unsub()
    await engine.query('q', [], 'http')

    expect(events).toHaveLength(0)
  })
})
