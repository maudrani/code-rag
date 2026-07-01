import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine } from '../../src/membrane/index.js'

/**
 * engine.symbols() — the corpus symbol read-surface (FTR-56, the /symbols seam). Dense is OFF under
 * vitest; the deterministic ingest -> chunk path is REAL, so symbols() reflects the parsed symbols.
 * It ensures the index on first call (no prior query needed — the autocomplete UX).
 */
let corpus: string
let engine: ReturnType<typeof createEngine>

beforeAll(() => {
  corpus = mkdtempSync(join(tmpdir(), 'membrane-symbols-'))
  writeFileSync(
    join(corpus, 'users.ts'),
    'export function getUserById(id: string): string {\n  return "user:" + id\n}\n',
  )
  writeFileSync(join(corpus, 'types.ts'), 'export interface Query {\n  raw: string\n}\n')
  engine = createEngine({ corpusPath: corpus })
})

afterAll(() => {
  rmSync(corpus, { recursive: true, force: true })
})

describe('engine.symbols() — corpus symbol read-surface (FTR-56)', () => {
  it('indexes on first call and projects each chunk to its SymbolEntry identity', async () => {
    const symbols = await engine.symbols() // NO prior query — symbols() ensures the index itself
    expect(symbols.length).toBeGreaterThan(0)

    const known = symbols.find((s) => s.symbol === 'getUserById')
    expect(known).toEqual({
      path: expect.any(String),
      symbol: 'getUserById',
      kind: expect.any(String),
      lang: expect.any(String),
      span: { startLine: expect.any(Number), endLine: expect.any(Number) },
    })
  })

  it('is wire-safe: no code body / id / structuralRefs leak (identity projection only)', async () => {
    const symbols = await engine.symbols()
    for (const s of symbols) {
      expect(s).not.toHaveProperty('code')
      expect(s).not.toHaveProperty('id')
      expect(s).not.toHaveProperty('structuralRefs')
    }
  })
})
