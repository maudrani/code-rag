/**
 * L3 unified SQLite store — whole-suite tests (ADR-003, TKT-205).
 *
 * One file-backed (or :memory:) Database holding all three legs' storage: the FTS5 table (BM25),
 * the chunks table with an embedding BLOB column (dense), and a persisted structural-adjacency
 * table. Tests cover: construction (WAL on disk, explicit open error), index() populating all three
 * in one rebuild, the three round-trips (chunk metadata, byte-identical BLOB, adjacency ==
 * buildStructuralIndex), leg parity (bm25 == standalone Bm25Index), idempotent rebuild, the
 * embedder-optional path, big vectors, and handle hygiene. A deterministic fake embedder keeps it
 * offline; every store is closed in afterEach (no handle leak).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Bm25Index } from '../../src/index/bm25.js'
import type { Embedder } from '../../src/index/embed.js'
import { SqliteStore } from '../../src/index/store.js'
import { retrieve } from '../../src/retrieve/retrieve.js'
import { buildStructuralIndex } from '../../src/retrieve/structural.js'
import { allChunks, chunkMap, searchIndexChunk } from '../retrieve/fixtures/chunks.js'

/** Deterministic 4-dim embedder (no model): chunk.code → a fixed vector. */
const DIM = 4
const fakeEmbedder: Embedder = {
  dimension: DIM,
  embed: async (texts) =>
    texts.map((t) => Float32Array.of((t.charCodeAt(0) || 0) / 128, (t.length % 7) / 7, 0.5, -0.25)),
}

const stores: SqliteStore[] = []
const tmpDirs: string[] = []
const track = (s: SqliteStore): SqliteStore => {
  stores.push(s)
  return s
}

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close()
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop() as string, { recursive: true, force: true })
})

describe('SqliteStore — construction', () => {
  it('opens an in-memory store and indexes an empty corpus without error', async () => {
    const store = track(new SqliteStore())
    await store.index([], { embedder: fakeEmbedder })
    expect(store.count()).toEqual({ chunks: 0, fts: 0, edges: 0 })
    expect(store.vectors()).toEqual([])
    expect(store.searchBm25('anything', 10)).toEqual([])
  })

  it('enables WAL on a file-backed path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'l3-store-'))
    tmpDirs.push(dir)
    const store = track(new SqliteStore({ path: join(dir, 'index.db') }))
    expect(store.journalMode().toLowerCase()).toBe('wal')
    await store.index(allChunks, { embedder: fakeEmbedder })
    expect(store.count().chunks).toBe(allChunks.length)
  })

  it('throws an explicit error when the DB file cannot be opened', () => {
    expect(() => new SqliteStore({ path: '/no/such/dir/xyz/index.db' })).toThrow()
  })
})

describe('SqliteStore — index() round-trips all three legs', () => {
  it('reports the expected row counts after a build', async () => {
    const store = track(new SqliteStore())
    await store.index(allChunks, { embedder: fakeEmbedder })
    const expectedEdges = [...buildStructuralIndex(allChunks).neighbours.values()].reduce(
      (sum, set) => sum + set.size,
      0,
    )
    expect(store.count()).toEqual({
      chunks: allChunks.length,
      fts: allChunks.length,
      edges: expectedEdges,
    })
  })

  it('round-trips chunk metadata identically (chunkMap)', async () => {
    const store = track(new SqliteStore())
    await store.index(allChunks, { embedder: fakeEmbedder })
    expect(store.chunkMap()).toEqual(chunkMap)
  })

  it('round-trips the embedding BLOB byte-identically', async () => {
    const store = track(new SqliteStore())
    await store.index(allChunks, { embedder: fakeEmbedder })
    const expected = await fakeEmbedder.embed(allChunks.map((c) => c.code))
    const byId = new Map(store.vectors().map((v) => [v.chunkId, v.vector]))
    allChunks.forEach((chunk, i) => {
      expect([...(byId.get(chunk.id) ?? [])]).toEqual([...(expected[i] ?? [])])
    })
  })

  it('persists a structural adjacency equal to buildStructuralIndex', async () => {
    const store = track(new SqliteStore())
    await store.index(allChunks, { embedder: fakeEmbedder })
    const inMemory = buildStructuralIndex(allChunks)
    const rebuilt = store.structuralIndex()
    expect(rebuilt.neighbours).toEqual(inMemory.neighbours)
    expect(rebuilt.definers).toEqual(inMemory.definers)
    expect(rebuilt.byId).toEqual(inMemory.byId)
  })

  it('its BM25 leg matches a standalone Bm25Index over the same corpus (grafted schema)', async () => {
    const store = track(new SqliteStore())
    await store.index(allChunks, { embedder: fakeEmbedder })
    const standalone = new Bm25Index()
    standalone.index(allChunks)
    for (const query of ['searchIndex', 'embed query', 'vector store']) {
      expect(store.searchBm25(query, 10)).toEqual(standalone.search(query, 10))
    }
    standalone.close()
  })
})

describe('SqliteStore — edges, rebuild, embedder-optional', () => {
  it('is idempotent: rebuilding the same corpus does not duplicate rows', async () => {
    const store = track(new SqliteStore())
    await store.index(allChunks, { embedder: fakeEmbedder })
    const first = store.count()
    await store.index(allChunks, { embedder: fakeEmbedder })
    expect(store.count()).toEqual(first)
  })

  it('indexes without an embedder (BLOB null) — bm25 + structural still work', async () => {
    const store = track(new SqliteStore())
    await store.index(allChunks)
    expect(store.vectors()).toEqual([]) // no embeddings stored
    expect(store.searchBm25('searchIndex', 10).length).toBeGreaterThan(0)
    expect(store.structuralIndex().neighbours).toEqual(buildStructuralIndex(allChunks).neighbours)
  })

  it('stores and reads a large vector without truncation', async () => {
    const ramp = Float32Array.from({ length: 1024 }, (_, i) => i)
    const big: Embedder = { dimension: 1024, embed: async (texts) => texts.map(() => ramp) }
    const store = track(new SqliteStore())
    await store.index([searchIndexChunk], { embedder: big })
    const vec = store.vectors()[0]?.vector
    expect(vec).toHaveLength(1024)
    expect([...(vec ?? [])]).toEqual([...ramp]) // float32 ramp round-trips exactly (no truncation)
  })
})

describe('SqliteStore — retrievalDeps() runs the whole hybrid off the one store', () => {
  it('assembles deps so retrieve() fuses BM25 + dense + structural from the shared handle', async () => {
    const store = track(new SqliteStore())
    await store.index(allChunks, { embedder: fakeEmbedder })
    const result = await retrieve('searchIndex', store.retrievalDeps(fakeEmbedder))
    expect(result.length).toBeGreaterThan(0)
    expect(result.map((r) => r.chunk.id)).toContain(searchIndexChunk.id) // bm25 + structural
    expect(result.some((r) => r.scores.dense > 0)).toBe(true) // dense leg active off stored BLOBs
  })

  it('omits the dense leg when no embedder is supplied (bm25 + structural only)', async () => {
    const store = track(new SqliteStore())
    await store.index(allChunks)
    const deps = store.retrievalDeps()
    expect(deps.dense).toBeUndefined()
    const result = await retrieve('searchIndex', deps)
    expect(result.length).toBeGreaterThan(0)
    for (const r of result) expect(r.scores.dense).toBe(0)
  })
})

describe('SqliteStore — handle hygiene', () => {
  it('close() releases the handle (subsequent use throws)', async () => {
    const store = new SqliteStore()
    await store.index(allChunks, { embedder: fakeEmbedder })
    store.close()
    expect(() => store.count()).toThrow()
  })
})
