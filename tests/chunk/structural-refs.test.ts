import { beforeAll, describe, expect, it } from 'vitest'
import { chunkSource } from '../../src/chunk/chunker.js'
import { initParser, parse } from '../../src/chunk/parser.js'
import { buildImportTable, extractStructuralRefs } from '../../src/chunk/structural-refs.js'
import type { Chunk } from '../../src/contracts/chunk.js'
import { SAMPLE, SAMPLE_PATH } from './fixtures/sample-source.js'

// TKT-103 — structuralRefs {calls, imports}. Test-first across every form
// (RULE-PROD-001): direct/method/new/chained calls; default/named/namespace/
// dynamic/require/re-export imports; dedup; scoping; negatives; + end-to-end.

const firstChild = (src: string) => {
  const node = parse(src).rootNode.namedChildren[0]
  if (node === undefined) throw new Error(`no top-level node parsed from: ${src}`)
  return node
}

/** refs of the first top-level node, resolving the file's import bindings. */
const refsOf = (src: string) => {
  const root = parse(src).rootNode
  return extractStructuralRefs([firstChild(src)], buildImportTable(root))
}

const bySymbol = (chunks: Chunk[], symbol: string): Chunk => {
  const c = chunks.find((x) => x.symbol === symbol)
  if (c === undefined) throw new Error(`no chunk for symbol "${symbol}"`)
  return c
}

describe('structuralRefs — calls (TKT-103)', () => {
  beforeAll(async () => {
    await initParser()
  })

  it('captures a direct call by name', () => {
    expect(refsOf('function f() { helper() }').calls).toContain('helper')
  })

  it('captures a method call by property name', () => {
    expect(refsOf('function f() { obj.method() }').calls).toContain('method')
  })

  it('captures a constructor (new) by name', () => {
    expect(refsOf('function f() { new Widget() }').calls).toContain('Widget')
  })

  it('captures every callee in a chained call a.b().c()', () => {
    const calls = refsOf('function f() { a.b().c() }').calls
    expect(calls).toContain('b')
    expect(calls).toContain('c')
  })

  it('de-duplicates repeated callees', () => {
    const calls = refsOf('function f() { helper(); helper(); helper() }').calls
    expect(calls.filter((c) => c === 'helper')).toHaveLength(1)
  })

  it('returns stable (sorted) arrays for deterministic fixtures', () => {
    const calls = refsOf('function f() { zeta(); alpha(); mid() }').calls
    expect(calls).toEqual([...calls].sort())
  })
})

describe('structuralRefs — imports (TKT-103)', () => {
  beforeAll(async () => {
    await initParser()
  })

  it('builds a binding→specifier table for default / named+alias / namespace', () => {
    const table = buildImportTable(
      parse("import def from './d'\nimport { a, b as c } from './x'\nimport * as ns from './ns'\n")
        .rootNode,
    )
    expect(table.get('def')).toBe('./d')
    expect(table.get('a')).toBe('./x')
    expect(table.get('c')).toBe('./x') // aliased binding name
    expect(table.get('ns')).toBe('./ns')
  })

  it('captures a static import statement source on the chunk that holds it', () => {
    expect(refsOf("import { helper } from './helper'\n").imports).toContain('./helper')
  })

  it('captures a re-export source as an import edge', () => {
    expect(refsOf("export { reExp } from './re'\n").imports).toContain('./re')
  })

  it('captures a dynamic import() specifier — and import is NOT a call', () => {
    const refs = refsOf("function f() { return import('./dyn') }")
    expect(refs.imports).toContain('./dyn')
    expect(refs.calls).not.toContain('import')
  })

  it('captures a require() specifier — and require is NOT a call', () => {
    const refs = refsOf("function f() { const r = require('./req'); return r }")
    expect(refs.imports).toContain('./req')
    expect(refs.calls).not.toContain('require')
  })

  it('links a used imported binding to its module specifier', () => {
    const root = parse(
      "import { helper } from './helper'\nfunction f() { return helper() }\n",
    ).rootNode
    const fn = root.namedChildren.find((n) => n.type === 'function_declaration')
    expect(fn).toBeDefined()
    const refs = extractStructuralRefs(fn ? [fn] : [], buildImportTable(root))
    expect(refs.imports).toContain('./helper')
    expect(refs.calls).toContain('helper')
  })
})

describe('structuralRefs — negatives (TKT-103)', () => {
  beforeAll(async () => {
    await initParser()
  })

  it('does not capture call-like text inside strings or comments (AST-based)', () => {
    const refs = refsOf('function f() { const s = "ghost()" /* zombie() */ ; return s }')
    expect(refs.calls).not.toContain('ghost')
    expect(refs.calls).not.toContain('zombie')
  })

  it('does not capture a plain identifier reference that is not a call', () => {
    // `value` is read, never called → not a call edge
    expect(refsOf('function f() { const value = 1; return value }').calls).not.toContain('value')
  })
})

describe('structuralRefs — end-to-end over SAMPLE (TKT-103)', () => {
  let chunks: Chunk[]
  beforeAll(async () => {
    await initParser()
    chunks = chunkSource(SAMPLE, SAMPLE_PATH)
  })

  it('greet calls helper and imports ./helper (used binding)', () => {
    const greet = bySymbol(chunks, 'greet')
    expect(greet.structuralRefs.calls).toContain('helper')
    expect(greet.structuralRefs.imports).toContain('./helper')
  })

  it('Service.process calls internal (a local symbol)', () => {
    expect(bySymbol(chunks, 'Service.process').structuralRefs.calls).toContain('internal')
  })

  it('the leading module chunk records the import specifier', () => {
    const moduleWithImport = chunks.find(
      (c) => c.kind === 'module' && c.structuralRefs.imports.includes('./helper'),
    )
    expect(moduleWithImport).toBeDefined()
  })

  it('scopes calls per chunk: greet does not carry internal’s calls', () => {
    expect(bySymbol(chunks, 'greet').structuralRefs.calls).not.toContain('internal')
  })
})
