import { serve } from '@hono/node-server'
import {
  buildEngine,
  isDirectRun,
  resolveCorpusSource,
  resolveLedgerPath,
} from '../consume/index.js'
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
export async function startServer(port: number = resolvePort(process.env.PORT)) {
  // FTR-5: a CODE_RAG_REPO URL clones to a local corpus before buildEngine (else CORPUS_PATH).
  const corpusPath = await resolveCorpusSource({ env: process.env })
  // buildEngine (not createEngine) so, when CODE_RAG_LEDGER is set, THIS server's queries
  // also append to the shared cross-consumer ledger; the same path feeds GET /ledger.
  const engine = buildEngine(corpusPath !== undefined ? { corpusPath } : {})
  const ledgerPath = resolveLedgerPath(process.env)
  const { app, injectWebSocket } = buildApp(engine, ledgerPath)
  const server = serve({ fetch: app.fetch, port })
  injectWebSocket(server)

  const onShutdown = makeShutdownHandler(server, (code) => process.exit(code))
  process.on('SIGTERM', onShutdown)
  process.on('SIGINT', onShutdown)

  console.log(`surface HTTP server listening on :${port}`)
  return server
}

// Import-safe: only auto-start when this module is executed directly (`node dist/…`, the linked
// bin, etc.), never on import (keeps tests/tooling side-effect free) — realpath-safe guard (TKT-447).
if (isDirectRun(process.argv[1], import.meta.url)) {
  startServer().catch((err: unknown) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
