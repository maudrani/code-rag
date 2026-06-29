import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ingestAndChunk } from '../../src/chunk/index.js'
import { initParser } from '../../src/chunk/parser.js'
import type { Chunk } from '../../src/contracts/chunk.js'

// TKT-105 — L1→L2 integration. Test-first (RULE-PROD-001): a controlled temp
// tree (deterministic, incl. cross-file structuralRefs) + a real self-index run
// over src/contracts/ (robust, count-independent assertions — proves it works on
// actual repo code, ADR-006 self-index corpus).

const KINDS: ReadonlyArray<Chunk['kind']> = ['function', 'class', 'method', 'module', 'other']

const isContractValid = (c: Chunk): boolean =>
  typeof c.id === 'string' &&
  c.id.length > 0 &&
  typeof c.path === 'string' &&
  typeof c.symbol === 'string' &&
  KINDS.includes(c.kind) &&
  typeof c.span.startLine === 'number' &&
  typeof c.span.endLine === 'number' &&
  c.span.endLine >= c.span.startLine &&
  typeof c.code === 'string' &&
  Array.isArray(c.structuralRefs.calls) &&
  Array.isArray(c.structuralRefs.imports)

describe('ingestAndChunk — controlled tree (TKT-105)', () => {
  let root: string

  beforeAll(async () => {
    await initParser()
    root = mkdtempSync(join(tmpdir(), 'ingest-'))
    mkdirSync(join(root, 'lib'))
    writeFileSync(
      join(root, 'lib', 'util.ts'),
      'export function helper(x: number): number {\n  return x + 1\n}\n',
    )
    writeFileSync(
      join(root, 'main.ts'),
      "import { helper } from './lib/util.js'\nexport function run(): number {\n  return helper(1)\n}\n",
    )
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('walks → parses → chunks across files into one Chunk[]', () => {
    const { chunks, files } = ingestAndChunk(root)
    expect(files).toEqual(['lib/util.ts', 'main.ts'])
    expect(chunks.some((c) => c.symbol === 'helper' && c.path === 'lib/util.ts')).toBe(true)
    expect(chunks.some((c) => c.symbol === 'run' && c.path === 'main.ts')).toBe(true)
  })

  it('preserves cross-file structuralRefs (run calls helper, imports ./lib/util.js)', () => {
    const { chunks } = ingestAndChunk(root)
    const run = chunks.find((c) => c.symbol === 'run')
    expect(run).toBeDefined()
    expect(run?.structuralRefs.calls).toContain('helper')
    expect(run?.structuralRefs.imports).toContain('./lib/util.js')
  })

  it('every emitted chunk is contract-conformant', () => {
    const { chunks } = ingestAndChunk(root)
    expect(chunks.every(isContractValid)).toBe(true)
  })
})

describe('ingestAndChunk — real self-index over src/contracts (TKT-105)', () => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
  const contractsDir = join(repoRoot, 'src', 'contracts')

  beforeAll(async () => {
    await initParser()
  })

  it('produces a non-trivial, fully contract-valid Chunk[] from real code', () => {
    const { chunks } = ingestAndChunk(contractsDir)
    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks.every(isContractValid)).toBe(true)
  })

  it('emits interface/type symbols (kind "other") from the contracts', () => {
    const { chunks } = ingestAndChunk(contractsDir)
    expect(chunks.some((c) => c.kind === 'other')).toBe(true)
    // the Chunk contract itself should surface as a symbol
    expect(chunks.some((c) => c.symbol === 'Chunk')).toBe(true)
  })

  it('populates structuralRefs.imports on at least one chunk (real import edges)', () => {
    const { chunks } = ingestAndChunk(contractsDir)
    expect(chunks.some((c) => c.structuralRefs.imports.length > 0)).toBe(true)
  })

  it('emits repo-relative .ts paths only — no node_modules, no absolute leakage', () => {
    const { chunks } = ingestAndChunk(contractsDir)
    expect(chunks.every((c) => !c.path.startsWith('/') && !c.path.includes('node_modules'))).toBe(
      true,
    )
    expect(chunks.every((c) => c.path.endsWith('.ts'))).toBe(true)
  })
})
