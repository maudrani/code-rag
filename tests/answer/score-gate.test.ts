import { describe, expect, it } from 'vitest'
import {
  GROUNDING_FLOOR,
  MODEL_CHEAP,
  MODEL_STRONG,
  scoreGate,
} from '../../src/answer/score-gate.js'
import type { RankedChunk } from '../../src/contracts/index.js'

// A minimal RankedChunk. Grounding reads chunk.symbol + chunk.code; the gate ignores
// scores/fused now (grounding = lexical overlap, tier = distinct-files + intent).
function rc(path: string, symbol: string, code = `function ${symbol}() {}`): RankedChunk {
  return {
    chunk: {
      id: `${path}#${symbol}@1-3`,
      path,
      lang: 'ts',
      symbol,
      kind: 'function',
      span: { startLine: 1, endLine: 3 },
      code,
      structuralRefs: { calls: [], imports: [] },
    },
    scores: { bm25: 0, dense: 0, structural: 0 },
    fused: 0.02,
  }
}

const q = (resolvedQuery: string, question = resolvedQuery) => ({ question, resolvedQuery })

describe('scoreGate — invariants', () => {
  it('GROUNDING_FLOOR is a fraction in (0, 1]', () => {
    expect(GROUNDING_FLOOR).toBeGreaterThan(0)
    expect(GROUNDING_FLOOR).toBeLessThanOrEqual(1)
  })
})

describe('scoreGate — signal 1: grounding -> band (lexical overlap)', () => {
  it('empty retrieval -> "refuse", groundingScore 0', () => {
    const d = scoreGate([], q('where is getUserById'))
    expect(d.band).toBe('refuse')
    expect(d.groundingScore).toBe(0)
  })

  it('query terms present in the retrieved code -> "answer"', () => {
    const d = scoreGate([rc('a.ts', 'getUserById')], q('where is getUserById defined'))
    expect(d.band).toBe('answer')
    expect(d.groundingScore).toBeGreaterThanOrEqual(GROUNDING_FLOOR)
  })

  it('off-topic query (no term in the code) -> "refuse", even with a top hit', () => {
    const d = scoreGate([rc('a.ts', 'getUserById')], q('airspeed velocity of an unladen swallow'))
    expect(d.band).toBe('refuse')
    expect(d.groundingScore).toBe(0)
  })

  it('groundingScore is the FRACTION of significant query terms present (not a rank score)', () => {
    // terms: foo, missingterm (2); code "foo function foo() {}" contains foo only -> 1/2
    const d = scoreGate([rc('a.ts', 'foo')], q('foo missingterm'))
    expect(d.groundingScore).toBeCloseTo(0.5)
  })

  it('overlap below the floor -> "refuse" (one term of many present)', () => {
    // terms: parsequery, sorts, binary, heap, quickly (5); code has parsequery -> 1/5 = 0.2
    const d = scoreGate([rc('a.ts', 'parseQuery')], q('parseQuery sorts binary heap quickly'))
    expect(d.band).toBe('refuse')
  })

  it('overlap above the floor -> "answer"', () => {
    // terms: parsequery, trimmed, value (3); code has parsequery + trimmed -> 2/3
    const d = scoreGate(
      [rc('a.ts', 'parseQuery', 'function parseQuery() { return trimmed }')],
      q('parseQuery trimmed value'),
    )
    expect(d.band).toBe('answer')
  })

  it('a query of only stop/short words -> groundingScore 0 -> "refuse"', () => {
    const d = scoreGate([rc('a.ts', 'foo')], q('how does it'))
    expect(d.groundingScore).toBe(0)
    expect(d.band).toBe('refuse')
  })
})

describe('scoreGate — signal 2: complexity-proxy -> tier (cheap/strong)', () => {
  it('single file + factual query -> "cheap" + haiku', () => {
    const d = scoreGate([rc('a.ts', 'foo')], q('where is foo defined'))
    expect(d.tier).toBe('cheap')
    expect(d.model).toBe(MODEL_CHEAP)
  })

  it('multiple distinct files -> "strong" + sonnet (multi-file reasoning)', () => {
    const d = scoreGate([rc('a.ts', 'foo'), rc('b.ts', 'bar')], q('where is foo defined'))
    expect(d.tier).toBe('strong')
    expect(d.model).toBe(MODEL_STRONG)
  })

  it('single file BUT a reasoning-intent keyword -> "strong"', () => {
    const d = scoreGate([rc('a.ts', 'foo')], q('how does foo flow through the app'))
    expect(d.tier).toBe('strong')
  })

  it('duplicate paths count as ONE distinct file -> "cheap"', () => {
    const d = scoreGate(
      [rc('a.ts', 'foo'), rc('a.ts', 'bar'), rc('a.ts', 'baz')],
      q('what does foo return'),
    )
    expect(d.tier).toBe('cheap')
  })

  it('intent is WORD-BOUNDARY: "flower" must not trigger the "flow" keyword', () => {
    const d = scoreGate([rc('a.ts', 'flower')], q('where is the flower variable'))
    expect(d.tier).toBe('cheap')
  })

  it('intent is read from resolvedQuery (post-L0), not the raw anaphoric question', () => {
    const d = scoreGate([rc('a.ts', 'foo')], q('how does the auth flow work', 'what about that'))
    expect(d.tier).toBe('strong')
  })
})

describe('scoreGate — determinism + totality (negatives)', () => {
  it('is deterministic: identical inputs -> identical output', () => {
    const input = [rc('a.ts', 'foo'), rc('b.ts', 'bar')]
    expect(scoreGate(input, q('how does foo flow'))).toEqual(
      scoreGate(input, q('how does foo flow')),
    )
  })

  it('never throws on empty retrieval or empty resolvedQuery', () => {
    expect(() => scoreGate([], q(''))).not.toThrow()
  })

  it('a refuse decision never carries band "answer"', () => {
    const d = scoreGate([rc('a.ts', 'foo')], q('airspeed velocity unladen swallow'))
    expect(d.band).not.toBe('answer')
  })

  it('every decision is well-formed: all four GateDecision fields present + typed', () => {
    const d = scoreGate([rc('a.ts', 'foo')], q('where is foo'))
    expect(typeof d.groundingScore).toBe('number')
    expect(['refuse', 'answer']).toContain(d.band)
    expect(['cheap', 'strong']).toContain(d.tier)
    expect([MODEL_CHEAP, MODEL_STRONG]).toContain(d.model)
  })
})
