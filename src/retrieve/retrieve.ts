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
import {
  pinDefinitions,
  resolveDefinitions,
  type StructuralIndex,
  structuralExpand,
} from './structural.js'
import { extractQuerySymbols } from './symbols.js'

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
  /**
   * Pin the queried symbol's defining chunk at structural rank 0 (FTR-22 definition-boost). Default
   * true. Exposed as a switch so the eval can prove the pin NON-VACUOUS: with it off, the
   * reproduced "how does X work" body drops out of top-k (the gate fails if the behaviour is gone).
   */
  definitionPin?: boolean
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

  // definition-boost (FTR-22): pin the queried symbol's OWN defining chunk at structural rank 0, so
  // the definition the question is about is guaranteed a strong fused contribution — it would
  // otherwise lose to its smaller deps + the BM25 length penalty (the reproduced "how does X work"
  // gap). Pure + deterministic; degrades to a no-op when the query resolves no symbol; rides the
  // structural leg, so RankedChunk.scores stays {bm25,dense,structural} (no contract change).
  const definitionIds =
    options.definitionPin === false
      ? []
      : resolveDefinitions(extractQuerySymbols(query), deps.structural)
  const structural = pinDefinitions(structuralCandidates, definitionIds, deps.structural)

  const fused = rrfFuse({ bm25, dense, structural }, deps.chunks, rrf)
  return guaranteeDefinitions(fused, definitionIds, k)
}

/**
 * The definition-boost SAFETY NET (FTR-22). The structural-rank-0 pin (pinDefinitions) lifts the
 * queried symbol's definition HIGH in the ranking, but it is not airtight: a strong dense leg can
 * flood the top-k and push a pinned-but-weak definition past the cutoff (observed with the real
 * ONNX leg). This guarantees PRESENCE: any resolved definition that fell outside top-k is rescued
 * back in.
 *
 * Order is preserved: `fused` is sorted desc, so a rescued definition (which ranked BELOW k) has a
 * fused score <= every retained top-k entry — appending it at the tail keeps the list sorted desc
 * by `fused` (the RetrievalResult contract holds). The pin decides the definition's RANK; this only
 * decides its INCLUSION. A no-op when nothing is pinned (definitionIds empty) — identical to the
 * pre-FTR-22 `fused.slice(0, k)`.
 */
function guaranteeDefinitions(
  fused: RetrievalResult,
  definitionIds: readonly string[],
  k: number,
): RetrievalResult {
  const top = fused.slice(0, k)
  if (definitionIds.length === 0 || k <= 0) return top
  const present = new Set(top.map((r) => r.chunk.id))
  const wanted = new Set(definitionIds)
  const rescued = fused.filter((r) => wanted.has(r.chunk.id) && !present.has(r.chunk.id))
  if (rescued.length === 0) return top
  const keep = Math.max(0, k - rescued.length)
  return [...top.slice(0, keep), ...rescued.slice(0, k - keep)]
}
