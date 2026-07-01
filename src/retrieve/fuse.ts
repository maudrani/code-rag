/**
 * L4 fusion — Reciprocal Rank Fusion (RRF) of the parallel retrieval legs.
 * ADR-003: BM25 (FTS5) + dense (local-ONNX cosine) + structural (one-hop call/import
 * neighbours) run in PARALLEL — none gates another — and fuse by RANK, not raw score.
 *
 *   fused(d) = Σ_leg  w_leg / (k + rank_leg(d))        (rank 1-indexed; absent leg ⇒ 0)
 *
 * k = 60 (Cormack et al., TREC 2009). Code-tuned weights bm25:0.6 / dense:0.4 / structural:0.3.
 * Rank-based ⇒ no score normalisation across legs (BM25 is unbounded; summing raw scores
 * would let it dominate — see `Sheldon-92/rag-retrieval` HR3, `timescale/postgres-hybrid-text-search`).
 *
 * This module is PURE + deterministic (no I/O) so the fusion maths is unit-assertable.
 */
import type { Chunk } from '../contracts/chunk.js'
import type { RankedChunk, RetrievalResult } from '../contracts/retrieval.js'

/** The three parallel retrieval legs (ADR-003). */
export type RetrievalLeg = 'bm25' | 'dense' | 'structural'

/**
 * One leg's ranked candidate. `score` is the leg's RAW signal (BM25 score / cosine
 * similarity / structural boost), carried for observability only — RRF fuses by the
 * candidate's POSITION in the list, never by this value. Lists are ordered best-first.
 */
export interface LegCandidate {
  chunkId: string
  score: number
}

/** The parallel legs feeding fusion. Any leg may be empty (e.g. zero-BM25 query). */
export type LegResults = Record<RetrievalLeg, LegCandidate[]>

export interface RrfConfig {
  /** RRF smoothing constant (Cormack et al., TREC 2009). */
  k: number
  /** code-tuned per-leg weights (ADR-003). */
  weights: Record<RetrievalLeg, number>
}

/** ADR-003 defaults: k=60, code-weights bm25:0.6 / dense:0.4, structural leg 0.3. */
export const DEFAULT_RRF_CONFIG: RrfConfig = {
  k: 60,
  weights: { bm25: 0.6, dense: 0.4, structural: 0.3 },
}

export const RETRIEVAL_LEGS: readonly RetrievalLeg[] = ['bm25', 'dense', 'structural']

/**
 * Fuse the parallel legs into a single ranked result (sorted desc by `fused`).
 *
 * @param legs    per-leg ranked candidate lists (parallel; none gates another)
 * @param chunks  id → Chunk lookup; a leg candidate whose id is absent here is skipped
 * @param config  RRF k + per-leg weights (defaults to ADR-003 values)
 */
export function rrfFuse(
  legs: LegResults,
  chunks: ReadonlyMap<string, Chunk>,
  config: RrfConfig = DEFAULT_RRF_CONFIG,
): RetrievalResult {
  const { k, weights } = config

  // FTR-55: capture the dense leg's RAW cosine per chunk BEFORE fusing it away. `fused` is rank-based
  // and tiny (~0.005) — it can't express absolute match quality; the raw cosine can, and the grounding
  // gate floors on it. First occurrence wins (the dense leg is best-first, so that's the highest
  // cosine). ONLY the dense leg's score is surfaced — bm25/structural raw scores are a different scale.
  const denseCosine = new Map<string, number>()
  for (const candidate of legs.dense) {
    if (!denseCosine.has(candidate.chunkId)) denseCosine.set(candidate.chunkId, candidate.score)
  }

  // Accumulate each leg's weighted RRF contribution per chunk id. Absent legs stay 0,
  // so `fused` is exactly the sum of the three contributions (parallel, not cascade).
  const contributions = new Map<string, { bm25: number; dense: number; structural: number }>()

  for (const leg of RETRIEVAL_LEGS) {
    const candidates = legs[leg]
    const weight = weights[leg]
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]
      if (candidate === undefined) continue
      const rank = i + 1 // 1-indexed
      const term = weight / (k + rank)
      let acc = contributions.get(candidate.chunkId)
      if (acc === undefined) {
        acc = { bm25: 0, dense: 0, structural: 0 }
        contributions.set(candidate.chunkId, acc)
      }
      acc[leg] += term
    }
  }

  const ranked: RankedChunk[] = []
  for (const [chunkId, scores] of contributions) {
    const chunk = chunks.get(chunkId)
    if (chunk === undefined) continue // a leg referenced an unknown chunk — skip defensively
    const entry: RankedChunk = {
      chunk,
      scores,
      fused: scores.bm25 + scores.dense + scores.structural,
    }
    // Surface the raw dense cosine (FTR-55). OMIT the key when the chunk had no dense candidate —
    // absence is `undefined`, NEVER 0 (0 reads as a confident non-match; exactOptionalPropertyTypes
    // forbids setting `cosine: undefined`, so we conditionally assign a present value only).
    const cosine = denseCosine.get(chunkId)
    if (cosine !== undefined) entry.cosine = cosine
    ranked.push(entry)
  }

  // Deterministic order: fused desc, ties broken by chunk id asc (stable across runs).
  ranked.sort((a, b) => b.fused - a.fused || a.chunk.id.localeCompare(b.chunk.id))
  return ranked
}

// Re-exported only so the type is visible at the module boundary for tests/consumers.
export type { RankedChunk }
