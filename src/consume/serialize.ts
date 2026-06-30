import type { Citation, GateDecision, Projection } from '../contracts/projection.js'

/** A retrieval hit, flattened to the citation-relevant fields (RankedChunk minus internals). */
export interface SerializedResult {
  path: string
  span: { startLine: number; endLine: number }
  symbol: string
  /** the RRF-fused retrieval score */
  score: number
}

/**
 * ProjectionDTO — the serialized Projection the CLI (`--json`) and the MCP
 * (`structuredContent`) both emit. It is the HTTP WireProjection's lighter
 * sibling: same drop-`context` rule, but `results` is flattened to
 * `{ path, span, symbol, score }` (terminal/tool output doesn't need the full
 * RankedChunk). Defined here (consume-layer type, NOT a contract).
 */
export interface ProjectionDTO {
  queryId: string
  question: string
  resolvedQuery: string
  results: SerializedResult[]
  citations: Citation[]
  decision: GateDecision
}

/**
 * serializeProjection — the single serializer both transports share, so the CLI
 * `--json` and the MCP `structuredContent` cannot diverge (design §4.1). Drops
 * `context.assembled` (heavy, L5-only) and flattens each RankedChunk.
 */
export function serializeProjection(p: Projection): ProjectionDTO {
  return {
    queryId: p.queryId,
    question: p.question,
    resolvedQuery: p.resolvedQuery,
    results: p.results.map((r) => ({
      path: r.chunk.path,
      span: r.chunk.span,
      symbol: r.chunk.symbol,
      score: r.fused,
    })),
    citations: p.citations,
    decision: p.decision,
  }
}
