import type { Projection } from '../contracts/projection.js'
import type { WireProjection } from '../contracts/wire.js'

/**
 * Projection -> WireProjection: drop the heavy `context.assembled` (ADR-008).
 * The single place the wire shape is derived — shared by /query (meta) and
 * /search (response) so "Projection minus context" is enforced once.
 */
export function toWireProjection(p: Projection): WireProjection {
  return {
    queryId: p.queryId,
    question: p.question,
    resolvedQuery: p.resolvedQuery,
    results: p.results,
    citations: p.citations,
    decision: p.decision,
  }
}
