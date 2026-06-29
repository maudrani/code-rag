/**
 * Structural-leg seeding (ADR-003, M1 — operator-decided).
 *
 * The structural leg is an EXPANSION leg: it surfaces one-hop call/import neighbours of the
 * query's DIRECT hits. So its seeds ARE the direct hits:
 *   seeds = BM25 top-N  ∪  (dense top-N, when the dense leg lands)  ∪  exact symbol-name match.
 *
 * BM25/dense top-N give "the chunks this query already matched"; the exact symbol-name match
 * covers "where is X called?" even when BM25 misses (the query names a symbol directly).
 * M1 limit: symbol match is EXACT (token === a defined symbol), no fuzzy/partial resolution.
 */
import type { StructuralIndex } from './structural.js'

/**
 * Derive structural seed chunk ids: the caller-provided direct-hit ids (BM25 ∪ dense top-N),
 * plus the defining chunks of any query token that exactly names a symbol in the corpus.
 */
export function deriveSeeds(
  query: string,
  directHitIds: readonly string[],
  structural: StructuralIndex,
): string[] {
  const seeds = new Set<string>(directHitIds)
  // exact symbol-name match: a query token that names a defined symbol seeds its chunk(s)
  const tokens = query.match(/[A-Za-z0-9_]+/g) ?? []
  for (const token of tokens) {
    const definers = structural.definers.get(token)
    if (definers !== undefined) for (const id of definers) seeds.add(id)
  }
  return [...seeds]
}
