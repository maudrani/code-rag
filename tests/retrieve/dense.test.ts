/**
 * Dense semantic leg — whole-suite tests (ADR-003, TKT-204).
 *
 * The dense leg embeds the query and ranks stored chunk vectors by brute-force cosine. Tests cover
 * the pure cosine maths (hand-checked), top-k ranking + deterministic tie-break, the empty/edge
 * paths, the dimension-mismatch guard, and the real-leg composition into retrieve() (proving it
 * slots into deps.dense with NO wiring change). A deterministic fake Embedder keeps it model-free.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Embedder } from '../../src/index/embed.js'
import { cosineSimilarity, createDenseLeg } from '../../src/retrieve/dense.js'
import type { LexicalLeg } from '../../src/retrieve/retrieve.js'
import { retrieve } from '../../src/retrieve/retrieve.js'
import { buildStructuralIndex } from '../../src/retrieve/structural.js'
import { allChunks, chunkMap, vectorStoreChunk } from './fixtures/chunks.js'

/** A deterministic Embedder: query text → fixed vector (no model). */
function makeEmbedder(table: Record<string, readonly number[]>, dimension: number): Embedder {
  return {
    dimension,
    embed: vi.fn(async (texts: readonly string[]) =>
      texts.map((t) => Float32Array.from(table[t] ?? new Array(dimension).fill(0))),
    ),
  }
}

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity(new Float32Array([1, 2, 3]), new Float32Array([1, 2, 3]))).toBeCloseTo(
      1,
      6,
    )
  })

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6)
  })

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(-1, 6)
  })

  it('matches a hand-computed value (1/√2)', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 1]))).toBeCloseTo(
      1 / Math.SQRT2,
      6,
    )
  })

  it('returns 0 (not NaN) when either vector is all-zero', () => {
    const c = cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))
    expect(c).toBe(0)
    expect(Number.isNaN(c)).toBe(false)
  })

  it('throws on a dimension mismatch', () => {
    expect(() => cosineSimilarity(new Float32Array([1, 0, 0]), new Float32Array([1, 0]))).toThrow(
      /dimension/i,
    )
  })
})

describe('createDenseLeg.search', () => {
  const table = { q1: [1, 0, 0] }
  const vectors = [
    { chunkId: 'c1', vector: new Float32Array([1, 0, 0]) }, // cosine 1 vs q1
    { chunkId: 'c2', vector: new Float32Array([0, 1, 0]) }, // cosine 0 vs q1
    { chunkId: 'c3', vector: new Float32Array([0.9, 0.1, 0]) }, // ~0.994 vs q1
  ]

  it('ranks stored vectors by cosine to the query, best-first, as LegCandidate[]', async () => {
    const leg = createDenseLeg({ embedder: makeEmbedder(table, 3), vectors })
    const out = await leg.search('q1', 10)
    expect(out.map((c) => c.chunkId)).toEqual(['c1', 'c3', 'c2'])
    expect(out[0]).toMatchObject({ chunkId: 'c1' })
    expect(out[0]?.score).toBeCloseTo(1, 6)
  })

  it('slices to the requested limit', async () => {
    const leg = createDenseLeg({ embedder: makeEmbedder(table, 3), vectors })
    expect(await leg.search('q1', 2)).toHaveLength(2)
  })

  it('breaks ties by chunkId ascending (deterministic)', async () => {
    const tied = [
      { chunkId: 'b', vector: new Float32Array([0, 1, 0]) },
      { chunkId: 'a', vector: new Float32Array([0, 1, 0]) },
    ]
    const leg = createDenseLeg({ embedder: makeEmbedder({ q: [0, 1, 0] }, 3), vectors: tied })
    expect((await leg.search('q', 10)).map((c) => c.chunkId)).toEqual(['a', 'b'])
  })

  it('is deterministic — same query yields identical results', async () => {
    const leg = createDenseLeg({ embedder: makeEmbedder(table, 3), vectors })
    expect(await leg.search('q1', 10)).toEqual(await leg.search('q1', 10))
  })

  it('returns [] for an empty/whitespace query WITHOUT embedding', async () => {
    const embedder = makeEmbedder(table, 3)
    const leg = createDenseLeg({ embedder, vectors })
    expect(await leg.search('   ', 10)).toEqual([])
    expect(embedder.embed).not.toHaveBeenCalled()
  })

  it('returns [] over an empty corpus', async () => {
    const leg = createDenseLeg({ embedder: makeEmbedder(table, 3), vectors: [] })
    expect(await leg.search('q1', 10)).toEqual([])
  })

  it('returns [] for a non-positive limit', async () => {
    const leg = createDenseLeg({ embedder: makeEmbedder(table, 3), vectors })
    expect(await leg.search('q1', 0)).toEqual([])
  })

  it('throws an explicit error on a query/stored dimension mismatch', async () => {
    // embedder emits dim 4; stored vectors are dim 3
    const leg = createDenseLeg({ embedder: makeEmbedder({ q1: [1, 0, 0, 0] }, 4), vectors })
    await expect(leg.search('q1', 10)).rejects.toThrow(/dimension/i)
  })
})

describe('createDenseLeg — composition into retrieve() (zero wiring change)', () => {
  it('slots into deps.dense and surfaces a dense score after fusion', async () => {
    const structural = buildStructuralIndex(allChunks)
    const dense: LexicalLeg = createDenseLeg({
      embedder: makeEmbedder({ semantic: [1, 0, 0] }, 3),
      vectors: [{ chunkId: vectorStoreChunk.id, vector: new Float32Array([1, 0, 0]) }],
    })
    const emptyBm25: LexicalLeg = { search: () => [] }
    const result = await retrieve('semantic', {
      bm25: emptyBm25,
      structural,
      chunks: chunkMap,
      dense,
    })
    const hit = result.find((r) => r.chunk.id === vectorStoreChunk.id)
    expect(hit).toBeDefined()
    expect(hit?.scores.dense).toBeGreaterThan(0)
    expect(hit?.scores.bm25).toBe(0) // dense alone carried it — parallel, not cascade
  })
})
