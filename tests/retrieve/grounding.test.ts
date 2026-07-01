/**
 * Semantic grounding helper — topCosine unit tests (FTR-55, offline/deterministic).
 *
 * topCosine is the semantic-grounding score the answer gate thresholds against COS_FLOOR: the
 * strongest dense cosine among the top-N hits, treating an ABSENT cosine (bm25/structural-only hit)
 * as no signal — never as 0 (the TKT-337 rule). The floor's VALUE is tuned on the live corpus
 * (cos-floor.eval.test.ts, RUN_SLOW); this file pins the pure derivation.
 */
import { describe, expect, it } from 'vitest'
import type { Chunk } from '../../src/contracts/chunk.js'
import type { RankedChunk } from '../../src/contracts/retrieval.js'
import { topCosine } from '../../src/retrieve/grounding.js'

const chunk = (id: string): Chunk => ({
  id,
  path: id,
  lang: 'ts',
  symbol: id,
  kind: 'function',
  span: { startLine: 1, endLine: 1 },
  code: '',
  structuralRefs: { calls: [], imports: [] },
})
/** a RankedChunk with an optional cosine (omit ⇒ no dense signal). */
const rc = (id: string, cosine?: number): RankedChunk => {
  const base: RankedChunk = {
    chunk: chunk(id),
    scores: { bm25: 0, dense: 0, structural: 0 },
    fused: 0,
  }
  return cosine === undefined ? base : { ...base, cosine }
}

describe('topCosine — the semantic-grounding score', () => {
  it('is the max cosine among the top-n hits', () => {
    expect(topCosine([rc('a', 0.4), rc('b', 0.9), rc('c', 0.1)])).toBe(0.9)
  })

  it('ignores hits with no dense signal (undefined ≠ 0)', () => {
    // a strong lexical-only top hit (no cosine) must not drag the semantic score to 0
    expect(topCosine([rc('a'), rc('b', 0.55)])).toBe(0.55)
  })

  it('returns 0 when NONE of the top-n hits carried a cosine (no semantic signal at all)', () => {
    expect(topCosine([rc('a'), rc('b'), rc('c')])).toBe(0)
  })

  it('respects n — a strong cosine beyond the cutoff does not count', () => {
    const results = [rc('a', 0.1), rc('b', 0.1), rc('c', 0.1), rc('d', 0.95)]
    expect(topCosine(results, 3)).toBe(0.1) // d (rank 4) excluded
    expect(topCosine(results, 4)).toBe(0.95) // widen the window ⇒ d counts
  })

  it('counts a present cosine of exactly 0 as a real (zero) signal', () => {
    expect(topCosine([rc('a', 0)])).toBe(0) // present 0, not "absent"
  })

  it('returns 0 for an empty result set (never NaN)', () => {
    expect(topCosine([])).toBe(0)
  })
})
