/**
 * NL -> symbol capture (FTR-22, the definition-boost front-end).
 *
 * Pure, deterministic, no LLM. `extractQuerySymbols` is a GENEROUS capture: it pulls every
 * candidate symbol token (identifier, qualified `A.b`, method() call, slash-path) out of a
 * natural-language query. Precision is deliberately NOT its job — `resolveDefinitions`
 * (structural.ts) is the filter, matching candidates against the REAL corpus symbol table, so a
 * non-symbol word like "how" simply resolves to nothing. This capture/resolve split mirrors
 * peripheral's routing/query-shape.ts shape regexes, EXTENDED from a boolean classifier to a
 * capturing one (peripheral stops at "does this look like code?"; we return the tokens).
 */

/**
 * A code-token: an identifier, optionally chained by `.` (qualified symbol) or `/` (path).
 * Parentheses, operators and punctuation terminate a token, so `getUserById()` yields
 * `getUserById` and `Auth.login` stays one token. Numeric literals (`2.0`) never start a token.
 */
const SYMBOL_TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*(?:[./][A-Za-z_$][A-Za-z0-9_$]*)*/g

/** Last descriptor of a (possibly qualified) symbol: `Auth.login` -> `login`, `parse` -> `parse`. */
export function shortNameOf(symbol: string): string {
  const dot = symbol.lastIndexOf('.')
  return dot >= 0 ? symbol.slice(dot + 1) : symbol
}

/**
 * Does this token carry a code SHAPE (a camelCase hump, a dot, a slash, or an underscore)?
 * Gates the short-name resolution fallback in `resolveDefinitions`: a code-shaped `Auth.login`
 * may resolve by its short name `login`, but a plain English-looking word (`login`, `get`, `index`)
 * resolves ONLY by an exact full-symbol match — never fuzzily — so prose can't pin a method.
 */
export function isCodeShaped(token: string): boolean {
  return (
    token.includes('.') || token.includes('/') || token.includes('_') || /[a-z][A-Z]/.test(token) // a lower->upper hump: camelCase + interior-cap PascalCase
  )
}

/**
 * Capture candidate symbol tokens from a query, in first-occurrence order, deduplicated.
 * Single characters are dropped (not a symbol worth pinning). Generous by design — the resolver
 * filters against the corpus.
 */
export function extractQuerySymbols(query: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of query.matchAll(SYMBOL_TOKEN)) {
    const token = match[0]
    if (token.length < 2 || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}
