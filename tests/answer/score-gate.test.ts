import { describe, expect, it } from 'vitest'
import {
  GROUNDING_FLOOR,
  MODEL_CHEAP,
  MODEL_STRONG,
  scoreGate,
} from '../../src/answer/score-gate.js'
import type { RankedChunk } from '../../src/contracts/index.js'

// ── fixtures ────────────────────────────────────────────────────────────────
// A minimal RankedChunk factory: only path / symbol / fused matter to the gate.
function rc(path: string, symbol: string, fused: number): RankedChunk {
  return {
    chunk: {
      id: `${path}#${symbol}@1-3`,
      path,
      lang: 'ts',
      symbol,
      kind: 'function',
      span: { startLine: 1, endLine: 3 },
      code: `function ${symbol}() {}`,
      structuralRefs: { calls: [], imports: [] },
    },
    scores: { bm25: fused, dense: fused, structural: 0 },
    fused,
  }
}

const q = (resolvedQuery: string, question = resolvedQuery) => ({ question, resolvedQuery })

// The band tests are parametric around GROUNDING_FLOOR, NOT a magic number — the
// suite must survive recalibration of the floor (GAP-3) without edits.
const ABOVE = GROUNDING_FLOOR * 2
const BELOW = GROUNDING_FLOOR * 0.5

describe('scoreGate — invariants', () => {
  it('GROUNDING_FLOOR is a positive constant (so strictly-below can refuse)', () => {
    expect(GROUNDING_FLOOR).toBeGreaterThan(0)
  })
})

describe('scoreGate — signal 1: grounding -> band (refuse floor)', () => {
  it('empty retrieval -> band "refuse", groundingScore 0', () => {
    const d = scoreGate([], q('where is foo defined'))
    expect(d.band).toBe('refuse')
    expect(d.groundingScore).toBe(0)
  })

  it('top fused strictly BELOW the floor -> "refuse"', () => {
    const d = scoreGate([rc('a.ts', 'foo', BELOW)], q('where is foo defined'))
    expect(d.band).toBe('refuse')
  })

  it('top fused EXACTLY at the floor -> "answer" (strictly-below is the refuse rule)', () => {
    const d = scoreGate([rc('a.ts', 'foo', GROUNDING_FLOOR)], q('where is foo defined'))
    expect(d.band).toBe('answer')
  })

  it('top fused ABOVE the floor -> "answer"', () => {
    const d = scoreGate([rc('a.ts', 'foo', ABOVE)], q('where is foo defined'))
    expect(d.band).toBe('answer')
  })

  it('groundingScore is the TOP result fused score (not the last / not a mean)', () => {
    const d = scoreGate(
      [rc('a.ts', 'foo', ABOVE), rc('a.ts', 'bar', BELOW)],
      q('where is foo defined'),
    )
    expect(d.groundingScore).toBe(ABOVE)
  })
})

describe('scoreGate — signal 2: complexity-proxy -> tier (cheap/strong)', () => {
  it('single file + factual query -> "cheap" + haiku model', () => {
    const d = scoreGate([rc('a.ts', 'foo', ABOVE)], q('where is foo defined'))
    expect(d.tier).toBe('cheap')
    expect(d.model).toBe(MODEL_CHEAP)
  })

  it('multiple distinct files -> "strong" + sonnet model (multi-file reasoning)', () => {
    const d = scoreGate(
      [rc('a.ts', 'foo', ABOVE), rc('b.ts', 'bar', ABOVE)],
      q('where is foo defined'),
    )
    expect(d.tier).toBe('strong')
    expect(d.model).toBe(MODEL_STRONG)
  })

  it('single file BUT a reasoning-intent keyword -> "strong" (keyword overrides file count)', () => {
    const d = scoreGate([rc('a.ts', 'foo', ABOVE)], q('how does foo flow through the app'))
    expect(d.tier).toBe('strong')
  })

  it('duplicate paths (same file, many symbols) count as ONE distinct file -> "cheap"', () => {
    const d = scoreGate(
      [rc('a.ts', 'foo', ABOVE), rc('a.ts', 'bar', ABOVE), rc('a.ts', 'baz', ABOVE)],
      q('what does foo return'),
    )
    expect(d.tier).toBe('cheap')
  })

  it('keyword match is WORD-BOUNDARY: "flower" must not trigger the "flow" keyword', () => {
    const d = scoreGate([rc('a.ts', 'flower', ABOVE)], q('where is the flower variable'))
    expect(d.tier).toBe('cheap')
  })

  it('intent is read from resolvedQuery (post-L0), not the raw anaphoric question', () => {
    // question is anaphoric/cheap-looking; resolvedQuery carries the real (strong) intent
    const d = scoreGate(
      [rc('a.ts', 'foo', ABOVE)],
      q('how does the auth flow work', 'what about that'),
    )
    expect(d.tier).toBe('strong')
  })
})

describe('scoreGate — determinism + totality (negatives)', () => {
  it('is deterministic: identical inputs -> identical output', () => {
    const input = [rc('a.ts', 'foo', ABOVE), rc('b.ts', 'bar', ABOVE)]
    const first = scoreGate(input, q('how does foo flow'))
    const second = scoreGate(input, q('how does foo flow'))
    expect(first).toEqual(second)
  })

  it('never throws on empty retrieval or empty resolvedQuery', () => {
    expect(() => scoreGate([], q(''))).not.toThrow()
  })

  it('a refuse decision never carries band "answer"', () => {
    const d = scoreGate([rc('a.ts', 'foo', BELOW)], q('where is foo'))
    expect(d.band).not.toBe('answer')
  })

  it('every decision is well-formed: all four GateDecision fields present + typed', () => {
    const d = scoreGate([rc('a.ts', 'foo', ABOVE)], q('where is foo'))
    expect(typeof d.groundingScore).toBe('number')
    expect(['refuse', 'answer']).toContain(d.band)
    expect(['cheap', 'strong']).toContain(d.tier)
    expect([MODEL_CHEAP, MODEL_STRONG]).toContain(d.model)
  })
})
