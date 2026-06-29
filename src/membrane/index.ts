import type { CreateEngine, Engine } from '../contracts/index.js'

/**
 * The membrane — master-owned (the seam, ADR-002). Orchestrates the per-query order:
 *   L0 resolve (deterministic anaphora gate + provider.rewrite residue)
 *     -> L4 retrieve -> project (SSOT) -> [L5 answer, streamed when band==='answer'].
 * Composes the specialist layers via the contracts; emits Events on the bus.
 *
 * SKELETON — the master fills this at integration (post-specialist), wiring
 * ingest-chunk + retrieval + answer behind the Projection contract. Until the
 * layers land, specialists build against `src/contracts/` + mocks.
 */
export const createEngine: CreateEngine = (_config): Engine => {
  throw new Error('membrane: not implemented yet — master integration (post-specialist)')
}
