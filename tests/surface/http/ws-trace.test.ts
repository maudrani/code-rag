import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createBus } from '../../../src/bus/index.js'
import type { Event } from '../../../src/contracts/events.js'
import { forwardTrace, traceRoute } from '../../../src/http/routes/ws-trace.js'
import { makeL5CostEvent } from '../fixtures/events.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'

function emitInput(overrides: Partial<Omit<Event, 'ts'>> = {}): Omit<Event, 'ts'> {
  return { queryId: 'q', layer: 'membrane', type: 'x', payload: {}, ...overrides }
}

describe('GET /ws/trace — TKT-406', () => {
  it('forwardTrace forwards each event VERBATIM (as JSON) to the sink', () => {
    const bus = createBus({ now: () => 7 })
    const received: Event[] = []
    forwardTrace((h) => bus.on(h), { send: (d) => received.push(JSON.parse(d) as Event) })

    bus.emit(
      emitInput({ queryId: 'q1', layer: 'L3', type: 'L3.done', payload: { ids: ['a', 'b'] } }),
    )

    expect(received).toHaveLength(1)
    // verbatim: every field as the bus delivered it, payload included, no enrichment
    expect(received[0]).toEqual({
      queryId: 'q1',
      layer: 'L3',
      type: 'L3.done',
      payload: { ids: ['a', 'b'] },
      ts: 7,
    })
  })

  it('NO-LEAK: after unsubscribe, no further events are forwarded (close semantics)', () => {
    const bus = createBus()
    const received: Event[] = []
    const unsub = forwardTrace((h) => bus.on(h), {
      send: (d) => received.push(JSON.parse(d) as Event),
    })

    bus.emit(emitInput({ type: 'a' }))
    unsub()
    bus.emit(emitInput({ type: 'b' }))

    expect(received.map((e) => e.type)).toEqual(['a'])
  })

  it('M1 contract: server forwards ALL events; the client filters by queryId', () => {
    const bus = createBus()
    const received: Event[] = []
    forwardTrace((h) => bus.on(h), { send: (d) => received.push(JSON.parse(d) as Event) })

    bus.emit(emitInput({ queryId: 'q-A', type: 'a' }))
    bus.emit(emitInput({ queryId: 'q-B', type: 'b' }))
    bus.emit(emitInput({ queryId: 'q-A', type: 'c' }))

    expect(received).toHaveLength(3) // single-consumer: everything is streamed
    const forA = received.filter((e) => e.queryId === 'q-A') // client-side filter
    expect(forA.map((e) => e.type)).toEqual(['a', 'c'])
  })

  it('an engine run delivers L0..membrane + the verbatim L5 cost event', async () => {
    const cost = { tokens: 150, tier: 'cheap', estCost: 0.0004 } as const
    const engine = makeMockEngine({ cost })
    const received: Event[] = []
    forwardTrace((h) => engine.on(h), { send: (d) => received.push(JSON.parse(d) as Event) })

    const proj = await engine.query('where is foo?', [], 'http')
    for await (const _chunk of engine.answer(proj, [])) {
      // drain — usage triggers the L5 cost event on the bus
    }

    expect(received.length).toBeGreaterThanOrEqual(7) // 6 query layers + L5
    const l5 = received.find((e) => e.layer === 'L5')
    expect(l5).toEqual(makeL5CostEvent(proj.queryId, cost))
  })

  it('real round-trip: a connected ws client receives the Event stream (@hono/node-ws)', async () => {
    const engine = makeMockEngine()
    const app = new Hono()
    const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app })
    app.get('/ws/trace', traceRoute(engine, upgradeWebSocket))
    const server = serve({ fetch: app.fetch, port: 0 })
    injectWebSocket(server)

    try {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      expect(port).toBeGreaterThan(0)

      const received: Event[] = []
      await new Promise<void>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${port}/ws/trace`)
        const timer = setTimeout(
          () => reject(new Error('timeout waiting for L5 trace event')),
          3000,
        )
        client.on('open', () => {
          void (async () => {
            const proj = await engine.query('q', [], 'http')
            for await (const _chunk of engine.answer(proj, [])) {
              // drain
            }
          })()
        })
        client.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
          received.push(JSON.parse(data.toString()) as Event)
          if (received.some((e) => e.layer === 'L5')) {
            clearTimeout(timer)
            client.close()
            resolve()
          }
        })
        client.on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
      })

      expect(received.length).toBeGreaterThanOrEqual(7)
      expect(received.some((e) => e.layer === 'L5')).toBe(true)
    } finally {
      server.close()
    }
  })
})
