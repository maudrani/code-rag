/**
 * Warm restart — SqliteStore.syncIndex (FTR-57 Fase 1).
 *
 * The stat-based skip: unchanged files are NOT re-chunked and NOT re-embedded (the spies prove it,
 * non-vacuously); changed/new/deleted ARE re-indexed; a model-id change forces a cold rebuild; the
 * index survives across processes (a second store on the same db path reads it without re-embedding).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ingestAndChunk, initParser } from '../../src/chunk/index.js'
import type { Chunk } from '../../src/contracts/chunk.js'
import { createOnnxEmbedder, type Embedder } from '../../src/index/embed.js'
import type { FileStat } from '../../src/index/manifest.js'
import { statFiles } from '../../src/index/manifest.js'
import { SqliteStore } from '../../src/index/store.js'

const RUN_SLOW = process.env.RUN_SLOW === '1'

const mkChunk = (path: string, n = 1): Chunk => ({
  id: `${path}#sym${n}@1-2`,
  path,
  lang: 'ts',
  symbol: `sym${n}`,
  kind: 'function',
  span: { startLine: 1, endLine: 2 },
  code: `export function sym${n}() { return '${path}' }`,
  structuralRefs: { calls: [], imports: [] },
})
const fstat = (path: string, mtimeMs: number, size: number): FileStat => ({ path, mtimeMs, size })
const spyEmbedder = () => ({
  dimension: 4,
  embed: vi.fn(async (texts: readonly string[]) => texts.map(() => new Float32Array([1, 0, 0, 0]))),
})
const chunkFrom = (paths: string[]): Chunk[] => paths.map((p) => mkChunk(p))

describe('syncIndex — warm restart (in-memory logic)', () => {
  let store: SqliteStore
  beforeEach(() => {
    store = new SqliteStore()
  })
  afterEach(() => store.close())

  it('cold first sync: chunks every file, embeds all, persists the manifest + model id', async () => {
    const embedder = spyEmbedder()
    const chunkChanged = vi.fn(chunkFrom)
    const report = await store.syncIndex(
      [fstat('a.ts', 1, 10), fstat('b.ts', 1, 10)],
      chunkChanged,
      {
        embedder,
        modelId: 'm1',
      },
    )
    expect(report).toMatchObject({ cold: true, reindexedFiles: 2, embeddedChunks: 2 })
    expect(chunkChanged).toHaveBeenCalledWith(['a.ts', 'b.ts'])
    expect(embedder.embed).toHaveBeenCalledTimes(1)
    expect(
      store
        .readManifest()
        .map((e) => e.path)
        .sort(),
    ).toEqual(['a.ts', 'b.ts'])
    expect(store.readModelId()).toBe('m1')
    expect(store.count().chunks).toBe(2)
  })

  it('WARM SKIP: an unchanged file set re-chunks NOTHING and embeds NOTHING (SC-2, non-vacuous)', async () => {
    const embedder = spyEmbedder()
    const files = [fstat('a.ts', 1, 10), fstat('b.ts', 1, 10)]
    await store.syncIndex(files, chunkFrom, { embedder, modelId: 'm1' })
    embedder.embed.mockClear()
    const chunkChanged = vi.fn(chunkFrom)
    const report = await store.syncIndex(files, chunkChanged, { embedder, modelId: 'm1' }) // identical stats
    expect(chunkChanged).not.toHaveBeenCalled() // no re-read / parse
    expect(embedder.embed).not.toHaveBeenCalled() // no re-embed
    expect(report).toMatchObject({
      cold: false,
      reusedFiles: 2,
      reindexedFiles: 0,
      embeddedChunks: 0,
    })
  })

  it('re-indexes ONLY a changed file (correctness twin), reusing the rest', async () => {
    const embedder = spyEmbedder()
    await store.syncIndex([fstat('a.ts', 1, 10), fstat('b.ts', 1, 10)], chunkFrom, {
      embedder,
      modelId: 'm1',
    })
    embedder.embed.mockClear()
    const chunkChanged = vi.fn((paths: string[]) => paths.map((p) => mkChunk(p, 2)))
    const report = await store.syncIndex(
      [fstat('a.ts', 1, 10), fstat('b.ts', 999, 20)],
      chunkChanged,
      {
        embedder,
        modelId: 'm1',
      },
    )
    expect(chunkChanged).toHaveBeenCalledWith(['b.ts']) // ONLY the changed file
    expect(embedder.embed).toHaveBeenCalledTimes(1) // embedded the changed chunk only
    expect(report).toMatchObject({
      cold: false,
      reusedFiles: 1,
      reindexedFiles: 1,
      embeddedChunks: 1,
    })
    expect(store.count().chunks).toBe(2) // a.ts (reused) + b.ts (new chunk id)
  })

  it('adds a new file and drops a deleted one', async () => {
    const embedder = spyEmbedder()
    await store.syncIndex([fstat('a.ts', 1, 10), fstat('b.ts', 1, 10)], chunkFrom, {
      embedder,
      modelId: 'm1',
    })
    const report = await store.syncIndex([fstat('a.ts', 1, 10), fstat('c.ts', 1, 10)], chunkFrom, {
      embedder,
      modelId: 'm1',
    })
    expect(report).toMatchObject({ reusedFiles: 1, reindexedFiles: 1, deletedFiles: 1 })
    expect(
      store
        .readManifest()
        .map((e) => e.path)
        .sort(),
    ).toEqual(['a.ts', 'c.ts']) // b.ts dropped
  })

  it('a model-id change forces a COLD rebuild (persisted vectors are model-specific)', async () => {
    const embedder = spyEmbedder()
    const files = [fstat('a.ts', 1, 10)]
    await store.syncIndex(files, chunkFrom, { embedder, modelId: 'm1' })
    embedder.embed.mockClear()
    const chunkChanged = vi.fn(chunkFrom)
    const report = await store.syncIndex(files, chunkChanged, { embedder, modelId: 'm2' }) // model changed
    expect(report.cold).toBe(true)
    expect(chunkChanged).toHaveBeenCalledWith(['a.ts']) // re-chunked despite the SAME stat
    expect(embedder.embed).toHaveBeenCalledTimes(1)
    expect(store.readModelId()).toBe('m2')
  })
})

describe('syncIndex — persistence across processes (SC-1)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'warm-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('a second store on the same db path reads the index WITHOUT re-embedding', async () => {
    const dbPath = join(dir, 'index.db')
    const first = new SqliteStore({ path: dbPath })
    await first.syncIndex([fstat('a.ts', 1, 10)], chunkFrom, {
      embedder: spyEmbedder(),
      modelId: 'm1',
    })
    first.close()

    const embedder2 = spyEmbedder()
    const second = new SqliteStore({ path: dbPath })
    const report = await second.syncIndex([fstat('a.ts', 1, 10)], chunkFrom, {
      embedder: embedder2,
      modelId: 'm1',
    })
    expect(report).toMatchObject({ cold: false, reusedFiles: 1, embeddedChunks: 0 })
    expect(embedder2.embed).not.toHaveBeenCalled() // the warm second process did NOT re-embed
    expect(second.count().chunks).toBe(1) // the index survived the restart
    second.close()
  })
})

describe.skipIf(!RUN_SLOW)('syncIndex — warm-vs-cold over the real corpus (RUN_SLOW)', () => {
  it('a warm restart embeds ZERO chunks when nothing changed', async () => {
    await initParser()
    const root = fileURLToPath(new URL('../../src', import.meta.url))
    const all = ingestAndChunk(root).chunks
    expect(all.length).toBeGreaterThan(0) // guard: the corpus must be non-empty for this test to mean anything
    const paths = [...new Set(all.map((c) => c.path))]
    const files = await statFiles(paths, root) // chunk.path is root-relative — stat join(root, path)
    expect(files).toHaveLength(paths.length) // guard: every file resolved (else the skip is vacuous)
    const chunkChanged = (ps: string[]): Chunk[] => all.filter((c) => ps.includes(c.path))

    let embedCalls = 0
    const real = createOnnxEmbedder()
    const counting: Embedder = {
      dimension: real.dimension,
      embed: (t) => {
        embedCalls++
        return real.embed(t)
      },
    }
    const store = new SqliteStore()

    const cold = await store.syncIndex(files, chunkChanged, {
      embedder: counting,
      modelId: 'minilm-q8',
    })
    expect(cold.cold).toBe(true)
    expect(cold.embeddedChunks).toBeGreaterThan(0)
    expect(embedCalls).toBeGreaterThan(0)

    embedCalls = 0
    const warm = await store.syncIndex(files, chunkChanged, {
      embedder: counting,
      modelId: 'minilm-q8',
    })
    expect(warm.cold).toBe(false)
    expect(warm.embeddedChunks).toBe(0) // the cold-start embed is gone on a warm run
    expect(embedCalls).toBe(0)
    store.close()
  }, 300_000)
})
