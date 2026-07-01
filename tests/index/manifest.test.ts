/**
 * Warm-restart manifest — the stat-check (FTR-57 Fase 1, adopts peripheral-hub TKT-507).
 *
 * diffManifest is the PURE freshness decision: a file is UNCHANGED iff its (mtime, size) match the
 * manifest — a STAT-ONLY signal (never a content hash: a hash needs a read, and the read+parse+embed
 * is the dominant cost we skip). The correctness gate lives here: a file whose mtime OR size changed
 * is CHANGED (re-indexed), never silently skipped.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  diffManifest,
  type FileStat,
  type ManifestEntry,
  statFiles,
} from '../../src/index/manifest.js'

const f = (path: string, mtimeMs: number, size: number): FileStat => ({ path, mtimeMs, size })
const entry = (path: string, mtimeMs: number, size: number, chunkIds: string[]): ManifestEntry => ({
  path,
  mtimeMs,
  size,
  chunkIds,
})

describe('diffManifest — stat-only freshness decision', () => {
  it('classifies a file with matching mtime+size as UNCHANGED (carries its chunk ids)', () => {
    const manifest = [entry('a.ts', 100, 10, ['a.ts#x@1-2'])]
    const diff = diffManifest([f('a.ts', 100, 10)], manifest)
    expect(diff.unchanged).toEqual(manifest)
    expect(diff.changed).toEqual([])
    expect(diff.deleted).toEqual([])
  })

  it('classifies a file whose MTIME changed as CHANGED (the correctness twin)', () => {
    const manifest = [entry('a.ts', 100, 10, ['a.ts#x@1-2'])]
    const diff = diffManifest([f('a.ts', 200, 10)], manifest) // mtime 100 -> 200
    expect(diff.changed).toEqual([f('a.ts', 200, 10)])
    expect(diff.unchanged).toEqual([])
  })

  it('classifies a file whose SIZE changed (mtime same) as CHANGED', () => {
    const manifest = [entry('a.ts', 100, 10, ['a.ts#x@1-2'])]
    const diff = diffManifest([f('a.ts', 100, 20)], manifest) // size 10 -> 20
    expect(diff.changed).toEqual([f('a.ts', 100, 20)])
    expect(diff.unchanged).toEqual([])
  })

  it('classifies a file absent from the manifest as CHANGED (new)', () => {
    const diff = diffManifest([f('new.ts', 1, 1)], [])
    expect(diff.changed).toEqual([f('new.ts', 1, 1)])
  })

  it('classifies a manifest entry no longer on disk as DELETED', () => {
    const manifest = [entry('gone.ts', 100, 10, ['gone.ts#x@1-2'])]
    const diff = diffManifest([], manifest)
    expect(diff.deleted).toEqual(manifest)
    expect(diff.changed).toEqual([])
    expect(diff.unchanged).toEqual([])
  })

  it('handles a mixed set (unchanged + changed + new + deleted) deterministically', () => {
    const manifest = [
      entry('keep.ts', 100, 10, ['keep.ts#k@1-2']),
      entry('edit.ts', 100, 10, ['edit.ts#e@1-2']),
      entry('gone.ts', 100, 10, ['gone.ts#g@1-2']),
    ]
    const current = [f('keep.ts', 100, 10), f('edit.ts', 101, 10), f('new.ts', 5, 5)]
    const diff = diffManifest(current, manifest)
    expect(diff.unchanged.map((e) => e.path)).toEqual(['keep.ts'])
    expect(diff.changed.map((c) => c.path).sort()).toEqual(['edit.ts', 'new.ts'])
    expect(diff.deleted.map((e) => e.path)).toEqual(['gone.ts'])
  })

  it('empty manifest ⇒ every current file is changed (a cold rebuild)', () => {
    const current = [f('a.ts', 1, 1), f('b.ts', 2, 2)]
    expect(diffManifest(current, []).changed).toEqual(current)
  })
})

describe('statFiles — the fs adapter producing FileStat[] for diffManifest', () => {
  it('stats real files (mtimeMs + positive size), preserving the given paths', async () => {
    const self = fileURLToPath(import.meta.url)
    const stats = await statFiles([self])
    expect(stats).toHaveLength(1)
    expect(stats[0]?.path).toBe(self)
    expect(stats[0]?.size).toBeGreaterThan(0)
    expect(typeof stats[0]?.mtimeMs).toBe('number')
  })

  it('skips a path that does not exist (no throw)', async () => {
    const stats = await statFiles(['/no/such/file/here.ts'])
    expect(stats).toEqual([])
  })

  it('resolves root-relative paths against a root, keeping the relative key (chunk.path match)', async () => {
    // ingest-chunk emits root-relative paths; statFiles stats join(root, path) but keeps `path` as the key.
    const self = fileURLToPath(import.meta.url)
    const root = self.slice(0, self.lastIndexOf('/tests/'))
    const stats = await statFiles(['tests/index/manifest.test.ts'], root)
    expect(stats).toHaveLength(1)
    expect(stats[0]?.path).toBe('tests/index/manifest.test.ts') // the relative KEY is preserved
    expect(stats[0]?.size).toBeGreaterThan(0)
  })
})
