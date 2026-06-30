import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Engine } from '../contracts/engine.js'
import { askTool, searchTool } from './tools.js'

const SERVER_NAME = 'code-rag'
const SERVER_VERSION = '0.1.0'

/**
 * buildMcpServer — the MCP server (SDK v1, 1.29.0) exposing the retrieval over an
 * injected engine. Two tools bind the FTR-42 actions; both return the projection
 * as typed structuredContent (D5). The engine is injected so this is unit-testable
 * (the serve entry, TKT-414, supplies the real one).
 */
export function buildMcpServer(engine: Engine): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  server.registerTool(
    'ask',
    {
      description:
        'Ask a question about the codebase. Returns a grounded answer; with dry=true, the deterministic retrieval only (no LLM, no cost). structuredContent carries the projection (citations + decision).',
      inputSchema: {
        query: z.string().describe('the question about the codebase'),
        dry: z.boolean().optional().describe('retrieval only — no LLM call, no cost'),
      },
    },
    async ({ query, dry }) => askTool(engine, { query, dry: dry ?? false }),
  )

  server.registerTool(
    'search',
    {
      description:
        'Deterministic retrieval over the codebase: ranked citations + the gate decision, no answer, no cost. structuredContent carries the projection.',
      inputSchema: {
        query: z.string().describe('the search query'),
      },
    },
    async ({ query }) => searchTool(engine, { query }),
  )

  return server
}
