/**
 * L3/L4 BM25 leg — whole-suite tests (ADR-003).
 *
 * Real FTS5 over an in-memory SQLite DB (no mocks — you cannot meaningfully mock BM25 ranking).
 * Covers the pure helpers (identifier splitting, query sanitisation) parametrically, plus the
 * indexed search behaviour: exact-symbol match, sub-token match via splitting, symbol weighting,
 * body-only match, determinism, limit, fusion-readiness, and the injection/empty edge + negatives.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Bm25Index,
  ftsCreateTableSql,
  ftsSymbolText,
  splitIdentifiers,
  toFtsQuery,
} from '../../src/index/bm25.js'
import { rrfFuse } from '../../src/retrieve/fuse.js'
import {
  allChunks,
  bm25SearchChunk,
  chunkMap,
  searchIndexChunk,
  vectorStoreChunk,
} from '../retrieve/fixtures/chunks.js'

describe.each([
  { input: 'getUserById', expected: 'get user by id' },
  { input: 'JWT_SECRET', expected: 'jwt secret' },
  { input: 'HTTPServer', expected: 'http server' },
  { input: 'VectorStore', expected: 'vector store' },
  { input: 'searchIndex', expected: 'search index' },
  { input: 'snake_case_name', expected: 'snake case name' },
  { input: 'a.b.c', expected: 'a b c' },
  { input: 'plain', expected: 'plain' },
  { input: '', expected: '' },
])('splitIdentifiers', ({ input, expected }) => {
  it(`${input || '(empty)'} → ${expected || '(empty)'}`, () => {
    expect(splitIdentifiers(input)).toBe(expected)
  })
})

describe('toFtsQuery', () => {
  it('quotes terms and OR-joins, including identifier splits', () => {
    const q = toFtsQuery('getUserById')
    expect(q).toContain('"getuserbyid"')
    expect(q).toContain('"user"')
    expect(q).toContain(' OR ')
  })

  it('returns empty string for empty / punctuation-only queries', () => {
    expect(toFtsQuery('')).toBe('')
    expect(toFtsQuery('   ')).toBe('')
    expect(toFtsQuery('!!! ??? ...')).toBe('')
  })

  it('strips FTS5 special characters — injection-proof, every term quoted', () => {
    const q = toFtsQuery('"; DROP TABLE x; -- *')
    expect(q).not.toContain('DROP TABLE') // never a raw phrase / operator
    expect(q).toContain('"drop"')
    expect(q).toContain('"table"')
    for (const token of q.split(' OR ')) expect(token).toMatch(/^"[a-z0-9]+"$/)
  })
})

// B4 (adopt peripheral FTR-032 escapeFtsQuery): tokenize on Unicode letters/digits, not ASCII —
// so CJK/accented identifiers survive instead of being silently dropped by `[A-Za-z0-9_]`.
describe('toFtsQuery — Unicode identifiers survive tokenization (FTR-032)', () => {
  it('keeps an accented identifier (not dropped / truncated to ASCII)', () => {
    expect(toFtsQuery('café')).toContain('"café"')
  })

  it('keeps a CJK term', () => {
    expect(toFtsQuery('日本語')).toContain('"日本語"')
  })

  it('splits an accented snake_case identifier and keeps every part', () => {
    const q = toFtsQuery('über_token')
    expect(q).toContain('"über_token"') // `_` kept in the token class → snake_case stays whole first
    expect(q).toContain('"über"')
    expect(q).toContain('"token"')
  })

  it('still strips FTS5 operators around a non-ASCII term (injection-safe)', () => {
    const q = toFtsQuery('"café"; DROP')
    expect(q).toContain('"café"')
    expect(q).toContain('"drop"')
    expect(q).not.toContain('DROP TABLE')
  })
})

// schema-drift remediation: the FTS5 DDL + the index-time symbol augmentation are derived from ONE
// set of helpers that both Bm25Index and SqliteStore consume (so hardening one can't diverge).
describe('shared FTS5 schema helpers (single-source — schema-drift guard)', () => {
  it('ftsCreateTableSql emits the fixed columns + unicode61 tokenizer; IF NOT EXISTS is opt-in', () => {
    expect(ftsCreateTableSql()).toContain('chunk_id UNINDEXED, symbol, body')
    expect(ftsCreateTableSql()).toContain("tokenize = 'unicode61'")
    expect(ftsCreateTableSql()).not.toContain('IF NOT EXISTS')
    expect(ftsCreateTableSql(true)).toContain('IF NOT EXISTS')
  })

  it('ftsSymbolText augments a symbol with its split sub-tokens (index-time partial-word match)', () => {
    expect(ftsSymbolText('getUserById')).toBe('getUserById get user by id')
  })
})

describe('Bm25Index — index + search', () => {
  let index: Bm25Index
  beforeEach(() => {
    index = new Bm25Index()
    index.index(allChunks)
  })
  afterEach(() => index.close())

  it('finds a chunk by its exact symbol (best match first)', () => {
    const results = index.search('searchIndex', 10)
    expect(results.map((r) => r.chunkId)).toContain(searchIndexChunk.id)
    expect(results[0]?.chunkId).toBe(searchIndexChunk.id)
  })

  it('matches a partial sub-token via identifier splitting (vector store → VectorStore)', () => {
    const ids = index.search('vector store', 10).map((r) => r.chunkId)
    expect(ids).toContain(vectorStoreChunk.id)
  })

  it('returns LegCandidate shape with positive scores, ranked best-first', () => {
    const results = index.search('embedQuery', 10)
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect(typeof r.chunkId).toBe('string')
      expect(r.score).toBeGreaterThan(0)
    }
    const scores = results.map((r) => r.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a)) // desc
  })

  it('weights symbol matches above body-only matches', () => {
    // "bm25Search" is the SYMBOL of bm25SearchChunk and appears in searchIndex's BODY
    const ids = index.search('bm25Search', 10).map((r) => r.chunkId)
    expect(ids).toContain(bm25SearchChunk.id)
    expect(ids).toContain(searchIndexChunk.id)
    expect(ids.indexOf(bm25SearchChunk.id)).toBeLessThan(ids.indexOf(searchIndexChunk.id))
  })

  it('matches a term that appears only in the code body (denseSearch is not a symbol)', () => {
    const ids = index.search('denseSearch', 10).map((r) => r.chunkId)
    expect(ids).toContain(searchIndexChunk.id)
  })

  it('respects the candidate limit', () => {
    expect(index.search('search', 1).length).toBeLessThanOrEqual(1)
  })

  it('is deterministic — same query yields identical results', () => {
    expect(index.search('rrfFuse', 10)).toEqual(index.search('rrfFuse', 10))
  })

  it('produces fusion-ready output (feeds rrfFuse as the bm25 leg)', () => {
    const bm25 = index.search('searchIndex', 10)
    const fused = rrfFuse({ bm25, dense: [], structural: [] }, chunkMap)
    expect(fused.length).toBeGreaterThan(0)
    expect(fused[0]?.scores.bm25).toBeGreaterThan(0)
    expect(fused[0]?.scores.dense).toBe(0)
  })
})

describe('Bm25Index — edge + negative cases', () => {
  let index: Bm25Index
  beforeEach(() => {
    index = new Bm25Index()
    index.index(allChunks)
  })
  afterEach(() => index.close())

  it('returns [] for an empty query', () => {
    expect(index.search('', 10)).toEqual([])
  })

  it('returns [] for a punctuation-only query', () => {
    expect(index.search('!!! ***', 10)).toEqual([])
  })

  it('does not throw on FTS5 special characters (injection-proof)', () => {
    expect(() => index.search('"; DROP TABLE chunks_fts; --', 10)).not.toThrow()
  })

  it('returns [] for a term that matches nothing', () => {
    expect(index.search('zzzznotarealtoken', 10)).toEqual([])
  })

  it('returns [] when searching an empty index', () => {
    const empty = new Bm25Index()
    expect(empty.search('searchIndex', 10)).toEqual([])
    empty.close()
  })

  it('honours configurable column weights (extreme symbol weight → symbol match first)', () => {
    const heavy = new Bm25Index({ symbolWeight: 50, codeWeight: 1 })
    heavy.index(allChunks)
    expect(heavy.search('bm25Search', 10)[0]?.chunkId).toBe(bm25SearchChunk.id)
    heavy.close()
  })
})
