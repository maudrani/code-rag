/**
 * L4 RRF fusion — math-assertable tests (ADR-003).
 *
 * The fusion is rank-based and pure, so every fused score is computable by hand:
 *   fused(d) = Σ_leg  w_leg / (k + rank_leg(d))     (rank 1-indexed; absent leg ⇒ 0)
 * with k=60 and code-weights bm25:0.6 / dense:0.4 / structural:0.3.
 *
 * Expected numbers below are computed independently of the implementation
 * (written as the literal fraction AND, for the headline case, as a hand-rounded
 * decimal) — this is the "math-assertable" contract for the deterministic core.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_RRF_CONFIG, type LegResults, rrfFuse } from '../../src/retrieve/fuse.js'
import {
  bm25SearchChunk,
  chunkMap,
  embedQueryChunk,
  rrfFuseChunk,
  searchIndexChunk,
  vectorStoreChunk,
} from './fixtures/chunks.js'

const c1 = searchIndexChunk.id
const c2 = embedQueryChunk.id
const c3 = bm25SearchChunk.id
const c4 = vectorStoreChunk.id
const c5 = rrfFuseChunk.id

/** rank-1 candidate (raw score is irrelevant to fusion — set arbitrarily). */
const at = (chunkId: string) => ({ chunkId, score: 0 })

describe('rrfFuse — RRF maths (k=60, code-weights bm25:0.6/dense:0.4/structural:0.3)', () => {
  // bm25:       [c1, c2, c3]   ranks 1,2,3
  // dense:      [c2, c1, c4]   ranks 1,2,3
  // structural: [c1, c5]       ranks 1,2
  const legs: LegResults = {
    bm25: [at(c1), at(c2), at(c3)],
    dense: [at(c2), at(c1), at(c4)],
    structural: [at(c1), at(c5)],
  }

  it('fuses by rank and orders desc by fused', () => {
    const result = rrfFuse(legs, chunkMap)
    expect(result.map((r) => r.chunk.id)).toEqual([c1, c2, c3, c4, c5])
  })

  it('computes each fused score exactly (hand-derived)', () => {
    const fused = new Map(rrfFuse(legs, chunkMap).map((r) => [r.chunk.id, r.fused]))

    // c1: 0.6/61 + 0.4/62 + 0.3/61
    expect(fused.get(c1)).toBeCloseTo(0.6 / 61 + 0.4 / 62 + 0.3 / 61, 12)
    expect(fused.get(c1)).toBeCloseTo(0.021205711, 9) // independent decimal
    // c2: 0.6/62 + 0.4/61
    expect(fused.get(c2)).toBeCloseTo(0.6 / 62 + 0.4 / 61, 12)
    expect(fused.get(c2)).toBeCloseTo(0.016234796, 9)
    // c3: 0.6/63 ; c4: 0.4/63 ; c5: 0.3/62
    expect(fused.get(c3)).toBeCloseTo(0.6 / 63, 12)
    expect(fused.get(c4)).toBeCloseTo(0.4 / 63, 12)
    expect(fused.get(c5)).toBeCloseTo(0.3 / 62, 12)
  })

  it('exposes per-leg weighted contributions that sum to fused (observability)', () => {
    const byId = new Map(rrfFuse(legs, chunkMap).map((r) => [r.chunk.id, r]))
    const r1 = byId.get(c1)
    expect(r1).toBeDefined()
    if (!r1) return
    expect(r1.scores.bm25).toBeCloseTo(0.6 / 61, 12)
    expect(r1.scores.dense).toBeCloseTo(0.4 / 62, 12)
    expect(r1.scores.structural).toBeCloseTo(0.3 / 61, 12)
    expect(r1.scores.bm25 + r1.scores.dense + r1.scores.structural).toBeCloseTo(r1.fused, 12)
  })

  it('zeroes the contribution of a leg a chunk is absent from', () => {
    const byId = new Map(rrfFuse(legs, chunkMap).map((r) => [r.chunk.id, r]))
    // c3 only appears in bm25 ⇒ dense + structural contributions are exactly 0
    expect(byId.get(c3)?.scores.dense).toBe(0)
    expect(byId.get(c3)?.scores.structural).toBe(0)
  })
})

describe('rrfFuse — parallel, not cascade (the ADR-003 invariant)', () => {
  it('returns dense + structural results for a zero-BM25 query (no empty cascade)', () => {
    // Pure-semantic query: BM25 found nothing. A cascade (BM25 → gate) would return [].
    const legs: LegResults = {
      bm25: [],
      dense: [at(c2), at(c4)],
      structural: [at(c5)],
    }
    const result = rrfFuse(legs, chunkMap)
    expect(result.length).toBe(3)
    expect(result.map((r) => r.chunk.id).sort()).toEqual([c2, c4, c5].sort())
    // none of them got any bm25 contribution
    for (const r of result) expect(r.scores.bm25).toBe(0)
  })

  it('no leg gates another: a dense-only chunk is still ranked even when BM25 is dense', () => {
    const legs: LegResults = {
      bm25: [at(c1), at(c2), at(c3)],
      dense: [at(c4)], // c4 appears in NO bm25 candidate — must still surface
      structural: [],
    }
    const ids = rrfFuse(legs, chunkMap).map((r) => r.chunk.id)
    expect(ids).toContain(c4)
  })
})

describe('rrfFuse — weighting + rank behaviour', () => {
  it('rewards being well-ranked across legs (all-three beats single-leg)', () => {
    const legs: LegResults = {
      bm25: [at(c1), at(c2)],
      dense: [at(c1), at(c2)],
      structural: [at(c1)],
    }
    const result = rrfFuse(legs, chunkMap)
    // c1 (rank-1 in all three) must outrank c2 (rank-2 in two, absent from structural)
    expect(result[0]?.chunk.id).toBe(c1)
    expect(result[1]?.chunk.id).toBe(c2)
  })

  it('a higher-weighted leg contributes more at equal rank', () => {
    // c1 rank-1 in bm25 (0.6), c2 rank-1 in dense (0.4) ⇒ c1 outranks c2
    const legs: LegResults = {
      bm25: [at(c1)],
      dense: [at(c2)],
      structural: [],
    }
    const result = rrfFuse(legs, chunkMap)
    expect(result.map((r) => r.chunk.id)).toEqual([c1, c2])
    const byId = new Map(result.map((r) => [r.chunk.id, r]))
    expect(byId.get(c1)?.fused).toBeGreaterThan(byId.get(c2)?.fused ?? Number.POSITIVE_INFINITY)
  })

  it('respects a custom config (k + weights)', () => {
    const legs: LegResults = { bm25: [at(c1)], dense: [], structural: [] }
    const result = rrfFuse(legs, chunkMap, { k: 10, weights: { bm25: 2, dense: 1, structural: 1 } })
    expect(result[0]?.fused).toBeCloseTo(2 / 11, 12) // 2 / (10 + 1)
  })
})

describe('rrfFuse — dense cosine surfacing (FTR-55: the raw absolute-relevance signal)', () => {
  /** a candidate carrying a meaningful raw score (the dense leg's cosine). */
  const atScore = (chunkId: string, score: number) => ({ chunkId, score })

  it('surfaces the dense leg raw cosine onto RankedChunk.cosine', () => {
    const legs: LegResults = { bm25: [], dense: [atScore(c1, 0.87)], structural: [] }
    const [r] = rrfFuse(legs, chunkMap)
    expect(r?.cosine).toBe(0.87)
    // additive: fused is still the pure RRF contribution (dense rank-1 ⇒ 0.4/61), untouched by cosine
    expect(r?.fused).toBeCloseTo(0.4 / 61, 12)
  })

  it('leaves cosine UNDEFINED (never 0) for a bm25/structural-only hit — the TKT-337 negative', () => {
    const legs: LegResults = { bm25: [atScore(c1, 5)], dense: [], structural: [atScore(c1, 3)] }
    const [r] = rrfFuse(legs, chunkMap)
    expect(r?.cosine).toBeUndefined() // no dense candidate ⇒ no semantic signal
    expect(r?.cosine).not.toBe(0) // 0 would read as a CONFIDENT non-match and corrupt the floor
    expect(Object.hasOwn(r ?? {}, 'cosine')).toBe(false) // the key is OMITTED, not set to undefined
  })

  it('surfaces ONLY the dense score — bm25/structural raw scores never become cosine', () => {
    const legs: LegResults = {
      bm25: [atScore(c1, 9)],
      dense: [atScore(c1, 0.42)],
      structural: [atScore(c1, 3)],
    }
    const [r] = rrfFuse(legs, chunkMap)
    expect(r?.cosine).toBe(0.42) // the dense cosine, not bm25's 9 nor structural's 3
  })

  it('an empty/absent dense leg leaves EVERY cosine undefined (no spurious zeros)', () => {
    const legs: LegResults = {
      bm25: [atScore(c1, 1), atScore(c2, 1)],
      dense: [],
      structural: [atScore(c1, 1)],
    }
    for (const r of rrfFuse(legs, chunkMap)) expect(r.cosine).toBeUndefined()
  })

  it('distinguishes a present-but-zero cosine (0) from an absent one (undefined)', () => {
    // a real dense candidate whose cosine is exactly 0 keeps 0 — ABSENCE is undefined, not a 0 value.
    const present: LegResults = { bm25: [], dense: [atScore(c1, 0)], structural: [] }
    const absent: LegResults = { bm25: [atScore(c1, 1)], dense: [], structural: [] }
    expect(rrfFuse(present, chunkMap)[0]?.cosine).toBe(0) // present with a genuine 0-cosine
    expect(rrfFuse(absent, chunkMap)[0]?.cosine).toBeUndefined() // absent from the dense leg
  })

  it('keeps the highest cosine when a chunk appears twice in the dense leg (first/best wins)', () => {
    const legs: LegResults = {
      bm25: [],
      dense: [atScore(c1, 0.9), atScore(c1, 0.2)],
      structural: [],
    }
    expect(rrfFuse(legs, chunkMap)[0]?.cosine).toBe(0.9)
  })

  it('does not change fused, scores, or ordering (additive, no regression)', () => {
    const scored: LegResults = {
      bm25: [atScore(c1, 5), atScore(c2, 3)],
      dense: [atScore(c2, 0.9), atScore(c1, 0.1)],
      structural: [],
    }
    const zero: LegResults = {
      bm25: [at(c1), at(c2)],
      dense: [at(c2), at(c1)],
      structural: [],
    }
    const withCos = rrfFuse(scored, chunkMap)
    const withoutCos = rrfFuse(zero, chunkMap)
    // identical ranking + fused whether the raw scores are meaningful or 0 (fusion ignores value)
    expect(withCos.map((r) => r.chunk.id)).toEqual(withoutCos.map((r) => r.chunk.id))
    expect(withCos.map((r) => r.fused)).toEqual(withoutCos.map((r) => r.fused))
  })
})

describe('rrfFuse — edge + negative cases', () => {
  it('returns [] when every leg is empty', () => {
    expect(rrfFuse({ bm25: [], dense: [], structural: [] }, chunkMap)).toEqual([])
  })

  it('skips a candidate whose chunk id is unknown (no throw, defensive)', () => {
    const legs: LegResults = {
      bm25: [at('ghost.ts#nope@1-2'), at(c1)],
      dense: [],
      structural: [],
    }
    const result = rrfFuse(legs, chunkMap)
    expect(result.map((r) => r.chunk.id)).toEqual([c1])
  })

  it('deduplicates: a chunk repeated across legs appears once, contributions summed', () => {
    const legs: LegResults = {
      bm25: [at(c1)],
      dense: [at(c1)],
      structural: [at(c1)],
    }
    const result = rrfFuse(legs, chunkMap)
    expect(result.length).toBe(1)
    expect(result[0]?.fused).toBeCloseTo(0.6 / 61 + 0.4 / 61 + 0.3 / 61, 12)
  })

  it('is deterministic: equal fused scores break ties by chunk id (ascending)', () => {
    // equal weights + symmetric rank-1 ⇒ c4 and c5 tie on fused ⇒ ordered by id
    const legs: LegResults = {
      bm25: [at(c5)],
      dense: [at(c4)],
      structural: [],
    }
    const cfg = { k: 60, weights: { bm25: 1, dense: 1, structural: 1 } }
    const a = rrfFuse(legs, chunkMap, cfg).map((r) => r.chunk.id)
    const b = rrfFuse(legs, chunkMap, cfg).map((r) => r.chunk.id)
    expect(a).toEqual(b) // stable across runs
    expect(a).toEqual([c4, c5].sort()) // tie-break by id
  })

  it('uses ADR-003 defaults when no config is passed', () => {
    expect(DEFAULT_RRF_CONFIG).toEqual({
      k: 60,
      weights: { bm25: 0.6, dense: 0.4, structural: 0.3 },
    })
  })
})
