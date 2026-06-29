import type { Chunk } from './chunk.js'

/**
 * RankedChunk — L4 output (ADR-002, ADR-003).
 * A chunk with its per-leg scores + the RRF-fused score.
 */
export interface RankedChunk {
  chunk: Chunk
  /** per-leg scores: BM25 (FTS5), dense (local-ONNX cosine), structural (one-hop) */
  scores: { bm25: number; dense: number; structural: number }
  /** RRF fused score — k=60, code-weights bm25:0.6 / dense:0.4 + structural leg (ADR-003) */
  fused: number
}

/** L4 result — ranked descending by `fused`. */
export type RetrievalResult = RankedChunk[]
