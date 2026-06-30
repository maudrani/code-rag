import { describe, expect, it } from 'vitest'
import { K_PROXY, MULTI_FILE_THRESHOLD, scoreGate } from '../../src/answer/score-gate.js'
import type { RankedChunk } from '../../src/contracts/index.js'
import { TIER_CASES } from './fixtures/tier-cases.js'

// Build a retrieval profile with the given distinct file paths (tier reads only chunk.path
// over the top K_PROXY results). Symbols/scores are irrelevant to the tier proxy.
function profile(files: string[]): RankedChunk[] {
  return files.map((path, i) => ({
    chunk: {
      id: `${path}#s${i}@1-2`,
      path,
      lang: 'ts',
      symbol: `s${i}`,
      kind: 'function',
      span: { startLine: 1, endLine: 2 },
      code: `function s${i}() {}`,
      structuralRefs: { calls: [], imports: [] },
    },
    scores: { bm25: 0, dense: 0, structural: 0 },
    fused: 0.02,
  }))
}

const tierOf = (query: string, files: string[]): 'cheap' | 'strong' =>
  scoreGate(profile(files), { question: query, resolvedQuery: query }).tier

// ── SC-5: the committed fixture — cheap is LIVE and strong is correct ───────────
describe('tier-calibration — the committed fixture (SC-5)', () => {
  const cheapCases = TIER_CASES.filter((c) => c.expect === 'cheap')
  const strongCases = TIER_CASES.filter((c) => c.expect === 'strong')

  it('routes EVERY labeled case to its expected tier', () => {
    const misrouted = TIER_CASES.filter((c) => tierOf(c.query, c.files) !== c.expect).map((c) => ({
      query: c.query,
      expected: c.expect,
      got: tierOf(c.query, c.files),
      why: c.why,
    }))
    expect(misrouted).toEqual([])
  })

  it('cheap-recall > 0 — cheap is LIVE, not vestigial (the dogfood fix; non-vacuous)', () => {
    // The pre-fix all-strong gate scores 0 here -> this assertion is what fails on regression.
    const cheapHits = cheapCases.filter((c) => tierOf(c.query, c.files) === 'cheap').length
    expect(cheapCases.length).toBeGreaterThan(0)
    expect(cheapHits).toBe(cheapCases.length)
  })

  it('strong-recall > 0 — genuine reasoning still escalates (non-vacuous the other way)', () => {
    // An all-cheap gate would score 0 here.
    const strongHits = strongCases.filter((c) => tierOf(c.query, c.files) === 'strong').length
    expect(strongCases.length).toBeGreaterThan(0)
    expect(strongHits).toBe(strongCases.length)
  })

  it('the dogfood failure is fixed: a lookup with a multi-file spread stays cheap', () => {
    // "which model id is the cheap tier" over 3 files -> cheap (was strong pre-fix).
    expect(tierOf('which model id is the cheap tier', ['a.ts', 'b.ts', 'c.ts'])).toBe('cheap')
  })
})

// ── SC-6: the raised file-count threshold (the breadth backstop) ────────────────
describe('tier-calibration — breadth threshold (SC-6)', () => {
  it('was raised above the buggy value of 2 (distinct-files-in-top-K is noisy)', () => {
    expect(MULTI_FILE_THRESHOLD).toBeGreaterThan(2)
    expect(MULTI_FILE_THRESHOLD).toBeLessThanOrEqual(K_PROXY)
  })

  it('a NO-intent query just below the threshold -> cheap (backstop does not over-fire)', () => {
    const files = Array.from({ length: MULTI_FILE_THRESHOLD - 1 }, (_, i) => `f${i}.ts`)
    expect(tierOf('configuration handlers pipeline middleware', files)).toBe('cheap')
  })

  it('a NO-intent query at/above the threshold -> strong (genuine breadth)', () => {
    const files = Array.from({ length: MULTI_FILE_THRESHOLD }, (_, i) => `f${i}.ts`)
    expect(tierOf('configuration handlers pipeline middleware', files)).toBe('strong')
  })

  it('NON-VACUITY: reverting the threshold to 2 would misroute a 2-file lookup to strong', () => {
    // With the OLD threshold==2 AND no cheap-intent override, this case went strong.
    // Today the cheap-intent override keeps it cheap regardless of spread -> proves the fix
    // is the intent counter-signal, not merely a higher number.
    expect(tierOf('where is foo defined', ['a.ts', 'b.ts'])).toBe('cheap')
  })
})
