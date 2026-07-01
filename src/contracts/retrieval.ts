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

/**
 * The semantic grounding floor (FTR-55) — a hit whose raw dense {@link RankedChunk.cosine} clears
 * this is "semantically grounded" regardless of lexical overlap; the score-gate ORs it with the
 * lexical floor (so a semantically-strong pure-NL query is no longer false-refused). ONE corpus-tuned
 * constant, shared by the answer gate and the retrieval eval — they import it from HERE (the contract
 * next to the field it thresholds), never from each other. A RAW cosine threshold, NOT a calibrated
 * 0..1 confidence (peripheral-hub TKT-337 + ProsusAI: calibration is corpus-specific; threshold the
 * raw number, re-tune per corpus/embedder).
 *
 * 0.27 = the midpoint of the MEASURED separation band on this repo + MiniLM-q8 (retrieval's RUN_SLOW
 * cos-floor eval): noise (off-topic <=0.153, gibberish <=0.233) < 0.27 < weakest pure-NL rescue gold
 * (0.300). It targets the pure-NL RESCUE band while refusing off-topic/gibberish. Raw cosine alone
 * does NOT separate every gold from gibberish (a weak-lexical gold can score below gibberish) — that
 * is the lexical floor's job; the OR gate is what covers both directions.
 */
export const COS_FLOOR = 0.27
