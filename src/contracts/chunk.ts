/**
 * Chunk — L2 output / L3 input (ADR-002, ADR-004).
 * A code chunk by symbol (function/class/method), with the structural signal
 * tree-sitter extracts. Emitted by `ingest-chunk`, consumed by `retrieval`.
 */
export interface Chunk {
  /** stable id: `${path}#${symbol}@${startLine}-${endLine}` */
  id: string
  path: string
  lang: string
  /** function / class / method name (or a synthetic name for module-level code) */
  symbol: string
  kind: 'function' | 'class' | 'method' | 'module' | 'other'
  span: { startLine: number; endLine: number }
  code: string
  /** structural signal (ADR-004): callee symbol names + imported modules, from the AST */
  structuralRefs: { calls: string[]; imports: string[] }
}

/**
 * SymbolEntry — a symbol read-surface entry: a {@link Chunk} projected to its IDENTITY (path,
 * symbol, kind, lang, span) WITHOUT the id/body/structuralRefs. Feeds `/symbols` (autocomplete +
 * a corpus tree the client folds from `path`). Wire-safe (no code payload).
 */
export interface SymbolEntry {
  path: string
  symbol: string
  kind: Chunk['kind']
  lang: string
  span: { startLine: number; endLine: number }
}
