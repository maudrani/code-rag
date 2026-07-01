/**
 * Mock dev-server (Vite plugin) — a THIN transport adapter over the pure generators.
 * Serves the ADR-008 wire so `npm run dev` runs the whole UI ⊥ surface:
 *   POST /query   -> SSE stream (meta -> token* -> done; refuse = meta + done)
 *   POST /search  -> JSON WireProjection (deterministic, no answer)
 *   GET  /ws/trace -> WebSocket stream of Event (incl. a foreign queryId)
 * Dev-only: not imported by the browser bundle. At M1 assembly the base URL swaps to surface.
 */
import type { IncomingMessage } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'
import { WebSocketServer } from 'ws'
import { ANSWER_MARKDOWN, answerProjection, refuseProjection, traceEventsFixture } from './fixtures'
import { encodeFrame } from './sseEncode'
import { makeQueryStream, makeSearchResponse } from './wireMock'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
}

// Deterministic fixture pick: obvious off-topic questions refuse; everything else answers.
// Lets the demo exercise BOTH bands without a real backend.
function pickProjection(text: string) {
  return /capital|weather|recipe|football|stock price/i.test(text)
    ? refuseProjection
    : answerProjection
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseField(body: string, field: string): string {
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    const value = obj[field]
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function mockWirePlugin(): Plugin {
  return {
    name: 'code-rag-mock-wire',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/query', async (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        const question = parseField(await readBody(req), 'question')
        const events = makeQueryStream(pickProjection(question), { answer: ANSWER_MARKDOWN })
        res.writeHead(200, SSE_HEADERS)
        for (const event of events) {
          res.write(encodeFrame(event))
          await delay(event.event === 'token' ? 35 : 10) // visible progressive streaming
        }
        res.end()
      })

      server.middlewares.use('/search', async (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        const query = parseField(await readBody(req), 'query')
        const body = JSON.stringify(makeSearchResponse(pickProjection(query)))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(body)
      })

      // WS /ws/trace — stream the current query's Events (M1 single-consumer, A4).
      const wss = new WebSocketServer({ noServer: true })
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith('/ws/trace')) {
          return // not ours — let Vite's HMR WebSocket handle it
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          for (const event of traceEventsFixture) {
            ws.send(JSON.stringify(event))
          }
        })
      })
    },
  }
}
