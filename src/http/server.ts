import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createEngine } from '../package/index.js'
import { buildApp, resolvePort } from './app.js'

/** Anything with a Node-style `close(callback)` — the @hono/node-server instance. */
export interface Closable {
  close(callback?: (err?: Error) => void): void
}

/**
 * makeShutdownHandler — a SIGTERM/SIGINT handler that closes the server once
 * (idempotent), then exits. Exported + DI'd (server, exit) so the graceful-shutdown
 * behavior is deterministically testable without real process signals.
 */
export function makeShutdownHandler(server: Closable, exit: (code: number) => void): () => void {
  let closing = false
  return () => {
    if (closing) return
    closing = true
    server.close(() => exit(0))
  }
}

/**
 * The clone-and-run HTTP entrypoint (ADR-006 / ADR-008). Wires the real Engine
 * from the package Consumer API, composes the app, serves it on Node via
 * @hono/node-server, injects the WebSocket upgrade for /ws/trace, and shuts down
 * gracefully on SIGTERM/SIGINT.
 */
export function startServer(port: number = resolvePort(process.env.PORT)) {
  const engine = createEngine({
    ...(process.env.CORPUS_PATH ? { corpusPath: process.env.CORPUS_PATH } : {}),
    ...(process.env.ANTHROPIC_API_KEY ? { apiKey: process.env.ANTHROPIC_API_KEY } : {}),
  })
  const { app, injectWebSocket } = buildApp(engine)
  const server = serve({ fetch: app.fetch, port })
  injectWebSocket(server)

  const onShutdown = makeShutdownHandler(server, (code) => process.exit(code))
  process.on('SIGTERM', onShutdown)
  process.on('SIGINT', onShutdown)

  console.log(`surface HTTP server listening on :${port}`)
  return server
}

// Import-safe: only auto-start when this module is executed directly
// (`node dist/http/server.js`), never on import (keeps tests/tooling side-effect free).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer()
}
