import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createEngine } from '../package/index.js'
import { buildApp, resolvePort } from './app.js'

/**
 * The clone-and-run HTTP entrypoint (ADR-006 / ADR-008). Wires the real Engine
 * from the package Consumer API, composes the app, serves it on Node via
 * @hono/node-server, and injects the WebSocket upgrade for /ws/trace.
 *
 * The Engine comes from `createEngine` (the master-owned membrane, ADR-002). The
 * server STRUCTURE is complete + tested (buildApp via a mock); until the master
 * fills the membrane, starting this entrypoint surfaces "not implemented yet" —
 * that is the documented integration boundary, not a surface gap.
 */
export function startServer(port: number = resolvePort(process.env.PORT)) {
  const engine = createEngine({
    ...(process.env.CORPUS_PATH ? { corpusPath: process.env.CORPUS_PATH } : {}),
    ...(process.env.ANTHROPIC_API_KEY ? { apiKey: process.env.ANTHROPIC_API_KEY } : {}),
  })
  const { app, injectWebSocket } = buildApp(engine)
  const server = serve({ fetch: app.fetch, port })
  injectWebSocket(server)
  console.log(`surface HTTP server listening on :${port}`)
  return server
}

// Import-safe: only auto-start when this module is executed directly
// (`node dist/http/server.js`), never on import (keeps tests/tooling side-effect free).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer()
}
