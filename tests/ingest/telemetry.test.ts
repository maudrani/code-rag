import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ingestAndChunk, initParser } from '../../src/chunk/index.js'
import { collectIngestTelemetry } from '../../src/ingest/telemetry.js'

// TKT-107 (FTR-12) — IngestTelemetry invariant gate (demonstrate-deterministically).
// The invariant `filesWalked === filesIndexed + skipped + errors.length` is asserted
// (a) against a REAL ingestAndChunk run over a tree with an indexed file + a skip + an
// unreadable file, and (b) on a synthetic loop-read-error (cross-platform). Non-vacuous:
// errors vs skipped must be disjoint + complete, else the equality fails.

describe('collectIngestTelemetry — real ingest run (TKT-107)', () => {
  let root: string

  beforeAll(async () => {
    await initParser()
    root = mkdtempSync(join(tmpdir(), 'ingest-tel-'))
    writeFileSync(join(root, 'a.ts'), 'export function a(): number {\n  return 1\n}\n') // indexed
    writeFileSync(join(root, 'types.d.ts'), 'export declare const z: number\n') // skipped: declaration
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('holds the invariant + reports the exact L1 counts', () => {
    const r = ingestAndChunk(root)
    const tel = collectIngestTelemetry({
      files: r.files,
      skipped: r.skipped,
      chunkCount: r.chunks.length,
      durationMs: 7,
    })
    expect(tel.filesWalked).toBe(tel.filesIndexed + tel.skipped + tel.errors.length)
    expect(tel.filesIndexed).toBe(1) // a.ts
    expect(tel.skipped).toBe(1) // types.d.ts (declaration)
    expect(tel.chunks).toBe(r.chunks.length)
    expect(tel.byLang).toEqual({ typescript: 1 })
    expect(tel.durationMs).toBe(7)
  })

  // chmod 000 → unreadable; perms don't apply as root / on Windows.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a read-error file is counted in errors[], not skipped, and the invariant still holds',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'ingest-tel-err-'))
      try {
        writeFileSync(join(dir, 'ok.ts'), 'export const ok = 1\n')
        const locked = join(dir, 'locked.ts')
        writeFileSync(locked, 'export const x = 1\n')
        chmodSync(locked, 0o000)
        const r = ingestAndChunk(dir)
        const tel = collectIngestTelemetry({
          files: r.files,
          skipped: r.skipped,
          chunkCount: r.chunks.length,
          durationMs: 0,
        })
        expect(tel.errors.some((e) => e.startsWith('locked.ts'))).toBe(true)
        expect(tel.errors.length).toBe(1)
        expect(tel.filesWalked).toBe(tel.filesIndexed + tel.skipped + tel.errors.length)
      } finally {
        chmodSync(join(dir, 'locked.ts'), 0o644)
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})

describe('collectIngestTelemetry — pure-input units (TKT-107)', () => {
  it('a loop read-error (path among files) is in errors[], excluded from filesIndexed', () => {
    const tel = collectIngestTelemetry({
      files: ['a.ts', 'b.ts'], // b.ts was included but failed to read in the parse loop
      skipped: [
        { path: 'b.ts', reason: 'read-error' },
        { path: 'x.d.ts', reason: 'declaration' },
      ],
      chunkCount: 3,
      durationMs: 1,
    })
    expect(tel.filesIndexed).toBe(1) // a.ts only
    expect(tel.errors).toContain('b.ts: read-error')
    expect(tel.skipped).toBe(1) // x.d.ts
    expect(tel.filesWalked).toBe(3)
    expect(tel.filesWalked).toBe(tel.filesIndexed + tel.skipped + tel.errors.length)
    expect(tel.byLang).toEqual({ typescript: 1 }) // only the indexed a.ts
  })

  it('empty ingest → all-zero, consistent struct', () => {
    const tel = collectIngestTelemetry({ files: [], skipped: [], chunkCount: 0, durationMs: 0 })
    expect(tel).toEqual({
      filesWalked: 0,
      filesIndexed: 0,
      skipped: 0,
      chunks: 0,
      byLang: {},
      errors: [],
      durationMs: 0,
    })
  })

  it('Σ byLang === filesIndexed (indexed files are exactly the non-errored included files)', () => {
    const tel = collectIngestTelemetry({
      files: ['a.ts', 'b.mts', 'c.cts'],
      skipped: [],
      chunkCount: 9,
      durationMs: 2,
    })
    const sumLang = Object.values(tel.byLang).reduce((a, b) => a + b, 0)
    expect(sumLang).toBe(tel.filesIndexed)
    expect(tel.byLang).toEqual({ typescript: 3 })
  })
})
