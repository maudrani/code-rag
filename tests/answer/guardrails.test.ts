import { describe, expect, it } from 'vitest'
import {
  CITATION_PATTERN,
  CITE_INSTRUCTION,
  enforceCitations,
  refusalMessage,
  SYSTEM_ANSWER_ONLY,
} from '../../src/answer/guardrails.js'
import type { Citation } from '../../src/contracts/index.js'

function cite(chunkId: string): Citation {
  return { chunkId, path: 'a.ts', span: { startLine: 1, endLine: 3 }, label: chunkId }
}

describe('refusalMessage — refuse-when-empty copy', () => {
  it('returns a non-empty, stable refusal string', () => {
    const a = refusalMessage()
    const b = refusalMessage()
    expect(a.length).toBeGreaterThan(0)
    expect(a).toBe(b) // deterministic, fixed copy
  })

  it('asserts the answer is not in the provided code (the refuse guardrail)', () => {
    expect(refusalMessage().toLowerCase()).toContain('provided code')
  })
})

describe('policy strings — answer-only-from-context + cite instruction', () => {
  it('SYSTEM_ANSWER_ONLY forbids outside knowledge', () => {
    expect(SYSTEM_ANSWER_ONLY.length).toBeGreaterThan(0)
    expect(SYSTEM_ANSWER_ONLY.toLowerCase()).toContain('only')
  })

  it('CITE_INSTRUCTION documents the SAME [id] marker format the checker parses', () => {
    expect(CITE_INSTRUCTION).toContain('[')
    // a sample marker must round-trip through CITATION_PATTERN
    const sample = 'see [a.ts#foo@1-3]'
    expect([...sample.matchAll(CITATION_PATTERN)][0]?.[1]).toBe('a.ts#foo@1-3')
  })
})

describe('enforceCitations — citation enforcement', () => {
  const citations = [cite('a.ts#foo@1-3'), cite('b.ts#bar@4-9')]

  it('answer citing a real id -> ok=true, citedIds lists it', () => {
    const r = enforceCitations('foo is defined here [a.ts#foo@1-3].', citations)
    expect(r.ok).toBe(true)
    expect(r.citedIds).toContain('a.ts#foo@1-3')
    expect(r.unknownIds).toEqual([])
  })

  it('multiple markers, all real -> ok=true, citedIds has each unique id', () => {
    const r = enforceCitations('[a.ts#foo@1-3] calls [b.ts#bar@4-9]', citations)
    expect(r.ok).toBe(true)
    expect(r.citedIds.sort()).toEqual(['a.ts#foo@1-3', 'b.ts#bar@4-9'])
  })

  it('same real id cited twice -> ok=true, deduped citedIds', () => {
    const r = enforceCitations('[a.ts#foo@1-3] and again [a.ts#foo@1-3]', citations)
    expect(r.ok).toBe(true)
    expect(r.citedIds).toEqual(['a.ts#foo@1-3'])
  })

  it('answer with NO marker -> ok=false (uncited)', () => {
    const r = enforceCitations('foo is a function that returns a number.', citations)
    expect(r.ok).toBe(false)
    expect(r.citedIds).toEqual([])
  })

  it('answer citing an id NOT in citations -> ok=false, unknownIds lists it', () => {
    const r = enforceCitations('per [c.ts#ghost@1-1] it works', citations)
    expect(r.ok).toBe(false)
    expect(r.unknownIds).toEqual(['c.ts#ghost@1-1'])
  })

  it('one real + one invented id -> ok=false, only the invented in unknownIds', () => {
    const r = enforceCitations('[a.ts#foo@1-3] then [x.ts#nope@9-9]', citations)
    expect(r.ok).toBe(false)
    expect(r.citedIds).toEqual(['a.ts#foo@1-3'])
    expect(r.unknownIds).toEqual(['x.ts#nope@9-9'])
  })

  it('empty citations[] + a marker -> ok=false (every marker is unknown)', () => {
    const r = enforceCitations('see [a.ts#foo@1-3]', [])
    expect(r.ok).toBe(false)
    expect(r.unknownIds).toEqual(['a.ts#foo@1-3'])
  })

  it('marker id is parsed clean of surrounding prose/punctuation', () => {
    const r = enforceCitations('(see [a.ts#foo@1-3]).', citations)
    expect(r.citedIds).toEqual(['a.ts#foo@1-3']) // no trailing ')' or '.'
  })
})

describe('enforceCitations — negatives / totality', () => {
  it('does NOT return ok=true for zero markers', () => {
    expect(enforceCitations('no citations at all', [cite('a.ts#foo@1-3')]).ok).toBe(false)
  })

  it('does NOT accept a hallucinated id (not in citations)', () => {
    expect(enforceCitations('[made.up#id@1-1]', [cite('a.ts#foo@1-3')]).ok).toBe(false)
  })

  it('does NOT throw on empty text or empty citations', () => {
    expect(() => enforceCitations('', [])).not.toThrow()
  })

  it('refusalMessage does NOT leak chunk content (fixed copy, no interpolation)', () => {
    expect(refusalMessage()).not.toContain('function')
  })
})
