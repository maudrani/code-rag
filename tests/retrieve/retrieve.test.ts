/**
 * L4 retrieve wiring + structural seeding — whole-suite tests (ADR-003, TKT-206).
 *
 * Covers deriveSeeds (BM25/dense hits ∪ exact symbol-name match) and retrieve (the parallel
 * composition): leg fusion, the parallel-not-cascade invariant at the retrieve level, dense
 * optionality, candidate-pool sizing, k slicing, determinism, contract conformance, + negatives.
 */
import { describe, expect, it, vi } from 'vitest'
import { Bm25Index } from '../../src/index/bm25.js'
import type { LegCandidate } from '../../src/retrieve/fuse.js'
import { type LexicalLeg, retrieve } from '../../src/retrieve/retrieve.js'
import { deriveSeeds } from '../../src/retrieve/seed.js'
import { buildStructuralIndex } from '../../src/retrieve/structural.js'
import {
  allChunks,
  bm25SearchChunk,
  chunkMap,
  rrfFuseChunk,
  searchIndexChunk,
  vectorStoreChunk,
} from './fixtures/chunks.js'

const structural = buildStructuralIndex(allChunks)

const leg = (candidates: LegCandidate[]): LexicalLeg => ({ search: () => candidates })
const emptyLeg: LexicalLeg = { search: () => [] }

describe('deriveSeeds', () => {
  it('includes every direct-hit id', () => {
    const seeds = deriveSeeds('anything', [bm25SearchChunk.id, vectorStoreChunk.id], structural)
    expect(seeds).toContain(bm25SearchChunk.id)
    expect(seeds).toContain(vectorStoreChunk.id)
  })

  it('adds the defining chunk of an exact symbol-name match in the query', () => {
    // query names searchIndex directly → seed its chunk even with no direct hits
    const seeds = deriveSeeds('how does searchIndex work', [], structural)
    expect(seeds).toContain(searchIndexChunk.id)
  })

  it('matches symbols EXACTLY (a partial token does not seed)', () => {
    const seeds = deriveSeeds('search', [], structural) // "search" != symbol "searchIndex"
    expect(seeds).not.toContain(searchIndexChunk.id)
  })

  it('deduplicates a direct hit that is also a symbol-name match', () => {
    const seeds = deriveSeeds('searchIndex', [searchIndexChunk.id], structural)
    expect(seeds.filter((s) => s === searchIndexChunk.id)).toHaveLength(1)
  })

  it('adds nothing for a query token that is not a corpus symbol', () => {
    expect(deriveSeeds('zzznotasymbol', [], structural)).toEqual([])
  })
})

describe('retrieve — parallel hybrid composition', () => {
  it('fuses BM25 direct hits with their structural neighbours', async () => {
    const bm25 = new Bm25Index()
    bm25.index(allChunks)
    const result = await retrieve('searchIndex', { bm25, structural, chunks: chunkMap })
    const ids = result.map((r) => r.chunk.id)
    expect(ids).toContain(searchIndexChunk.id) // BM25 direct hit
    expect(ids).toContain(rrfFuseChunk.id) // structural-only neighbour (not a BM25 hit), fused in
    bm25.close()
  })

  it('does NOT cascade: empty BM25 still returns structural results via symbol-name seeding', async () => {
    const result = await retrieve('searchIndex', { bm25: emptyLeg, structural, chunks: chunkMap })
    expect(result.length).toBeGreaterThan(0) // bm25 empty did not gate the structural leg
    for (const r of result) expect(r.scores.bm25).toBe(0)
  })

  it('fuses the dense leg when present (dense contribution shows in scores)', async () => {
    const dense = leg([{ chunkId: vectorStoreChunk.id, score: 0.9 }])
    const result = await retrieve('searchIndex', {
      bm25: emptyLeg,
      structural,
      chunks: chunkMap,
      dense,
    })
    const byId = new Map(result.map((r) => [r.chunk.id, r]))
    expect(byId.get(vectorStoreChunk.id)?.scores.dense).toBeGreaterThan(0)
  })

  it('returns a contract-conformant RetrievalResult sorted desc by fused', async () => {
    const bm25 = new Bm25Index()
    bm25.index(allChunks)
    const result = await retrieve('searchIndex embedQuery', { bm25, structural, chunks: chunkMap })
    for (const r of result) {
      expect(r.chunk).toBeDefined()
      expect(r.scores).toHaveProperty('bm25')
      expect(r.scores).toHaveProperty('dense')
      expect(r.scores).toHaveProperty('structural')
      expect(typeof r.fused).toBe('number')
    }
    const fused = result.map((r) => r.fused)
    expect(fused).toEqual([...fused].sort((a, b) => b - a))
    bm25.close()
  })

  it('slices to k', async () => {
    const bm25 = new Bm25Index()
    bm25.index(allChunks)
    const result = await retrieve(
      'search index embed bm25 fuse vector',
      { bm25, structural, chunks: chunkMap },
      { k: 2 },
    )
    expect(result.length).toBeLessThanOrEqual(2)
    bm25.close()
  })

  it('requests a candidate pool of k * candidateMultiplier per leg', async () => {
    const search = vi.fn((_q: string, _limit: number): LegCandidate[] => [])
    await retrieve(
      'x',
      { bm25: { search }, structural, chunks: chunkMap },
      { k: 4, candidateMultiplier: 3 },
    )
    expect(search).toHaveBeenCalledWith('x', 12)
  })

  it('is deterministic — same query yields identical results', async () => {
    const bm25 = new Bm25Index()
    bm25.index(allChunks)
    const a = await retrieve('searchIndex', { bm25, structural, chunks: chunkMap })
    const b = await retrieve('searchIndex', { bm25, structural, chunks: chunkMap })
    expect(a).toEqual(b)
    bm25.close()
  })
})

describe('retrieve — edge + negative cases', () => {
  it('returns [] for a query that matches nothing (no leg has candidates)', async () => {
    const result = await retrieve('zzznotasymbol', { bm25: emptyLeg, structural, chunks: chunkMap })
    expect(result).toEqual([])
  })

  it('returns [] over an empty corpus', async () => {
    const emptyBm25 = new Bm25Index()
    const emptyStructural = buildStructuralIndex([])
    const result = await retrieve('searchIndex', {
      bm25: emptyBm25,
      structural: emptyStructural,
      chunks: new Map(),
    })
    expect(result).toEqual([])
    emptyBm25.close()
  })

  it('does not throw on an empty query', async () => {
    await expect(retrieve('', { bm25: emptyLeg, structural, chunks: chunkMap })).resolves.toEqual(
      [],
    )
  })
})

describe('retrieve — leg isolation (C2: one-leg-down is recoverable)', () => {
  it('isolates a synchronously-throwing dense leg — degrades to [] without sinking BM25 + structural', async () => {
    // the sharp case: a 768-vs-384 dim mismatch makes cosineSimilarity throw. The dense leg's throw
    // must NOT reject the whole retrieve (peripheral vector-adapter NT-10 — one-leg-down recoverable).
    const throwingDense: LexicalLeg = {
      search: () => {
        throw new Error('cosineSimilarity: dimension mismatch 768 vs 384.')
      },
    }
    const bm25 = new Bm25Index()
    bm25.index(allChunks)
    const result = await retrieve('searchIndex', {
      bm25,
      structural,
      chunks: chunkMap,
      dense: throwingDense,
    })
    expect(result.length).toBeGreaterThan(0)
    expect(result.some((r) => r.chunk.id === searchIndexChunk.id)).toBe(true) // BM25 still carried it
    for (const r of result) expect(r.scores.dense).toBe(0) // dense degraded to []
    bm25.close()
  })

  it('isolates an asynchronously-rejecting dense leg (the real ONNX/jina failure path)', async () => {
    const rejectingDense: LexicalLeg = {
      search: async () => {
        throw new Error('dimension mismatch')
      },
    }
    const bm25 = new Bm25Index()
    bm25.index(allChunks)
    const result = await retrieve('searchIndex', {
      bm25,
      structural,
      chunks: chunkMap,
      dense: rejectingDense,
    })
    expect(result.length).toBeGreaterThan(0)
    for (const r of result) expect(r.scores.dense).toBe(0)
    bm25.close()
  })
})
