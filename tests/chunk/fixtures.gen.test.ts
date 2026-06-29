import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { chunkSource } from '../../src/chunk/chunker.js'
import { initParser } from '../../src/chunk/parser.js'
import type { Chunk } from '../../src/contracts/chunk.js'
import { SAMPLE, SAMPLE_PATH } from './fixtures/sample-source.js'

// TKT-102/103 — the Chunk[] fixture the `retrieval` specialist mocks against.
// CI VALIDATES the committed fixture (parsed → format-agnostic) and checks it is
// in sync with the chunker. It does NOT rewrite on a normal run, so the committed
// file stays biome-formatted. Regenerate after an intentional chunker change:
//   UPDATE_FIXTURES=1 npx vitest run tests/chunk/fixtures.gen.test.ts
// then `biome check --write` + commit.

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'chunks.fixture.json',
)
const KINDS: ReadonlyArray<Chunk['kind']> = ['function', 'class', 'method', 'module', 'other']

describe('Chunk[] fixture for retrieval (TKT-102/103)', () => {
  let chunks: Chunk[]

  beforeAll(async () => {
    await initParser()
    chunks = chunkSource(SAMPLE, SAMPLE_PATH)
    if (process.env.UPDATE_FIXTURES === '1') {
      writeFileSync(FIXTURE_PATH, `${JSON.stringify(chunks, null, 2)}\n`, 'utf8')
    }
  })

  it('committed fixture is in sync with the chunker (regenerate on drift)', () => {
    const loaded = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Chunk[]
    expect(loaded).toEqual(chunks)
  })

  it('is a non-empty, contract-conformant Chunk[]', () => {
    const loaded = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Chunk[]
    expect(loaded.length).toBeGreaterThan(0)
    for (const c of loaded) {
      expect(typeof c.id).toBe('string')
      expect(typeof c.path).toBe('string')
      expect(typeof c.symbol).toBe('string')
      expect(KINDS).toContain(c.kind)
      expect(typeof c.span.startLine).toBe('number')
      expect(typeof c.span.endLine).toBe('number')
      expect(c.span.endLine).toBeGreaterThanOrEqual(c.span.startLine)
      expect(typeof c.code).toBe('string')
      expect(Array.isArray(c.structuralRefs.calls)).toBe(true)
      expect(Array.isArray(c.structuralRefs.imports)).toBe(true)
    }
  })

  it('uses repo-relative paths only (no absolute machine paths)', () => {
    const loaded = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Chunk[]
    expect(loaded.every((c) => !c.path.startsWith('/'))).toBe(true)
  })
})
