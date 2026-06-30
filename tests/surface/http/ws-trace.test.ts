import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createBus } from '../../../src/bus/index.js'
import type { Event } from '../../../src/contracts/events.js'
import { forwardTrace, forwardTraceReplay, traceRoute } from '../../../src/http/routes/ws-trace.js'
import { makeL5CostEvent } from '../fixtures/events.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'

function emitInput(overrides: Partial<Omit<Event, 'ts'>> = {}): Omit<Event, 'ts'> {
  return { queryId: 'q', layer: 'membrane', type: 'x', payload: {}, ...overrides }
}

/** A full pre-query backlog (L0–L4) for a queryId — what the membrane ring buffer holds. */
function backlogFor(queryId: string): Event[] {
  return ['L0', 'L1', 'L2', 'L3', 'L4'].map((layer) => ({
    queryId,
    layer: layer as Event['layer'],
    type: `${layer}.x`,
    payload: {},
    ts: 0,
  }))
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

  // ─── replay: the late-subscriber fix (TKT-422 / design §4) ──────────────────
  describe('forwardTraceReplay — drain the backlog, then tail live (race-free)', () => {
    it('a LATE subscriber receives the buffered L0–L4, THEN live events, once each in order', () => {
      const live: { handler: ((e: Event) => void) | null } = { handler: null }
      const subscribe = (h: (e: Event) => void) => {
        live.handler = h
        return () => {
          live.handler = null
        }
      }
      const received: Event[] = []
      forwardTraceReplay(subscribe, backlogFor, 'q1', {
        send: (d) => received.push(JSON.parse(d) as Event),
      })

      // the backlog (L0–L4) is drained on subscribe — the events the old code MISSED
      expect(received.map((e) => e.layer)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4'])

      // then a live L5 (the answer) tails after
      live.handler?.({ queryId: 'q1', layer: 'L5', type: 'answer.usage', payload: {}, ts: 0 })
      expect(received.map((e) => e.layer)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5'])
    })

    it('NON-VACUITY: WITHOUT replay (plain forwardTrace), a late subscriber MISSES L0–L4', () => {
      // the backlog already fired before this subscriber connects; forwardTrace cannot replay it.
      const live: { handler: ((e: Event) => void) | null } = { handler: null }
      const subscribe = (h: (e: Event) => void) => {
        live.handler = h
        return () => {}
      }
      const received: Event[] = []
      forwardTrace(subscribe, { send: (d) => received.push(JSON.parse(d) as Event) })

      // nothing replayed — the L0–L4 backlog is lost (exactly the bug being fixed)
      expect(received).toHaveLength(0)
      live.handler?.({ queryId: 'q1', layer: 'L5', type: 'answer.usage', payload: {}, ts: 0 })
      expect(received.map((e) => e.layer)).toEqual(['L5']) // only the live tail — L0–L4 gone
    })

    it('DEDUP: an event in BOTH the backlog and the subscribe→drain window is sent once', () => {
      const dup: Event = { queryId: 'q1', layer: 'L4', type: 'retrieve', payload: {}, ts: 0 }
      // this fake delivers `dup` live the instant we subscribe (it lands in `pending`)…
      const subscribe = (h: (e: Event) => void) => {
        h(dup)
        return () => {}
      }
      // …and the backlog ALSO contains the same (queryId, layer, type).
      const received: Event[] = []
      forwardTraceReplay(subscribe, () => [dup], 'q1', {
        send: (d) => received.push(JSON.parse(d) as Event),
      })
      expect(received.filter((e) => e.layer === 'L4')).toHaveLength(1) // key-dedup, not double-sent
    })

    it('FILTER: a live event for a different queryId is ignored', () => {
      const live: { handler: ((e: Event) => void) | null } = { handler: null }
      const subscribe = (h: (e: Event) => void) => {
        live.handler = h
        return () => {}
      }
      const received: Event[] = []
      forwardTraceReplay(subscribe, () => [], 'q1', {
        send: (d) => received.push(JSON.parse(d) as Event),
      })
      live.handler?.({ queryId: 'q2', layer: 'L5', type: 'x', payload: {}, ts: 0 })
      expect(received).toHaveLength(0)
    })
  })

  it('real round-trip with ?queryId: a late ws client receives the replayed backlog', async () => {
    const backlog = backlogFor('qX')
    const engine = makeMockEngine({ replay: (qid) => (qid === 'qX' ? backlog : []) })
    const app = new Hono()
    const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app })
    app.get('/ws/trace', traceRoute(engine, upgradeWebSocket))
    const server = serve({ fetch: app.fetch, port: 0 })
    injectWebSocket(server)

    try {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      const received: Event[] = []
      await new Promise<void>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${port}/ws/trace?queryId=qX`)
        const timer = setTimeout(
          () => reject(new Error('timeout waiting for replay backlog')),
          3000,
        )
        client.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
          received.push(JSON.parse(data.toString()) as Event)
          if (received.length >= backlog.length) {
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
      expect(received.map((e) => e.layer)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4'])
    } finally {
      server.close()
    }
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
