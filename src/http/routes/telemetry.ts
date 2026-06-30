import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  getHealth,
  getLogPayload,
  getStats,
  isConsumer,
  isStatsLayer,
} from '../../consume/index.js'
import type { Engine } from '../../contracts/engine.js'
import type { Consumer, Observable } from '../../contracts/telemetry.js'

/**
 * The telemetry read-surfaces (observability design §5.2) — the HTTP face of
 * `code-rag stats|health|log`. Each returns the SAME serialized payload as the CLI
 * `--json` and the MCP tools (they all funnel through src/consume), so the three are
 * byte-identical by construction. Deterministic: no LLM, no token cost. The engine is
 * injected (DI) — the same `Engine & Observable` the chat/search routes + bus share.
 */
export function telemetryRoutes(engine: Engine & Observable): Hono {
  const app = new Hono()

  // GET /stats[?layer=ingest|chunk|index|retrieve|answer] — full snapshot or one layer.
  app.get('/stats', (c) => {
    const layer = c.req.query('layer')
    if (layer === undefined) return c.json(getStats(engine))
    if (!isStatsLayer(layer)) {
      throw new HTTPException(400, {
        message: `invalid layer '${layer}' (expected: ingest | chunk | index | retrieve | answer)`,
      })
    }
    return c.json(getStats(engine, layer))
  })

  // GET /health — 200 for ok/degraded, 503 for down (the readiness contract; matches CLI exit).
  app.get('/health', (c) => {
    const report = getHealth(engine)
    return c.json(report, report.status === 'down' ? 503 : 200)
  })

  // GET /log[?consumer=&limit=] — the cross-consumer ledger as { entries }.
  app.get('/log', (c) => {
    const consumer = c.req.query('consumer')
    const limitRaw = c.req.query('limit')
    const opts: { consumer?: Consumer; limit?: number } = {}
    if (consumer !== undefined) {
      if (!isConsumer(consumer)) {
        throw new HTTPException(400, {
          message: `invalid consumer '${consumer}' (expected: web | http | cli | mcp | package)`,
        })
      }
      opts.consumer = consumer
    }
    if (limitRaw !== undefined) {
      const n = Number(limitRaw)
      if (!Number.isInteger(n) || n <= 0) {
        throw new HTTPException(400, {
          message: `invalid limit '${limitRaw}' (expected a positive integer)`,
        })
      }
      opts.limit = n
    }
    return c.json(getLogPayload(engine, opts))
  })

  return app
}
