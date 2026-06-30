import type { RankedChunk } from '../contracts/index.js'

/**
 * did-you-mean (FTR-32 / TKT-309) — a pure, deterministic near-miss symbol suggester.
 *
 * When a query names a symbol that the index does NOT contain but a close one WAS retrieved
 * (the BM25 leg still surfaces `useChatStream` for `useStreamChat` on the shared sub-tokens),
 * `suggestSymbol` returns that close symbol so the membrane can soften a dry refuse into
 * "Did you mean `useChatStream`?". No LLM, no I/O, no index access — the retrieved set IS the
 * candidate pool (GAP-8).
 *
 * Why sub-token normalization, not plain edit distance: the canonical miss
 * (`useStreamChat` -> `useChatStream`) is a token REORDER — plain Levenshtein scores it FAR
 * apart. Splitting each identifier into its camelCase/snake sub-tokens and SORTING them makes
 * a reorder distance-0 while still catching ordinary typos, which is the behavior code search
 * actually needs. Zero runtime dependency (the fuzzy-match prior art is reimplemented here).
 */

/** Below this normalized sub-token distance, two identifiers are "the same symbol, mistyped". */
const MAX_DISTANCE = 0.34

/** Shortest identifier worth matching (avoids noise from 1–3 char tokens). */
const MIN_IDENT_LEN = 4

/** Levenshtein edit distance between two strings (classic DP, O(a*b)). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let curr = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      // biome-ignore lint/style/noNonNullAssertion: i,j are in-bounds by the loop guards.
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  // biome-ignore lint/style/noNonNullAssertion: prev[n] is always populated after the loop.
  return prev[n]!
}

/** Split an identifier into lowercase sub-tokens at camelCase + snake/space + digit boundaries. */
function subtokens(ident: string): string[] {
  return ident
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\s]+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter((t) => t.length > 0)
}

/** Order-independent key for an identifier: its sub-tokens, sorted + joined. */
function identKey(ident: string): string {
  return subtokens(ident).sort().join(' ')
}

/** Normalized edit distance in [0,1] over the order-independent keys. */
function symbolDistance(a: string, b: string): number {
  const ka = identKey(a)
  const kb = identKey(b)
  const max = Math.max(ka.length, kb.length)
  return max === 0 ? 0 : levenshtein(ka, kb) / max
}

/**
 * Identifier-shaped tokens in the query: backtick-quoted spans, or camelCase / snake_case
 * tokens (an internal uppercase or an underscore). Plain prose words are excluded so the
 * suggester never fuzzy-matches "authentication" against a symbol.
 */
function queryIdentifiers(query: string): string[] {
  const quoted = [...query.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '')
  const tokens = query.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []
  const shaped = tokens.filter((t) => /[a-z][A-Z]|[A-Z][a-z].*[A-Z]|_/.test(t))
  return [...new Set([...quoted, ...shaped].filter((t) => t.length >= MIN_IDENT_LEN))]
}

/**
 * The nearest retrieved symbol to an identifier the query names but the index lacks, or null.
 *
 * Returns null when: the named symbol is actually present (it was found — nothing to suggest),
 * the query names no identifier-shaped token, retrieval is empty, or nothing is within
 * MAX_DISTANCE. Deterministic tie-break: smallest distance, then the shortest symbol, then
 * lexicographic — so the suggestion is stable across runs.
 */
export function suggestSymbol(query: string, retrieval: RankedChunk[]): string | null {
  const candidates = [
    ...new Set(retrieval.map((r) => r.chunk.symbol).filter((s) => s.length >= MIN_IDENT_LEN)),
  ]
  if (candidates.length === 0) return null

  const idents = queryIdentifiers(query)
  if (idents.length === 0) return null

  // If the query's identifier is already a retrieved symbol, it was found — never suggest.
  const present = new Set(candidates.map((c) => c.toLowerCase()))
  if (idents.some((id) => present.has(id.toLowerCase()))) return null

  let best: { symbol: string; dist: number } | null = null
  for (const id of idents) {
    for (const c of candidates) {
      const dist = symbolDistance(id, c)
      if (dist > MAX_DISTANCE) continue
      if (
        best === null ||
        dist < best.dist ||
        (dist === best.dist && c.length < best.symbol.length) ||
        (dist === best.dist && c.length === best.symbol.length && c < best.symbol)
      ) {
        best = { symbol: c, dist }
      }
    }
  }
  return best?.symbol ?? null
}
