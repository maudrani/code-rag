/**
 * structuralRefs extraction (TKT-103, ADR-004) — the third RRF leg's signal
 * (ADR-003). NOT metadata: `calls` + `imports` let retrieval pull one-hop
 * call-graph / import neighbours of a query-matched symbol.
 *
 *  - calls   = callee symbol names invoked in the chunk body: direct `f()`,
 *              method `o.m()` (property name), constructor `new C()`, and every
 *              callee in a chain `a.b().c()`. `require(...)` / `import(...)` are
 *              import edges, not calls.
 *  - imports = module specifiers the chunk depends on: import/export-from
 *              statements it contains, dynamic `import()` / `require()` it runs,
 *              and the modules of any imported bindings it references.
 *
 * M1 limits (documented, vs the production codegraph's 2-pass resolver):
 *  - no scope/shadow resolution — a local named like an import resolves to the
 *    import; acceptable for a one-hop signal.
 *  - AST-based, so call-like text in strings/comments is never captured.
 */
import type Parser from 'web-tree-sitter'

type SyntaxNode = Parser.SyntaxNode

/** `require` is a CommonJS import edge, not a call. */
const IMPORT_CALL_NAMES: ReadonlySet<string> = new Set(['require'])

function stripQuotes(text: string): string {
  return text.replace(/^['"`]/, '').replace(/['"`]$/, '')
}

/** binding name → module specifier, for the file's static imports. */
export function buildImportTable(root: SyntaxNode): Map<string, string> {
  const table = new Map<string, string>()
  for (const node of root.namedChildren) {
    if (node.type !== 'import_statement') continue
    const source = node.childForFieldName('source')
    if (source === null) continue
    const specifier = stripQuotes(source.text)
    const clause = node.namedChildren.find((c) => c.type === 'import_clause')
    if (clause === undefined) continue // side-effect import: no bindings
    for (const part of clause.namedChildren) {
      if (part.type === 'identifier') {
        table.set(part.text, specifier) // default import
      } else if (part.type === 'namespace_import') {
        const id = part.namedChildren.find((c) => c.type === 'identifier')
        if (id !== undefined) table.set(id.text, specifier)
      } else if (part.type === 'named_imports') {
        for (const spec of part.namedChildren) {
          if (spec.type !== 'import_specifier') continue
          const binding = (spec.childForFieldName('alias') ?? spec.childForFieldName('name'))?.text
          if (binding !== undefined) table.set(binding, specifier)
        }
      }
    }
  }
  return table
}

/** Extract `{ calls, imports }` from a chunk's AST node(s), de-duplicated + sorted. */
export function extractStructuralRefs(
  nodes: SyntaxNode[],
  importTable: Map<string, string>,
): { calls: string[]; imports: string[] } {
  const calls = new Set<string>()
  const imports = new Set<string>()

  const firstStringArg = (call: SyntaxNode): string | null => {
    const args = call.childForFieldName('arguments')
    const str = args?.namedChildren.find((c) => c.type === 'string')
    return str !== undefined ? stripQuotes(str.text) : null
  }

  const visit = (node: SyntaxNode): void => {
    switch (node.type) {
      case 'import_statement':
      case 'export_statement': {
        const source = node.childForFieldName('source') // null unless `... from '...'`
        if (source !== null) imports.add(stripQuotes(source.text))
        break
      }
      case 'call_expression': {
        const fn = node.childForFieldName('function')
        if (fn !== null) {
          if (fn.type === 'import') {
            const spec = firstStringArg(node)
            if (spec !== null) imports.add(spec)
          } else if (fn.type === 'identifier') {
            if (IMPORT_CALL_NAMES.has(fn.text)) {
              const spec = firstStringArg(node)
              if (spec !== null) imports.add(spec)
            } else {
              calls.add(fn.text)
            }
          } else if (fn.type === 'member_expression') {
            const prop = fn.childForFieldName('property')
            if (prop !== null) calls.add(prop.text)
          }
        }
        break
      }
      case 'new_expression': {
        const ctor = node.childForFieldName('constructor')
        if (ctor !== null) {
          if (ctor.type === 'identifier') calls.add(ctor.text)
          else if (ctor.type === 'member_expression') {
            const prop = ctor.childForFieldName('property')
            if (prop !== null) calls.add(prop.text)
          }
        }
        break
      }
      case 'identifier': {
        const spec = importTable.get(node.text) // a referenced imported binding
        if (spec !== undefined) imports.add(spec)
        break
      }
      default:
        break
    }
    for (const child of node.namedChildren) visit(child)
  }

  for (const node of nodes) visit(node)

  return { calls: [...calls].sort(), imports: [...imports].sort() }
}
