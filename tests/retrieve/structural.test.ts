/**
 * L4 structural leg — whole-suite tests (ADR-003, the code-specific third leg).
 *
 * Two pure units: buildStructuralIndex (the call/import graph from structuralRefs) and
 * structuralExpand (ranked one-hop neighbours of seeds). Every decision/branch/edge/negative
 * is pinned: call resolution, dangling/external calls, relative vs bare imports, undirected
 * one-hop, seed exclusion, reference-count ranking, deterministic tie-break.
 */
import { describe, expect, it } from 'vitest'
import type { Chunk } from '../../src/contracts/chunk.js'
import { DEFAULT_RRF_CONFIG, rrfFuse } from '../../src/retrieve/fuse.js'
import { buildStructuralIndex, structuralExpand } from '../../src/retrieve/structural.js'
import {
  allChunks,
  bm25SearchChunk,
  chunkMap,
  embedQueryChunk,
  rrfFuseChunk,
  searchIndexChunk,
  vectorStoreChunk,
} from './fixtures/chunks.js'

const c1 = searchIndexChunk.id // calls embedQuery, bm25Search, denseSearch(dangling), rrfFuse
const c2 = embedQueryChunk.id // calls pipeline(external)
const c3 = bm25SearchChunk.id
const c4 = vectorStoreChunk.id // no resolvable edges
const c5 = rrfFuseChunk.id

/** minimal inline Chunk builder for import-resolution fixtures. */
const mk = (path: string, symbol: string, refs: Chunk['structuralRefs']): Chunk => ({
  id: `${path}#${symbol}@1-2`,
  path,
  lang: 'ts',
  symbol,
  kind: 'function',
  span: { startLine: 1, endLine: 2 },
  code: '',
  structuralRefs: refs,
})

const sortedNeighbours = (index: ReturnType<typeof buildStructuralIndex>, id: string) =>
  [...(index.neighbours.get(id) ?? [])].sort()

describe('buildStructuralIndex — call graph (precise symbol resolution)', () => {
  const index = buildStructuralIndex(allChunks)

  it('maps each defined symbol to its defining chunk id', () => {
    expect(index.definers.get('searchIndex')).toEqual([c1])
    expect(index.definers.get('embedQuery')).toEqual([c2])
    expect(index.definers.get('rrfFuse')).toEqual([c5])
    expect(index.definers.has('pipeline')).toBe(false) // never defined in the corpus
  })

  it('resolves call edges to defining chunks (undirected one-hop)', () => {
    // searchIndex calls embedQuery + bm25Search + rrfFuse (denseSearch dangles, see below)
    expect(sortedNeighbours(index, c1)).toEqual([c2, c3, c5].sort())
    // undirected: each callee lists searchIndex back
    expect(index.neighbours.get(c2)?.has(c1)).toBe(true)
    expect(index.neighbours.get(c3)?.has(c1)).toBe(true)
    expect(index.neighbours.get(c5)?.has(c1)).toBe(true)
  })

  it('drops a dangling call to an undefined symbol (denseSearch is not in the corpus)', () => {
    for (const set of index.neighbours.values()) {
      expect([...set]).not.toContain('denseSearch') // ids only, never a bare symbol
    }
    expect(sortedNeighbours(index, c1)).not.toContain(c4) // VectorStore is unrelated
  })

  it('drops an external call (pipeline is not a corpus symbol)', () => {
    // embedQuery's only call (pipeline) is external ⇒ its sole neighbour is its caller searchIndex
    expect(sortedNeighbours(index, c2)).toEqual([c1])
  })

  it('gives a chunk with no resolvable edges zero neighbours (all imports external)', () => {
    // VectorStore: no calls, imports only better-sqlite3 (bare/external)
    expect(index.neighbours.get(c4) === undefined || index.neighbours.get(c4)?.size === 0).toBe(
      true,
    )
  })

  it('never creates a self-edge', () => {
    const recursive = mk('src/r.ts', 'loop', { calls: ['loop'], imports: [] })
    const idx = buildStructuralIndex([recursive])
    expect(idx.neighbours.get(recursive.id)?.has(recursive.id) ?? false).toBe(false)
  })
})

describe('buildStructuralIndex — import graph (relative resolution; bare = external)', () => {
  it('resolves a relative import to the imported file’s chunks (undirected)', () => {
    const a = mk('src/a.ts', 'a', { calls: [], imports: ['./b.js'] })
    const b = mk('src/b.ts', 'b', { calls: [], imports: [] })
    const index = buildStructuralIndex([a, b])
    expect(index.neighbours.get(a.id)?.has(b.id)).toBe(true)
    expect(index.neighbours.get(b.id)?.has(a.id)).toBe(true) // undirected
  })

  it('resolves a parent-relative import (../)', () => {
    const c = mk('src/deep/c.ts', 'c', { calls: [], imports: ['../b.js'] })
    const b = mk('src/b.ts', 'b', { calls: [], imports: [] })
    const index = buildStructuralIndex([c, b])
    expect(index.neighbours.get(c.id)?.has(b.id)).toBe(true)
  })

  it('does NOT create an edge for a bare/external specifier', () => {
    const a = mk('src/a.ts', 'a', { calls: [], imports: ['better-sqlite3'] })
    const b = mk('src/b.ts', 'b', { calls: [], imports: [] })
    const index = buildStructuralIndex([a, b])
    expect(index.neighbours.get(a.id)?.has(b.id) ?? false).toBe(false)
  })

  it('links to ALL chunks of an imported multi-symbol file', () => {
    const a = mk('src/a.ts', 'a', { calls: [], imports: ['./b.js'] })
    const b1 = mk('src/b.ts', 'b1', { calls: [], imports: [] })
    const b2 = mk('src/b.ts', 'b2', { calls: [], imports: [] })
    const index = buildStructuralIndex([a, b1, b2])
    expect(sortedNeighbours(index, a.id)).toEqual([b1.id, b2.id].sort())
  })
})

describe('structuralExpand — ranked one-hop neighbours', () => {
  const index = buildStructuralIndex(allChunks)

  it('returns the seed’s neighbours, excluding the seed itself (default)', () => {
    const out = structuralExpand([c1], index)
    expect(out.map((r) => r.chunkId)).toEqual([c2, c3, c5].sort()) // all score 1 → id order
    expect(out.map((r) => r.chunkId)).not.toContain(c1)
    for (const r of out) expect(r.score).toBe(1)
  })

  it('ranks by the number of distinct seeds referencing a neighbour', () => {
    // both bm25Search and embedQuery neighbour searchIndex ⇒ searchIndex scores 2
    const out = structuralExpand([c3, c2], index)
    expect(out).toEqual([{ chunkId: c1, score: 2 }])
  })

  it('breaks ties deterministically by chunk id (ascending)', () => {
    const a = structuralExpand([c1], index).map((r) => r.chunkId)
    const b = structuralExpand([c1], index).map((r) => r.chunkId)
    expect(a).toEqual(b)
    expect(a).toEqual([...a].sort()) // already id-sorted because all scores equal
  })

  it('includeSeeds:true keeps seed neighbours that are themselves seeds', () => {
    // seeds searchIndex + embedQuery are mutual neighbours
    const excluded = structuralExpand([c1, c2], index).map((r) => r.chunkId)
    expect(excluded).toEqual([c3, c5].sort()) // seeds c1,c2 removed
    const included = structuralExpand([c1, c2], index, { includeSeeds: true }).map((r) => r.chunkId)
    expect(included.sort()).toEqual([c1, c2, c3, c5].sort()) // seeds kept
  })

  it('produces fusion-ready output (feeds rrfFuse as the structural leg)', () => {
    const structural = structuralExpand([c1], index)
    const fused = rrfFuse({ bm25: [], dense: [], structural }, chunkMap, DEFAULT_RRF_CONFIG)
    expect(fused.length).toBe(3)
    // only the structural leg contributed
    for (const r of fused) {
      expect(r.scores.bm25).toBe(0)
      expect(r.scores.dense).toBe(0)
      expect(r.scores.structural).toBeGreaterThan(0)
    }
  })
})

describe('structuralExpand — edge + negative cases', () => {
  const index = buildStructuralIndex(allChunks)

  it('returns [] for empty seeds', () => {
    expect(structuralExpand([], index)).toEqual([])
  })

  it('ignores an unknown seed id (no throw)', () => {
    expect(structuralExpand(['ghost.ts#nope@1-2'], index)).toEqual([])
  })

  it('returns [] for a seed with no neighbours', () => {
    expect(structuralExpand([c4], index)).toEqual([]) // VectorStore is isolated
  })

  it('counts a neighbour once per distinct seed even across both edge directions', () => {
    // duplicate seed ids must not inflate the score
    const out = structuralExpand([c3, c3], index)
    expect(out).toEqual([{ chunkId: c1, score: 1 }])
  })
})
