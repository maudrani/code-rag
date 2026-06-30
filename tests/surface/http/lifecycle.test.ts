import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { Engine } from '../../../src/contracts/engine.js'
import { traceRoute } from '../../../src/http/routes/ws-trace.js'
import { makeShutdownHandler } from '../../../src/http/server.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'

describe('WS-trace transport lifecycle — TKT-416', () => {
  it('closing the ws client releases the server-side engine subscription (no leak)', async () => {
    const base = makeMockEngine()
    let active = 0
    let maxActive = 0
    const engine: Engine = {
      ...base,
      on(handler) {
        active++
        maxActive = Math.max(maxActive, active)
        const unsub = base.on(handler)
        return () => {
          active--
          unsub()
        }
      },
    }
    const app = new Hono()
    const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app })
    app.get('/ws/trace', traceRoute(engine, upgradeWebSocket))
    const server = serve({ fetch: app.fetch, port: 0 })
    injectWebSocket(server)

    try {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      await new Promise<void>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${port}/ws/trace`)
        const timer = setTimeout(() => reject(new Error('ws lifecycle timeout')), 3000)
        client.on('open', () => {
          setTimeout(() => client.close(), 50) // stay open a beat, then close
        })
        client.on('close', () => {
          setTimeout(() => {
            clearTimeout(timer)
            resolve()
          }, 150) // let the server-side onClose run
        })
        client.on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
      })

      expect(maxActive).toBeGreaterThanOrEqual(1) // was subscribed while the socket was open
      expect(active).toBe(0) // released on close — no leak
    } finally {
      server.close()
    }
  })
})

describe('HTTP graceful shutdown — TKT-416', () => {
  it('the shutdown handler closes the server, then exits 0', () => {
    let closed = false
    let exitCode: number | undefined
    const handler = makeShutdownHandler(
      {
        close: (cb) => {
          closed = true
          cb?.()
        },
      },
      (code) => {
        exitCode = code
      },
    )

    handler()

    expect(closed).toBe(true)
    expect(exitCode).toBe(0)
  })

  it('invoking the shutdown handler twice closes only once (idempotent)', () => {
    let closeCount = 0
    const handler = makeShutdownHandler(
      {
        close: (cb) => {
          closeCount++
          cb?.()
        },
      },
      () => undefined,
    )

    handler()
    handler()

    expect(closeCount).toBe(1)
  })
})
