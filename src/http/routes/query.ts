import { Hono } from 'hono'
import type { SSEStreamingApi } from 'hono/streaming'
import { streamSSE } from 'hono/streaming'
import type { Engine } from '../../contracts/engine.js'
import type { QueryRequest, QuerySseEvent } from '../../contracts/wire.js'
import { resolveConsumer } from '../consumer.js'
import { toWireProjection } from '../wire.js'

/**
 * POST /query — the ADR-008 chat endpoint, streamed via SSE. Event order:
 *   meta  -> the WireProjection (citations + decision), before the answer streams
 *   token -> 0..N answer chunks (only when decision.band === 'answer')
 *   done  -> { tokensTotal, estCost } — mirrors the L5 cost event
 * On refuse: meta then done, NO token events.
 *
 * The engine is injected (DI) so the production entrypoint never imports a mock
 * and the route is unit-testable via `app.request` (charter / ADR-006).
 */
export function queryRoutes(engine: Engine): Hono {
  const app = new Hono()

  app.post('/query', async (c) => {
    const { question, history } = await c.req.json<QueryRequest>()
    // Deterministic membrane first: retrieval + gate are known before the answer. The consumer
    // tag honours a client override (X-Consumer / ?consumer=) so the web UI records as 'web'.
    const projection = await engine.query(question, history, resolveConsumer(c))

    return streamSSE(c, async (stream) => {
      // estCost "mirrors the L5 event" (ADR-006/008, G3): it is NOT in the usage
      // chunk (tokens only) — capture it from the bus, matched by queryId.
      let estCost = 0
      let tokensTotal = 0
      const unsubscribe = engine.on((event) => {
        if (event.queryId === projection.queryId && event.layer === 'L5') {
          const cost = readEstCost(event.payload)
          if (cost !== undefined) estCost = cost
        }
      })

      try {
        await writeEvent(stream, { event: 'meta', data: toWireProjection(projection) })

        if (projection.decision.band === 'answer') {
          for await (const chunk of engine.answer(projection, history)) {
            if (stream.aborted) break
            if (chunk.type === 'token') {
              await writeEvent(stream, { event: 'token', data: { text: chunk.text } })
            } else {
              // usage chunk: tokensTotal = inputTokens + outputTokens (ADR-008).
              tokensTotal = chunk.inputTokens + chunk.outputTokens
            }
          }
        }
      } catch {
        // answer() failed mid-stream — fall through to the terminal `done` so the
        // client never hangs (the partial answer + cost-so-far still close cleanly).
      } finally {
        if (!stream.aborted) {
          await writeEvent(stream, { event: 'done', data: { tokensTotal, estCost } })
        }
        unsubscribe()
      }
    })
  })

  return app
}

/** Serialize a typed wire event — keeps the SSE frames conformant to QuerySseEvent. */
async function writeEvent(stream: SSEStreamingApi, event: QuerySseEvent): Promise<void> {
  await stream.writeSSE({ event: event.event, data: JSON.stringify(event.data) })
}

/** Narrow the L5 cost event payload (Event.payload is `unknown`) to its estCost. */
function readEstCost(payload: unknown): number | undefined {
  if (typeof payload === 'object' && payload !== null && 'estCost' in payload) {
    const value = (payload as { estCost: unknown }).estCost
    if (typeof value === 'number') return value
  }
  return undefined
}
