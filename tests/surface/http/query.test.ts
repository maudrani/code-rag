import { describe, expect, it } from 'vitest'
import type { Engine } from '../../../src/contracts/engine.js'
import type { WireProjection } from '../../../src/contracts/wire.js'
import { queryRoutes } from '../../../src/http/routes/query.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'
import { makeRefuseProjection } from '../fixtures/projections.js'

/** Parse a raw SSE body into ordered { event, data } records (order-independent of field order). */
interface SseRecord {
  event: string
  data: string
}
function parseSse(raw: string): SseRecord[] {
  const records: SseRecord[] = []
  for (const block of raw.split('\n\n')) {
    if (!block.trim()) continue
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim())
    }
    records.push({ event, data: dataLines.join('\n') })
  }
  return records
}

async function postQuery(engine: Engine, question: string): Promise<SseRecord[]> {
  const app = queryRoutes(engine)
  const res = await app.request('/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, history: [] }),
  })
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/event-stream')
  return parseSse(await res.text())
}

describe('POST /query (SSE) — TKT-404', () => {
  it('answer path: streams meta -> token(>=1) -> done, in order', async () => {
    const records = await postQuery(makeMockEngine(), 'where is foo?')
    const order = records.map((r) => r.event)

    expect(order[0]).toBe('meta')
    expect(order.at(-1)).toBe('done')
    expect(order.filter((e) => e === 'token').length).toBeGreaterThanOrEqual(1)
    // meta strictly precedes every token; done strictly follows every token.
    expect(order.indexOf('meta')).toBeLessThan(order.indexOf('token'))
    expect(order.lastIndexOf('token')).toBeLessThan(order.indexOf('done'))
  })

  it('meta carries the WireProjection (decision + citations), and is queryId-joined', async () => {
    const records = await postQuery(makeMockEngine(), 'where is foo?')
    const meta = records.find((r) => r.event === 'meta')
    expect(meta).toBeDefined()
    const wire = JSON.parse(meta?.data ?? '{}') as WireProjection
    expect(wire.queryId).toBeTruthy()
    expect(wire.decision.band).toBe('answer')
    expect(wire.citations.length).toBeGreaterThan(0)
    expect(wire.resolvedQuery).toBe('where is foo?')
  })

  it('NEGATIVE: meta must NOT include context.assembled (ADR-008 strips it)', async () => {
    const records = await postQuery(makeMockEngine(), 'where is foo?')
    const meta = records.find((r) => r.event === 'meta')
    const wire = JSON.parse(meta?.data ?? '{}') as Record<string, unknown>
    expect('context' in wire).toBe(false)
  })

  it('token events carry the streamed text, in order', async () => {
    const tokens = ['alpha ', 'beta ', 'gamma']
    const records = await postQuery(makeMockEngine({ tokens }), 'q')
    const texts = records
      .filter((r) => r.event === 'token')
      .map((r) => (JSON.parse(r.data) as { text: string }).text)
    expect(texts).toEqual(tokens)
  })

  it('done.tokensTotal = inputTokens + outputTokens (from the usage chunk)', async () => {
    const records = await postQuery(
      makeMockEngine({ usage: { inputTokens: 200, outputTokens: 55 } }),
      'q',
    )
    const done = records.find((r) => r.event === 'done')
    const payload = JSON.parse(done?.data ?? '{}') as { tokensTotal: number; estCost: number }
    expect(payload.tokensTotal).toBe(255)
  })

  it('G3: done.estCost comes from the L5 cost EVENT, not the usage chunk', async () => {
    // distinct estCost in the L5 event vs a token-count that could be mistaken for it
    const records = await postQuery(
      makeMockEngine({
        usage: { inputTokens: 100, outputTokens: 100 },
        cost: { tokens: 200, tier: 'strong', estCost: 0.0123 },
      }),
      'q',
    )
    const done = records.find((r) => r.event === 'done')
    const payload = JSON.parse(done?.data ?? '{}') as { tokensTotal: number; estCost: number }
    expect(payload.estCost).toBe(0.0123) // sourced from the L5 event (engine.on by queryId)
    expect(payload.tokensTotal).toBe(200) // sourced from the usage chunk
  })

  it('refuse path: emits meta -> done with ZERO token events', async () => {
    const records = await postQuery(
      makeMockEngine({ projection: makeRefuseProjection() }),
      'unanswerable',
    )
    const order = records.map((r) => r.event)
    expect(order).toEqual(['meta', 'done'])
    expect(order).not.toContain('token')

    const meta = records.find((r) => r.event === 'meta')
    const wire = JSON.parse(meta?.data ?? '{}') as WireProjection
    expect(wire.decision.band).toBe('refuse')
  })

  it('refuse path: done carries zero usage (no tokens billed)', async () => {
    const records = await postQuery(
      makeMockEngine({ projection: makeRefuseProjection() }),
      'unanswerable',
    )
    const done = records.find((r) => r.event === 'done')
    const payload = JSON.parse(done?.data ?? '{}') as { tokensTotal: number; estCost: number }
    expect(payload.tokensTotal).toBe(0)
    expect(payload.estCost).toBe(0)
  })

  it('EDGE: answer() throwing mid-stream closes the SSE gracefully (terminal done, no hang)', async () => {
    const base = makeMockEngine()
    const engine: Engine = {
      ...base,
      // eslint-disable-next-line require-yield
      async *answer() {
        yield { type: 'token', text: 'partial ' }
        throw new Error('llm exploded')
      },
    }
    const records = await postQuery(engine, 'q')
    const order = records.map((r) => r.event)
    expect(order[0]).toBe('meta')
    expect(order).toContain('token')
    expect(order.at(-1)).toBe('done') // graceful terminal frame, stream resolved
  })

  it('NO-LEAK: the L5 listener is unsubscribed after the stream completes', async () => {
    const base = makeMockEngine()
    let active = 0
    const engine: Engine = {
      ...base,
      on(handler) {
        active++
        const unsub = base.on(handler)
        return () => {
          active--
          unsub()
        }
      },
    }
    await postQuery(engine, 'q')
    expect(active).toBe(0)
  })
})
