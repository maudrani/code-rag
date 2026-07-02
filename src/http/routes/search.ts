import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Engine } from '../../contracts/engine.js'
import type { SearchRequest, SearchResponse } from '../../contracts/wire.js'
import { resolveConsumer } from '../consumer.js'
import { toWireProjection } from '../wire.js'

/**
 * POST /search — the ADR-008 manual-search endpoint. Runs the deterministic
 * membrane ONLY (engine.query) and returns a WireProjection (results + decision,
 * NO answer). It is the HTTP face of the CLI `--dry`: no LLM call, no token bill.
 * The engine is injected (DI), same instance the chat route + bus share.
 */
export function searchRoutes(engine: Engine): Hono {
  const app = new Hono()

  app.post('/search', async (c) => {
    const body = await c.req
      .json<Partial<SearchRequest>>()
      .catch(() => ({}) as Partial<SearchRequest>)
    const query = body.query
    if (typeof query !== 'string' || query.trim() === '') {
      throw new HTTPException(400, { message: 'query must be a non-empty string' })
    }

    // query() only — deterministic, no answer()/LLM/cost (the --dry path). The consumer tag
    // honours a client override (X-Consumer / ?consumer=) — the web's assisted-search tags 'web'.
    const projection = await engine.query(query, [], resolveConsumer(c))
    const response: SearchResponse = toWireProjection(projection)
    return c.json(response)
  })

  return app
}
