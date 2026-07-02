import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { CONSUMERS, STATS_LAYERS } from '../consume/index.js'
import type { Engine } from '../contracts/engine.js'
import type { Consumer, Observable } from '../contracts/telemetry.js'
import { askTool, healthTool, logTool, searchTool, statsTool, symbolsTool } from './tools.js'

const SERVER_NAME = 'code-rag'
const SERVER_VERSION = '0.1.0'

// z.enum needs a literal tuple — derive from the consume SSOT arrays so the schema can't drift.
const LAYER_ENUM = z.enum([...STATS_LAYERS] as [string, ...string[]])
const CONSUMER_ENUM = z.enum([...CONSUMERS] as [string, ...string[]])

/**
 * buildMcpServer — the MCP server (SDK v1, 1.29.0) exposing the engine over an
 * injected `Engine & Observable`. The retrieval tools (ask/search) bind the FTR-42
 * actions; the telemetry tools (stats/health/log) bind the FTR-45 read-surface —
 * their structuredContent is byte-identical to the CLI `--json` + the HTTP routes.
 * The engine is injected so this is unit-testable (the serve entry supplies the real one).
 */
export function buildMcpServer(engine: Engine & Observable): McpServer {
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

  server.registerTool(
    'stats',
    {
      description:
        'Per-layer telemetry for the engine: the holding snapshot, or one layer via `layer` (ingest|chunk|index|retrieve|answer). No LLM, no cost. structuredContent carries the telemetry struct.',
      inputSchema: {
        layer: LAYER_ENUM.optional().describe('restrict to one layer; omit for the full snapshot'),
      },
    },
    async ({ layer }) =>
      statsTool(
        engine,
        layer === undefined ? {} : { layer: layer as (typeof STATS_LAYERS)[number] },
      ),
  )

  server.registerTool(
    'health',
    {
      description:
        'Aggregate engine health: status (ok|degraded|down) + per-check detail. No LLM, no cost. structuredContent carries the HealthReport.',
      inputSchema: {},
    },
    async () => healthTool(engine),
  )

  server.registerTool(
    'log',
    {
      description:
        'The cross-consumer query ledger (every query from web/http/cli/mcp), newest first. Filter by `consumer`, cap with `limit`. structuredContent carries { entries }.',
      inputSchema: {
        consumer: CONSUMER_ENUM.optional().describe(
          'filter to one consumer (web|http|cli|mcp|package)',
        ),
        limit: z.number().int().positive().optional().describe('max entries to return'),
      },
    },
    async ({ consumer, limit }) => {
      const args: { consumer?: Consumer; limit?: number } = {}
      if (consumer !== undefined) args.consumer = consumer as Consumer
      if (limit !== undefined) args.limit = limit
      return logTool(engine, args)
    },
  )

  server.registerTool(
    'symbols',
    {
      description:
        'The indexed code symbols (path, symbol, kind, lang, span) for autocomplete + a corpus tree the client folds from `path`. Read-only, no LLM. Unlike the held-state stats/health/log, symbols ENSURES the index, so the FIRST call indexes the corpus (a one-time cost/latency; warm afterwards via CODE_RAG_INDEX). structuredContent carries { symbols }.',
      inputSchema: {},
    },
    async () => symbolsTool(engine),
  )

  return server
}
