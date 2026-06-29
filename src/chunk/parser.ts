/**
 * L2 parser foundation (TKT-101, ADR-004).
 *
 * Wraps web-tree-sitter: initialise the runtime once, load the vendored
 * TypeScript grammar (`grammars/typescript.wasm`, MIT — provenance in the
 * per-layer doc), and parse a source string into a tree-sitter AST.
 *
 * Why WASM (GAP-1, operator-confirmed): no node-gyp / native build → aligns with
 * clone-and-run (ADR-006) and the no-native-deps stance (ADR-003). The grammar
 * is vendored in this dir so there is no postinstall download.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Parser from 'web-tree-sitter'

/** Resolved relative to THIS module so it works from src (vitest) and dist (build copies the wasm). */
const GRAMMAR_PATH = join(dirname(fileURLToPath(import.meta.url)), 'grammars', 'typescript.wasm')

// Module singletons: the emscripten runtime is process-global, and the grammar
// is immutable — load each once, then create many parsers (init-once/parse-many).
let runtimeInitialised = false
let tsLanguage: Parser.Language | null = null

/**
 * Initialise the tree-sitter runtime and load the TypeScript grammar.
 * Idempotent: safe to call repeatedly (subsequent calls are no-ops).
 */
export async function initParser(): Promise<void> {
  if (!runtimeInitialised) {
    await Parser.init()
    runtimeInitialised = true
  }
  if (tsLanguage === null) {
    tsLanguage = await Parser.Language.load(GRAMMAR_PATH)
  }
}

/**
 * Create a parser bound to the loaded TypeScript grammar.
 * @throws if called before {@link initParser} — fail loud, never return a
 *   half-configured parser (RULE-PROD-001: no silent half-states).
 */
export function createParser(): Parser {
  if (tsLanguage === null) {
    throw new Error('Parser not initialised — call initParser() before createParser().')
  }
  const parser = new Parser()
  parser.setLanguage(tsLanguage)
  return parser
}

/**
 * Parse TypeScript source into a tree-sitter `Tree`.
 * tree-sitter is error-tolerant: malformed input yields a tree whose nodes carry
 * `hasError`, it does NOT throw. Pass a reusable `parser` to avoid per-call setup.
 */
export function parse(source: string, parser?: Parser): Parser.Tree {
  const p = parser ?? createParser()
  return p.parse(source)
}
