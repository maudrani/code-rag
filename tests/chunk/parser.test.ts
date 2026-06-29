import { beforeAll, describe, expect, it } from 'vitest'
import { createParser, initParser, parse } from '../../src/chunk/parser.js'

// TKT-101 — parser foundation. Test-first (RULE-PROD-001): every branch + edge +
// negative. The grammar wasm is vendored at src/chunk/grammars/typescript.wasm.

const SAMPLE = `import { bar } from './b'
export function foo(a: number): number {
  return bar(a)
}
class C {
  m(): number {
    return 1
  }
}
`

// Negative case runs FIRST, before any initParser() call in this file, so the
// module-level "not initialised" guard is exercised deterministically (vitest
// executes tests in declaration order within a file).
describe('parser guard (TKT-101, before init)', () => {
  it('createParser throws a clear error when used before init', () => {
    expect(() => createParser()).toThrow(/initialis|initializ|init/i)
  })
})

describe('parser foundation (TKT-101)', () => {
  beforeAll(async () => {
    await initParser()
  })

  it('parses TS source into a `program` AST', () => {
    const tree = parse(SAMPLE)
    expect(tree.rootNode.type).toBe('program')
  })

  it('exposes expected top-level node kinds (export-wrapped fn, class, import)', () => {
    const tree = parse(SAMPLE)
    const kinds = tree.rootNode.namedChildren.map((n) => n.type)
    expect(kinds).toContain('import_statement')
    // `export function` is an export_statement wrapping the declaration — the
    // chunker (TKT-102) must unwrap it. Asserted here so the contract is pinned.
    expect(kinds).toContain('export_statement')
    expect(kinds).toContain('class_declaration')
  })

  it('reports 1-based line spans usable as chunk spans', () => {
    const tree = parse(SAMPLE)
    const cls = tree.rootNode.namedChildren.find((n) => n.type === 'class_declaration')
    expect(cls).toBeDefined()
    // class C spans lines 5..9 in SAMPLE (1-based, inclusive)
    expect((cls?.startPosition.row ?? -1) + 1).toBe(5)
    expect((cls?.endPosition.row ?? -1) + 1).toBe(9)
  })

  it('is error-tolerant: malformed source yields a tree with hasError, never throws', () => {
    expect(() => parse('function (')).not.toThrow()
    const tree = parse('function (')
    expect(tree.rootNode.hasError).toBe(true)
  })

  it('handles empty source as a valid empty program (no crash)', () => {
    const tree = parse('')
    expect(tree.rootNode.type).toBe('program')
    expect(tree.rootNode.namedChildren.length).toBe(0)
  })

  it('initParser is idempotent (safe to call repeatedly)', async () => {
    await initParser()
    await initParser()
    expect(() => createParser()).not.toThrow()
  })
})
