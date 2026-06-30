import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { LayerStats, ProjectionDTO, StatsLayer } from '../consume/index.js'
import { ask, getHealth, getLogPayload, getStats, serializeProjection } from '../consume/index.js'
import type { Engine } from '../contracts/engine.js'
import type { Citation } from '../contracts/projection.js'
import type { Consumer, EngineTelemetry, HealthReport, Observable } from '../contracts/telemetry.js'

/** structuredContent is Record<string, unknown>; our typed payloads have no index signature. */
function structured(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>
}

function fileLine(c: Citation): string {
  return `${c.path}:${c.span.startLine}-${c.span.endLine}`
}

/** A compact human summary of a deterministic projection (the `content` text for dry/refuse/search). */
function projectionSummary(dto: ProjectionDTO): string {
  const d = dto.decision
  const head = `${d.band} · ${d.tier} · grounding ${d.groundingScore.toFixed(3)} · ${dto.results.length} results`
  if (dto.citations.length === 0) return head
  return `${head}\ncitations:\n${dto.citations.map((c) => `  ${fileLine(c)}`).join('\n')}`
}

export interface AskToolArgs {
  query: string
  dry?: boolean
}

export interface SearchToolArgs {
  query: string
}

/**
 * askTool — the `ask` tool logic (DI engine). Runs actions.ask; on an answer it
 * returns the accumulated answer text, on dry/refuse a projection summary. The
 * structuredContent always carries the serializeProjection DTO (D5) — the same
 * shape the CLI `--json` emits.
 */
export async function askTool(engine: Engine, args: AskToolArgs): Promise<CallToolResult> {
  const result = await ask(engine, args.query, { dry: args.dry ?? false })
  const dto = serializeProjection(result.projection)
  const text = result.answered ? result.answer : projectionSummary(dto)
  return { content: [{ type: 'text', text }], structuredContent: structured(dto) }
}

/**
 * searchTool — the `search` tool logic: deterministic retrieval only (the dry path
 * → query() alone), no answer, no cost. structuredContent = the DTO.
 */
export async function searchTool(engine: Engine, args: SearchToolArgs): Promise<CallToolResult> {
  const result = await ask(engine, args.query, { dry: true })
  const dto = serializeProjection(result.projection)
  return {
    content: [{ type: 'text', text: projectionSummary(dto) }],
    structuredContent: structured(dto),
  }
}

// ─── telemetry tools (stats / health / log) — the SAME payloads as CLI + HTTP ──

export interface StatsToolArgs {
  layer?: StatsLayer
}
export interface LogToolArgs {
  consumer?: Consumer
  limit?: number
}

/** A compact summary of a stats payload (the `content` text; structuredContent carries the data). */
function statsSummary(payload: EngineTelemetry | LayerStats): string {
  if ('layer' in payload) {
    return `stats[${payload.layer}]: ${payload.data === null ? 'no data yet' : 'present'}`
  }
  const present = (['ingest', 'chunk', 'index'] as const).filter((k) => payload[k] !== null)
  const indexed = present.length > 0 ? present.join(', ') : 'nothing indexed'
  return `stats: ${indexed}${payload.lastQuery ? ' + lastQuery' : ''}`
}

/**
 * statsTool — the `stats` tool: the holding telemetry snapshot, or one projected layer.
 * structuredContent IS the parity payload (identical to `code-rag stats --json` and GET /stats).
 */
export function statsTool(engine: Observable, args: StatsToolArgs = {}): CallToolResult {
  const payload = args.layer === undefined ? getStats(engine) : getStats(engine, args.layer)
  return {
    content: [{ type: 'text', text: statsSummary(payload) }],
    structuredContent: structured(payload),
  }
}

/** healthTool — the `health` tool. structuredContent = the HealthReport (parity with CLI/HTTP). */
export function healthTool(engine: Observable): CallToolResult {
  const report: HealthReport = getHealth(engine)
  const checks = Object.entries(report.checks)
    .map(([k, c]) => `${c.ok ? '✓' : '✗'}${k}`)
    .join(' ')
  return {
    content: [{ type: 'text', text: `${report.status} — ${checks}` }],
    structuredContent: structured(report),
  }
}

/** logTool — the `log` tool: the cross-consumer ledger as { entries } (parity with CLI/HTTP). */
export function logTool(engine: Observable, args: LogToolArgs = {}): CallToolResult {
  const payload = getLogPayload(engine, args)
  return {
    content: [{ type: 'text', text: `${payload.entries.length} ledger entries` }],
    structuredContent: structured(payload),
  }
}
