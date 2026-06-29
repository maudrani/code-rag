import { beforeAll, describe, expect, it } from 'vitest'
import { chunkSource } from '../../src/chunk/chunker.js'
import { initParser } from '../../src/chunk/parser.js'
import type { Chunk } from '../../src/contracts/chunk.js'
import { SAMPLE, SAMPLE_PATH } from './fixtures/sample-source.js'

// TKT-102 — chunk-by-symbol. Test-first (RULE-PROD-001): names, kinds, the
// no-mid-body-split invariant, verbatim round-trip, stable id, uniqueness,
// plus edge + negative cases.

const bySymbol = (chunks: Chunk[], symbol: string): Chunk | undefined =>
  chunks.find((c) => c.symbol === symbol)

const mustSymbol = (chunks: Chunk[], symbol: string): Chunk => {
  const found = bySymbol(chunks, symbol)
  if (found === undefined) throw new Error(`expected a chunk for symbol "${symbol}"`)
  return found
}

describe('chunk-by-symbol (TKT-102)', () => {
  let chunks: Chunk[]

  beforeAll(async () => {
    await initParser()
    chunks = chunkSource(SAMPLE, SAMPLE_PATH)
  })

  it('emits one chunk per top-level function (incl. export-wrapped + arrow-const)', () => {
    expect(bySymbol(chunks, 'greet')?.kind).toBe('function')
    expect(bySymbol(chunks, 'internal')?.kind).toBe('function')
    expect(bySymbol(chunks, 'double')?.kind).toBe('function')
  })

  it('emits class + its methods (constructor, method, getter) as method chunks', () => {
    expect(bySymbol(chunks, 'Service')?.kind).toBe('class')
    expect(bySymbol(chunks, 'Service.constructor')?.kind).toBe('method')
    expect(bySymbol(chunks, 'Service.process')?.kind).toBe('method')
    expect(bySymbol(chunks, 'Service.id')?.kind).toBe('method')
  })

  it('emits interface / type alias / enum as kind "other" (named)', () => {
    expect(bySymbol(chunks, 'Widget')?.kind).toBe('other')
    expect(bySymbol(chunks, 'WidgetOrNull')?.kind).toBe('other')
    expect(bySymbol(chunks, 'Color')?.kind).toBe('other')
  })

  it('groups loose top-level code (imports, non-fn const) into module chunks', () => {
    const moduleChunks = chunks.filter((c) => c.kind === 'module')
    expect(moduleChunks.length).toBeGreaterThanOrEqual(1)
    // the leading import line is module glue, not a symbol
    expect(chunks.some((c) => c.kind === 'module' && c.code.includes('import { helper }'))).toBe(
      true,
    )
    // a non-function const is glue, never a function chunk
    expect(bySymbol(chunks, 'config')).toBeUndefined()
  })

  it('never splits a function mid-body: one chunk, spanning multiple lines', () => {
    const greetMatches = chunks.filter((c) => c.symbol === 'greet')
    expect(greetMatches.length).toBe(1)
    const greet = mustSymbol(chunks, 'greet')
    expect(greet.span.endLine).toBeGreaterThan(greet.span.startLine)
    expect(greet.code).toContain('export function greet')
    expect(greet.code).toContain('return helper(name)')
  })

  it('code is the verbatim source for a top-level symbol span (round-trips)', () => {
    const lines = SAMPLE.split('\n')
    const greet = mustSymbol(chunks, 'greet')
    const reconstructed = lines.slice(greet.span.startLine - 1, greet.span.endLine).join('\n')
    expect(greet.code).toBe(reconstructed)
  })

  it('id is stable `path#symbol@start-end` and unique within the file', () => {
    const greet = mustSymbol(chunks, 'greet')
    expect(greet.id).toBe(`${SAMPLE_PATH}#greet@${greet.span.startLine}-${greet.span.endLine}`)
    const ids = chunks.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every chunk carries a structuralRefs shape (calls + imports arrays)', () => {
    for (const c of chunks) {
      expect(Array.isArray(c.structuralRefs.calls)).toBe(true)
      expect(Array.isArray(c.structuralRefs.imports)).toBe(true)
      expect(c.lang).toBe('typescript')
      expect(c.path).toBe(SAMPLE_PATH)
    }
  })
})

describe('chunk-by-symbol edge + negative cases (TKT-102)', () => {
  beforeAll(async () => {
    await initParser()
  })

  it('empty source yields no chunks (no crash)', () => {
    expect(chunkSource('', 'empty.ts')).toEqual([])
  })

  it('import-only file yields a module chunk, never a crash', () => {
    const chunks = chunkSource("import { a } from './a'\nimport { b } from './b'\n", 'imports.ts')
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks.every((c) => c.kind === 'module')).toBe(true)
  })

  it('an overload signature without a body is NOT emitted as an empty function chunk', () => {
    const src =
      'export function f(a: string): string\nexport function f(a: number): number\nexport function f(a: unknown): unknown { return a }\n'
    const chunks = chunkSource(src, 'overload.ts')
    const fns = chunks.filter((c) => c.symbol === 'f' && c.kind === 'function')
    // exactly the implementation (with body) is a function chunk; signatures are glue
    expect(fns.length).toBe(1)
    expect(fns[0]?.code).toContain('return a')
  })

  it('does not split nested inner functions into top-level chunks', () => {
    const src =
      'function outer(): number {\n  function inner(): number { return 1 }\n  return inner()\n}\n'
    const chunks = chunkSource(src, 'nested.ts')
    expect(bySymbol(chunks, 'outer')?.kind).toBe('function')
    // inner stays inside outer's body — not a separate top-level symbol chunk
    expect(bySymbol(chunks, 'inner')).toBeUndefined()
  })

  it('emits export-default fn/arrow/anonymous-class as a "default" chunk; named default class keeps its name', () => {
    expect(
      bySymbol(chunkSource('export default function () { return 0 }', 'd1.ts'), 'default')?.kind,
    ).toBe('function')
    expect(bySymbol(chunkSource('export default () => 1', 'd2.ts'), 'default')?.kind).toBe(
      'function',
    )
    expect(bySymbol(chunkSource('export default class {}', 'd3.ts'), 'default')?.kind).toBe('class')
    expect(bySymbol(chunkSource('export default class C {}', 'd4.ts'), 'C')?.kind).toBe('class')
  })
})
