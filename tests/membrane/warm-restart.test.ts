import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEngine } from '../../src/membrane/index.js'

/**
 * FTR-57 P2 — the membrane wires `indexPath` -> the store's warm-restart `syncIndex`. Dense is OFF
 * under vitest, so this proves the WIRING is correct (persists, serves, re-ingest is warm + correct,
 * a changed file IS re-indexed via the byPath/chunkChanged lookup). The embed-skip perf win (cold
 * 173s -> warm 0) is retrieval's RUN_SLOW warm.test.
 */
let corpus: string
let idxDir: string

afterEach(() => {
  if (corpus) rmSync(corpus, { recursive: true, force: true })
  if (idxDir) rmSync(idxDir, { recursive: true, force: true })
})

describe('membrane warm-restart wiring (FTR-57 P2)', () => {
  it('persists the index, serves results, is warm on re-ingest, and re-indexes a changed file', async () => {
    corpus = mkdtempSync(join(tmpdir(), 'warm-corpus-'))
    writeFileSync(join(corpus, 'a.ts'), 'export function alpha(): number {\n  return 1\n}\n')
    idxDir = mkdtempSync(join(tmpdir(), 'warm-idx-'))
    const indexPath = join(idxDir, 'index.db')

    const engine = createEngine({ corpusPath: corpus, indexPath })
    const p1 = await engine.query('alpha', [], 'package')
    expect(p1.results.length).toBeGreaterThan(0) // real retrieval over the warm-path store
    expect(existsSync(indexPath)).toBe(true) // the index persisted to disk

    // Re-ingest (the store is EXCLUSIVE-locked to one connection; ingest closes + reopens it). The
    // second run reads the manifest it just wrote -> the WARM path -> must serve identical results.
    await engine.ingest(corpus)
    const p2 = await engine.query('alpha', [], 'package')
    expect(p2.results.map((r) => r.chunk.id)).toEqual(p1.results.map((r) => r.chunk.id))

    // Change the file -> re-ingest -> the changed file is re-chunked (the byPath/chunkChanged path;
    // if `files` and chunk.path forms had diverged, `beta` would never surface).
    writeFileSync(join(corpus, 'a.ts'), 'export function beta(): number {\n  return 2\n}\n')
    await engine.ingest(corpus)
    const p3 = await engine.query('beta', [], 'package')
    expect(p3.results.some((r) => r.chunk.symbol === 'beta')).toBe(true)
    expect(p3.results.some((r) => r.chunk.symbol === 'alpha')).toBe(false) // old symbol gone
  })
})
