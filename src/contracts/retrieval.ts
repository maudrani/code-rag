import type { Chunk } from './chunk.js'

/**
 * RankedChunk — L4 output (ADR-002, ADR-003).
 * A chunk with its per-leg scores + the RRF-fused score.
 */
export interface RankedChunk {
  chunk: Chunk
  /** per-leg RRF *contributions* (weight/(k+rank)): BM25 (FTS5), dense (local-ONNX), structural */
  scores: { bm25: number; dense: number; structural: number }
  /** RRF fused score — k=60, code-weights bm25:0.6 / dense:0.4 + structural leg (ADR-003) */
  fused: number
  /**
   * raw dense cosine similarity for this hit (0..1) — the ABSOLUTE relevance signal the
   * rank-based `fused` score cannot express (FTR-55, adopting peripheral-hub TKT-337). The
   * score-gate floors on it: a semantically-strong hit grounds an answer even when lexical
   * overlap is thin. `undefined` when the hit had no dense candidate (bm25/structural-only, or
   * the dense leg was absent) — NEVER 0, since 0 reads as a confident non-match and would
   * corrupt the floor. Additive: `scores`/`fused` are unchanged.
   */
  cosine?: number
}

/** L4 result — ranked descending by `fused`. */
export type RetrievalResult = RankedChunk[]
