import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEngine } from '../../src/membrane/index.js'

/**
 * FTR-5 P4 TKT-008 — engine.reindex swaps the active corpus at runtime (the enabler for POST /ingest).
 * Build-then-swap: the new index is built off to the side, then installed atomically, so a failed
 * rebuild keeps the previous corpus (GAP-P4-E) and there is no empty-index window (GAP-P4-B). Dense OFF
 * under vitest -> deterministic.
 */
let a: string
let b: string
afterEach(() => {
  for (const d of [a, b]) if (d) rmSync(d, { recursive: true, force: true })
})

function corpus(prefix: string, file: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  writeFileSync(join(dir, file), body)
  return dir
}

describe('membrane: engine.reindex — atomic corpus swap (FTR-5 TKT-008)', () => {
  it('reindex A -> B makes B searchable and A not', async () => {
    a = corpus('reidx-a-', 'alpha.ts', 'export function alphaFn(): number {\n  return 1\n}\n')
    b = corpus('reidx-b-', 'beta.ts', 'export function betaFn(): number {\n  return 2\n}\n')
    const engine = createEngine({ corpusPath: a })

    const p1 = await engine.query('alphaFn', [], 'package')
    expect(p1.results.some((r) => r.chunk.symbol === 'alphaFn')).toBe(true)

    const report = await engine.reindex(b)
    expect(report.chunks).toBeGreaterThan(0) // the new corpus was indexed

    const p2 = await engine.query('betaFn', [], 'package')
    expect(p2.results.some((r) => r.chunk.symbol === 'betaFn')).toBe(true) // B is now active
    const p3 = await engine.query('alphaFn', [], 'package')
    expect(p3.results.some((r) => r.chunk.symbol === 'alphaFn')).toBe(false) // A is gone
  })

  it('a failed reindex keeps the previous corpus active (GAP-P4-E)', async () => {
    a = corpus('reidx-a2-', 'alpha.ts', 'export function alphaFn(): number {\n  return 1\n}\n')
    const engine = createEngine({ corpusPath: a })
    await engine.query('alphaFn', [], 'package')

    // a non-existent dir throws in the build -> before any swap.
    await expect(engine.reindex(join(tmpdir(), 'code-rag-nope-reidx-xyz'))).rejects.toBeTruthy()

    const p = await engine.query('alphaFn', [], 'package')
    expect(p.results.some((r) => r.chunk.symbol === 'alphaFn')).toBe(true) // old corpus intact
  })
})
