/**
 * L2 chunk-by-symbol (TKT-102, ADR-004).
 *
 * AST → Chunk[]: one chunk per top-level symbol (function / class / method;
 * interface / type / enum as `other`), plus a `module` chunk for contiguous
 * loose top-level code (imports, value statements). A symbol is the unit — we
 * never split a function mid-body, and we do not recurse into function bodies
 * (only class bodies, to emit method chunks). Oversized symbols are kept whole
 * in M1 (ADR-004). `structuralRefs` is populated via extractStructuralRefs (TKT-103).
 *
 * Design gaps resolved inline (sharpen-the-axe, per-decision):
 *  - export-wrapped decls: `export function f(){}` parses as an `export_statement`
 *    wrapping the declaration → unwrap to name the symbol, but span the whole
 *    export_statement so a citation includes the `export` keyword.
 *  - overload signatures: a body-less `function_declaration` / `function_signature`
 *    is glue, never an empty function chunk (guarded on a `body` field).
 *  - class + method overlap is intentional: both granularities are useful to
 *    retrieval (class-level and method-level citations).
 */
import type Parser from 'web-tree-sitter'
import type { Chunk } from '../contracts/chunk.js'
import { buildChunkId } from './id.js'
import { createParser } from './parser.js'
import { buildImportTable, extractStructuralRefs } from './structural-refs.js'

type SyntaxNode = Parser.SyntaxNode

const DEFAULT_LANG = 'typescript'

/** Convenience: parse + chunk a single source string. Requires {@link initParser}. */
export function chunkSource(source: string, path: string, lang: string = DEFAULT_LANG): Chunk[] {
  const parser = createParser()
  const tree = parser.parse(source)
  return chunkTree(tree, source, path, lang)
}

/** Pure AST → Chunk[] (reuse one parser across many files via the caller). */
export function chunkTree(
  tree: Parser.Tree,
  source: string,
  path: string,
  lang: string = DEFAULT_LANG,
): Chunk[] {
  const chunks: Chunk[] = []
  const lines = source.split('\n')
  const importTable = buildImportTable(tree.rootNode)
  let glue: SyntaxNode[] = []

  const nameOf = (n: SyntaxNode): string | null => n.childForFieldName('name')?.text ?? null

  const makeChunk = (symbol: string, kind: Chunk['kind'], node: SyntaxNode): Chunk => {
    const startLine = node.startPosition.row + 1
    const endLine = node.endPosition.row + 1
    return {
      id: buildChunkId(path, symbol, startLine, endLine),
      path,
      lang,
      symbol,
      kind,
      span: { startLine, endLine },
      code: node.text,
      structuralRefs: extractStructuralRefs([node], importTable),
    }
  }

  const flushGlue = (): void => {
    const first = glue[0]
    const last = glue[glue.length - 1]
    if (first === undefined || last === undefined) return
    const startLine = first.startPosition.row + 1
    const endLine = last.endPosition.row + 1
    chunks.push({
      id: buildChunkId(path, '<module>', startLine, endLine),
      path,
      lang,
      symbol: '<module>',
      kind: 'module',
      span: { startLine, endLine },
      code: lines.slice(startLine - 1, endLine).join('\n'),
      structuralRefs: extractStructuralRefs(glue, importTable),
    })
    glue = []
  }

  /** Qualify a symbol by its enclosing namespace (`Ns.member`), mirroring `Class.method`. */
  const qualify = (prefix: string, name: string): string =>
    prefix === '' ? name : `${prefix}.${name}`

  const emitClass = (decl: SyntaxNode, spanNode: SyntaxNode, prefix = ''): void => {
    const className = qualify(prefix, nameOf(decl) ?? '<anonymous>')
    chunks.push(makeChunk(className, 'class', spanNode))
    const body = decl.childForFieldName('body')
    if (!body) return
    for (const member of body.namedChildren) {
      if (member.type === 'method_definition') {
        const methodName = nameOf(member) ?? '<anonymous>'
        chunks.push(makeChunk(`${className}.${methodName}`, 'method', member))
      }
    }
  }

  /**
   * Classify a declaration. `spanNode` is what the chunk spans (export wrapper if
   * any). `prefix` qualifies members of an enclosing namespace (`Ns.member`).
   * Returns true if a symbol chunk was emitted.
   */
  const handleDecl = (decl: SyntaxNode, spanNode: SyntaxNode, prefix = ''): boolean => {
    switch (decl.type) {
      case 'function_declaration':
      // `function*` / `async function*` parse as a distinct node — same additive
      // switch-case remedy peripheral applied for interface/type/enum (del-029).
      case 'generator_function_declaration': {
        const name = nameOf(decl)
        if (name === null || decl.childForFieldName('body') === null) return false // signature → glue
        flushGlue()
        chunks.push(makeChunk(qualify(prefix, name), 'function', spanNode))
        return true
      }
      case 'class_declaration':
      case 'abstract_class_declaration': {
        flushGlue()
        emitClass(decl, spanNode, prefix)
        return true
      }
      // `namespace X {…}` parses as `internal_module`, `module X {…}` as `module`.
      // Recurse the body like a class body: a container chunk + qualified member
      // chunks, so namespace members are indexed instead of lost to a glue chunk.
      case 'internal_module':
      case 'module': {
        flushGlue()
        const nsName = qualify(prefix, nameOf(decl) ?? '<anonymous>')
        // No 'namespace' kind in the (master-owned) Chunk contract → 'other', as for interface/type/enum.
        chunks.push(makeChunk(nsName, 'other', spanNode))
        const body = decl.childForFieldName('body')
        if (body !== null) {
          for (const member of body.namedChildren) {
            // members may be export-wrapped (`export function dist(){}`) → name the
            // inner decl but span the export statement (matches the top-level loop).
            const inner =
              member.type === 'export_statement' ? member.childForFieldName('declaration') : member
            if (inner !== null) handleDecl(inner, member, nsName)
          }
        }
        return true
      }
      case 'interface_declaration':
      case 'type_alias_declaration':
      case 'enum_declaration': {
        const name = nameOf(decl)
        if (name === null) return false
        flushGlue()
        chunks.push(makeChunk(qualify(prefix, name), 'other', spanNode))
        return true
      }
      case 'lexical_declaration':
      case 'variable_declaration': {
        const declarator = decl.namedChildren.find((c) => c.type === 'variable_declarator')
        const name = declarator?.childForFieldName('name')?.text
        const valueType = declarator?.childForFieldName('value')?.type
        if (
          name !== undefined &&
          (valueType === 'arrow_function' || valueType === 'function_expression')
        ) {
          flushGlue()
          chunks.push(makeChunk(qualify(prefix, name), 'function', spanNode))
          return true
        }
        return false // non-function binding → glue
      }
      default:
        return false
    }
  }

  for (const node of tree.rootNode.namedChildren) {
    if (node.type === 'export_statement') {
      const decl = node.childForFieldName('declaration')
      if (decl !== null) {
        if (!handleDecl(decl, node)) glue.push(node)
        continue
      }
      const value = node.childForFieldName('value')
      if (
        value !== null &&
        (value.type === 'function_expression' ||
          value.type === 'arrow_function' ||
          value.type === 'class')
      ) {
        flushGlue()
        chunks.push(makeChunk('default', value.type === 'class' ? 'class' : 'function', node))
        continue
      }
      glue.push(node) // re-export / `export { ... }` → glue
      continue
    }
    if (!handleDecl(node, node)) glue.push(node)
  }
  flushGlue()

  return chunks
}
