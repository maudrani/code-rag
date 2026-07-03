import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadEnvFile } from '../boot/loadEnvFile.js'
import { buildEngine, isDirectRun, resolveCorpusSource } from '../consume/index.js'
import { buildMcpServer } from './server.js'

/** An idempotent stdio shutdown handler (close the server, then exit). Exported for testing. */
export function makeMcpShutdown(
  server: { close(): Promise<void> },
  exit: (code: number) => void,
): () => void {
  let closing = false
  return () => {
    if (closing) return
    closing = true
    void server.close().finally(() => exit(0))
  }
}

/**
 * startMcpServer — the clone-and-run MCP entrypoint (ADR-006 product-MCP). Builds
 * the engine from env (CORPUS_PATH / ANTHROPIC_API_KEY), exposes ask + search over
 * stdio, and shuts down gracefully on SIGTERM/SIGINT.
 *
 * HYGIENE: stdout is the JSON-RPC channel — every log goes to stderr. `search` and
 * `ask --dry` need no API key (the membrane provider is lazy).
 */
export async function startMcpServer(): Promise<void> {
  // FTR-5: a CODE_RAG_REPO URL clones to a local corpus before buildEngine (else CORPUS_PATH).
  const corpusPath = await resolveCorpusSource({ env: process.env })
  const engine = buildEngine(corpusPath !== undefined ? { corpusPath } : {}) // + CORPUS_PATH/API key from env
  const server = buildMcpServer(engine)
  const transport = new StdioServerTransport()

  const shutdown = makeMcpShutdown(server, (code) => process.exit(code))
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  await server.connect(transport)
  process.stderr.write('code-rag MCP server running on stdio\n')
}

// Import-safe: open stdio only when executed directly (`node dist/…`, the linked bin, etc.),
// never on import (keeps tests + tooling side-effect free) — realpath-safe guard (TKT-447).
if (isDirectRun(process.argv[1], import.meta.url)) {
  loadEnvFile() // auto-load a project-root .env (real exports still win) — before any env read
  startMcpServer().catch((err: unknown) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
