import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ProjectionDTO } from '../consume/index.js'
import { ask, serializeProjection } from '../consume/index.js'
import type { Engine } from '../contracts/engine.js'
import type { Citation } from '../contracts/projection.js'

/** structuredContent is Record<string, unknown>; the typed DTO has no index signature. */
function structured(dto: ProjectionDTO): Record<string, unknown> {
  return dto as unknown as Record<string, unknown>
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
