import type { Chunk, Citation, RankedChunk } from '../contract'

/**
 * Resolve a Citation to its code by joining on chunkId (ADR-002 join-key). The wire ships
 * results[].chunk.code, so the source is in-payload — no fetch, no editor. Returns null if
 * the cited chunk was trimmed from results (light payload) so the UI can degrade gracefully.
 */
export function resolveCitation(citation: Citation, results: RankedChunk[]): Chunk | null {
  const match = results.find((r) => r.chunk.id === citation.chunkId)
  return match ? match.chunk : null
}
