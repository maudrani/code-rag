/**
 * L4 retrieve — the parallel hybrid surface (ADR-003).
 *
 * Runs the direct-hit legs (BM25 + dense) IN PARALLEL (Promise.all — none gates another),
 * derives the structural seeds from their hits + exact symbol-name matches, expands the
 * structural leg one hop, and fuses all three via RRF. Returns the top-`k` RetrievalResult.
 *
 * Legs are INJECTED (LexicalLeg) so the dense leg (TKT-204) and the unified L3 store (TKT-205)
 * slot in without changing this wiring. Built against mock Chunk[]; swaps to ingest-chunk's
 * real output at TKT-103.
 */
import type { Chunk } from '../contracts/chunk.js'
import type { RetrievalResult } from '../contracts/retrieval.js'
import { DEFAULT_RRF_CONFIG, type LegCandidate, type RrfConfig, rrfFuse } from './fuse.js'
import { deriveSeeds } from './seed.js'
import { type StructuralIndex, structuralExpand } from './structural.js'

/** A lexical/semantic leg: top-`limit` candidates for a query. Sync (BM25) or async (ONNX dense). */
export interface LexicalLeg {
  search(query: string, limit: number): LegCandidate[] | Promise<LegCandidate[]>
}

export interface RetrieveDeps {
  bm25: LexicalLeg
  structural: StructuralIndex
  chunks: ReadonlyMap<string, Chunk>
  /** optional until the dense leg lands (TKT-204). */
  dense?: LexicalLeg
}

export interface RetrieveOptions {
  /** final result count. Default 10. */
  k?: number
  /** per-leg candidate pool = k * this (ADR-003: 3-5x). Default 5. */
  candidateMultiplier?: number
  /**
   * how many top BM25/dense hits seed the structural leg. Default = k. The TKT-206 gold-query eval
   * VALIDATED this M1 seeding (BM25 ∪ dense top-N ∪ exact symbol-name): with the dense leg present
   * the exact target is a strong dense direct hit, so it stays on top (keyword recall@10 = 1.0).
   * Dropping BM25 seeding only helped the degraded no-dense mode and slightly hurt the shipped one.
   */
  seedCount?: number
  /** RRF config. Default ADR-003 (k=60, code-weights). */
  rrf?: RrfConfig
}

/**
 * Run a leg, degrading ANY failure — a synchronous throw or an async rejection — to `[]` so a single
 * leg can't sink the whole retrieve. Adopts peripheral vector-adapter's NT-10 "one-leg-down is
 * recoverable" (vector-adapter-parallel-rrf/05-DESIGN.md, GAP C2): the sharp case is a vector
 * dimension mismatch (e.g. a jina 768-vs-384 upgrade) making the dense leg's cosineSimilarity throw —
 * under the bare `Promise.all` that rejection would reject the entire query instead of just dropping
 * the dense signal. BM25 + structural still answer.
 */
async function runLegSafely(
  leg: LexicalLeg | undefined,
  query: string,
  limit: number,
): Promise<LegCandidate[]> {
  if (leg === undefined) return []
  try {
    return await leg.search(query, limit)
  } catch {
    return [] // degrade this leg; the other legs carry the query (parallel, not all-or-nothing)
  }
}

/** Run the three legs in parallel, fuse, return the top-`k` RetrievalResult. */
export async function retrieve(
  query: string,
  deps: RetrieveDeps,
  options: RetrieveOptions = {},
): Promise<RetrievalResult> {
  const k = options.k ?? 10
  const candidateMultiplier = options.candidateMultiplier ?? 5
  const seedCount = options.seedCount ?? k
  const rrf = options.rrf ?? DEFAULT_RRF_CONFIG
  const pool = k * candidateMultiplier

  // direct-hit legs run in parallel — none gates another (ADR-003 parallel-not-cascade). The dense
  // leg is isolated (GAP C2): a throw/rejection degrades it to [] rather than rejecting the retrieve.
  const [bm25, dense] = await Promise.all([
    Promise.resolve(deps.bm25.search(query, pool)),
    runLegSafely(deps.dense, query, pool),
  ])

  // structural seeds = BM25 top-N ∪ dense top-N ∪ exact symbol-name match (the direct hits)
  const directSeedIds = [
    ...bm25.slice(0, seedCount).map((candidate) => candidate.chunkId),
    ...dense.slice(0, seedCount).map((candidate) => candidate.chunkId),
  ]
  const seeds = deriveSeeds(query, directSeedIds, deps.structural)
  const structuralCandidates = structuralExpand(seeds, deps.structural)

  return rrfFuse({ bm25, dense, structural: structuralCandidates }, deps.chunks, rrf).slice(0, k)
}
