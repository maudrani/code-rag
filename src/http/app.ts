import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import type { Engine } from '../contracts/engine.js'
import type { Observable } from '../contracts/telemetry.js'
import { ingestRoutes } from './routes/ingest.js'
import { ledgerRoutes } from './routes/ledger.js'
import { queryRoutes } from './routes/query.js'
import { searchRoutes } from './routes/search.js'
import { telemetryRoutes } from './routes/telemetry.js'
import { traceRoute } from './routes/ws-trace.js'

const DEFAULT_PORT = 8787

export interface BuiltApp {
  app: Hono
  /** call AFTER serve() to upgrade the http.Server for /ws/trace (@hono/node-ws). */
  injectWebSocket: ReturnType<typeof createNodeWebSocket>['injectWebSocket']
}

/**
 * buildApp — composes the surface HTTP server (ADR-008): /query (SSE chat),
 * /search (deterministic), /ws/trace (WebSocket), + GET /health. One injected
 * Engine is shared across every route + the event-bus. A global onError returns
 * a consistent JSON envelope (no stack leak); notFound returns 404 JSON.
 *
 * The Engine is a parameter (DI) so this is unit-testable with a mock and the
 * production entrypoint (server.ts) owns the real `createEngine` wiring.
 */
export function buildApp(engine: Engine & Observable, ledgerPath?: string): BuiltApp {
  const app = new Hono()
  // The standalone web UI runs on a different origin (the Vite dev server), so the
  // browser needs CORS to call this API (preflight + Access-Control-Allow-Origin).
  // Permissive for clone-and-run; a real deploy should pin the allowed origin.
  app.use('*', cors())
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app })

  // route() merges the sub-app routes into this app, so this app's onError /
  // notFound govern them too — one consistent error envelope across the surface.
  app.route('/', queryRoutes(engine))
  app.route('/', searchRoutes(engine))
  // POST /ingest — clone a repo URL + reindex the active corpus (FTR-5 P4); the real cloner by default.
  app.route('/', ingestRoutes(engine))
  // telemetry read-surfaces (GET /stats, /health, /log) — replaces the old stub /health
  // with the real engine.health() (observability §5.2).
  app.route('/', telemetryRoutes(engine))
  // cross-consumer ledger (GET /ledger + SSE /ledger/stream) — the shared-file funnel the
  // dashboard tails; graceful empty when no CODE_RAG_LEDGER is configured (§5.4).
  app.route('/', ledgerRoutes(ledgerPath))
  app.get('/ws/trace', traceRoute(engine, upgradeWebSocket))

  app.notFound((c) => c.json({ error: 'Not Found' }, 404))
  app.onError((err, c) => {
    // Expected client errors carry their own status; keep it, render as JSON.
    if (err instanceof HTTPException) {
      return c.json({ error: err.message || 'Request error' }, err.status)
    }
    // Unexpected errors: 500 with NO internal detail leaked to the client.
    return c.json({ error: 'Internal Server Error' }, 500)
  })

  return { app, injectWebSocket }
}

/** Resolve the listen port: a positive integer from `value`, else the default (8787). */
export function resolvePort(value: string | undefined): number {
  const parsed = Number(value)
  const valid = value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed > 0
  return valid ? parsed : DEFAULT_PORT
}
