/**
 * NL->symbol capture — whole-suite tests (FTR-22, TKT-207).
 *
 * extractQuerySymbols is the generous front-end: it captures candidate symbol tokens
 * (identifiers, qualified `A.b`, method() calls, slash-paths) from a natural-language query.
 * Precision is NOT its job — resolveDefinitions filters the candidates against the real corpus
 * symbol table (structural.test.ts). isCodeShaped gates the short-name resolution fallback.
 * Pure + deterministic (no LLM): peripheral routing/query-shape.ts shape regexes, EXTENDED
 * from a boolean classifier to a capturing one (the capture is novel for us).
 */
import { describe, expect, it } from 'vitest'
import { extractQuerySymbols, isCodeShaped, shortNameOf } from '../../src/retrieve/symbols.js'

describe('extractQuerySymbols — capture (generous; resolver filters)', () => {
  it('captures a camelCase identifier (the reproduced bug shape)', () => {
    expect(extractQuerySymbols('how does useChatStream work')).toContain('useChatStream')
  })

  it('captures a PascalCase identifier', () => {
    expect(extractQuerySymbols('explain the UseChatStream interface')).toContain('UseChatStream')
  })

  it('captures a method() call without the parens', () => {
    const out = extractQuerySymbols('what does getUserById() return')
    expect(out).toContain('getUserById')
    expect(out).not.toContain('getUserById()')
  })

  it('captures a dotted/qualified symbol as one token', () => {
    expect(extractQuerySymbols('how does Auth.login work')).toContain('Auth.login')
  })

  it('captures a slash-path as one token', () => {
    expect(extractQuerySymbols('open src/retrieve/fuse and read it')).toContain('src/retrieve/fuse')
  })

  it('captures a snake_case identifier', () => {
    expect(extractQuerySymbols('where is build_index defined')).toContain('build_index')
  })

  it('preserves order and deduplicates', () => {
    const out = extractQuerySymbols('rrfFuse then rrfFuse again')
    expect(out.filter((t) => t === 'rrfFuse')).toHaveLength(1)
    expect(out.indexOf('rrfFuse')).toBeLessThan(out.indexOf('again'))
  })

  it('is pure + deterministic (identical output across runs)', () => {
    const q = 'how does cosineSimilarity compare to bm25Search'
    expect(extractQuerySymbols(q)).toEqual(extractQuerySymbols(q))
  })

  it('returns [] for an empty / symbol-free query', () => {
    expect(extractQuerySymbols('')).toEqual([])
    expect(extractQuerySymbols('   ')).toEqual([])
    expect(extractQuerySymbols('!!! ??? ...')).toEqual([])
  })

  it('does not capture a numeric literal as a symbol', () => {
    expect(extractQuerySymbols('upgrade to 2.0 now')).not.toContain('2.0')
  })
})

describe('isCodeShaped — gates the short-name resolution fallback', () => {
  it.each([
    ['useChatStream', true], // camelCase hump
    ['UseChatStream', true], // PascalCase hump
    ['VectorStore', true], // PascalCase hump
    ['Auth.login', true], // dotted
    ['src/retrieve/fuse', true], // slash path
    ['snake_case', true], // underscore
    ['retrieve', false], // plain lowercase word — resolves ONLY by exact symbol match
    ['how', false],
    ['API', false], // all-caps acronym — no lower->upper hump (exact match still works)
  ])('isCodeShaped(%s) === %s', (token, expected) => {
    expect(isCodeShaped(token)).toBe(expected)
  })
})

describe('shortNameOf — last descriptor of a (possibly qualified) symbol', () => {
  it('returns the last dotted segment', () => {
    expect(shortNameOf('Auth.login')).toBe('login')
    expect(shortNameOf('a.b.c')).toBe('c')
  })

  it('returns the symbol unchanged when unqualified', () => {
    expect(shortNameOf('useChatStream')).toBe('useChatStream')
  })
})
