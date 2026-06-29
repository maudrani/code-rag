/**
 * Stable chunk identity (ADR-002/004): `${path}#${symbol}@${startLine}-${endLine}`.
 *
 * Minimal vs production: peripheral-hub's codegraph uses SCIP-style symbol
 * identity; M1 uses this path+symbol+span form (one-hop, single-language) and
 * cites the production scheme in the README (IP discipline).
 */
export function buildChunkId(
  path: string,
  symbol: string,
  startLine: number,
  endLine: number,
): string {
  return `${path}#${symbol}@${startLine}-${endLine}`
}
