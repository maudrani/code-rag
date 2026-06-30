/**
 * Retrieval IR eval harness — recall@k / MRR / nDCG@k over query buckets (ADR-003, TKT-206).
 *
 * Retrieval metrics are kept SEPARATE from generation (the rag-retrieval rule): this scores the
 * RANKING quality of `retrieve()` alone, against a gold-query set, bucketed by query type
 * (keyword / mixed / semantic / zero-id). The zero-id bucket is the cascade-failure-mode probe —
 * BM25 alone returns ~nothing for those, so the bucket's score is what the parallel dense+structural
 * legs recover (the empirical case for parallel-not-cascade).
 *
 * Pure + deterministic: binary relevance via a predicate over the corpus, standard IR formulas.
 */
import type { Chunk } from '../contracts/chunk.js'
import type { RetrievalResult } from '../contracts/retrieval.js'

/** Query buckets (ADR-003 eval-set): exact-identifier, identifier+NL, pure-NL, and BM25-blind NL. */
export type Bucket = 'keyword' | 'mixed' | 'semantic' | 'zero-id'

/** Is this chunk relevant to a gold query? (binary relevance over the corpus). */
export type RelevanceFn = (chunk: Chunk) => boolean

export interface GoldQuery {
  bucket: Bucket
  query: string
  /** the chunk(s) a correct ranking must surface. */
  relevant: RelevanceFn
}

/**
 * Distinct-by-chunk-id view of a ranking — first occurrence wins, rank order preserved. Guards the
 * IR metrics against a ranking that repeats a chunk id, which would otherwise count the same hit
 * twice and push recall / nDCG out of [0,1] (peripheral rag-eval-harness contract: "duplicate ids
 * counted once" — rag-eval-harness/01-VISION.md, GAP C1).
 */
function dedupeById(ranked: RetrievalResult): RetrievalResult {
  const seen = new Set<string>()
  const out: RetrievalResult = []
  for (const r of ranked) {
    if (seen.has(r.chunk.id)) continue
    seen.add(r.chunk.id)
    out.push(r)
  }
  return out
}

/** recall@k = |relevant ∩ top-k| / |relevant in corpus|. 0 when nothing relevant exists or k<=0. */
export function recallAtK(
  ranked: RetrievalResult,
  isRelevant: RelevanceFn,
  k: number,
  relevantTotal: number,
): number {
  if (relevantTotal <= 0 || k <= 0) return 0 // k<=0 guards a negative-index slice leak (GAP C1)
  let hits = 0
  for (const r of dedupeById(ranked).slice(0, k)) if (isRelevant(r.chunk)) hits++
  return hits / relevantTotal
}

/** Reciprocal rank of the FIRST relevant result (1-indexed); 0 if none are present. */
export function reciprocalRank(ranked: RetrievalResult, isRelevant: RelevanceFn): number {
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]
    if (r !== undefined && isRelevant(r.chunk)) return 1 / (i + 1)
  }
  return 0
}

/** nDCG@k with binary relevance: DCG@k / ideal-DCG@k (ideal = all relevant first). 0 when k<=0. */
export function ndcgAtK(
  ranked: RetrievalResult,
  isRelevant: RelevanceFn,
  k: number,
  relevantTotal: number,
): number {
  if (k <= 0) return 0 // k<=0 guards a negative-index slice leak (GAP C1)
  let dcg = 0
  const top = dedupeById(ranked).slice(0, k) // duplicate ids counted once ⇒ dcg <= idcg ⇒ ndcg in [0,1]
  for (let i = 0; i < top.length; i++) {
    const r = top[i]
    if (r !== undefined && isRelevant(r.chunk)) dcg += 1 / Math.log2(i + 2)
  }
  let idcg = 0
  for (let i = 0; i < Math.min(relevantTotal, k); i++) idcg += 1 / Math.log2(i + 2)
  return idcg === 0 ? 0 : dcg / idcg
}

export interface QueryScore {
  recallAtK: number
  rr: number
  ndcgAtK: number
  /** true if at least one relevant chunk made the top-k. */
  hit: boolean
}

/** Score one query's ranking against its relevance + the corpus-wide relevant count. */
export function scoreQuery(
  ranked: RetrievalResult,
  isRelevant: RelevanceFn,
  k: number,
  relevantTotal: number,
): QueryScore {
  return {
    recallAtK: recallAtK(ranked, isRelevant, k, relevantTotal),
    rr: reciprocalRank(ranked, isRelevant),
    ndcgAtK: ndcgAtK(ranked, isRelevant, k, relevantTotal),
    hit: recallAtK(ranked, isRelevant, k, relevantTotal) > 0,
  }
}

export interface BucketReport {
  bucket: string
  n: number
  recallAtK: number
  mrr: number
  ndcgAtK: number
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length

/** Average per-query scores into a per-bucket + overall report. */
export function aggregate(rows: { bucket: string; score: QueryScore }[]): {
  perBucket: BucketReport[]
  overall: BucketReport
} {
  const byBucket = new Map<string, QueryScore[]>()
  for (const { bucket, score } of rows) {
    const list = byBucket.get(bucket)
    if (list === undefined) byBucket.set(bucket, [score])
    else list.push(score)
  }
  const report = (bucket: string, scores: QueryScore[]): BucketReport => ({
    bucket,
    n: scores.length,
    recallAtK: mean(scores.map((s) => s.recallAtK)),
    mrr: mean(scores.map((s) => s.rr)),
    ndcgAtK: mean(scores.map((s) => s.ndcgAtK)),
  })
  const perBucket = [...byBucket.entries()]
    .map(([bucket, scores]) => report(bucket, scores))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
  return {
    perBucket,
    overall: report(
      'overall',
      rows.map((r) => r.score),
    ),
  }
}

/** Render a report as a fixed-width table (the README-citable artifact). */
export function formatReport(perBucket: BucketReport[], overall: BucketReport, k: number): string {
  const row = (r: BucketReport): string =>
    `${r.bucket.padEnd(10)} ${String(r.n).padStart(3)}  ${r.recallAtK.toFixed(3)}     ${r.mrr.toFixed(3)}  ${r.ndcgAtK.toFixed(3)}`
  const header = `bucket       n  recall@${k}   mrr   ndcg@${k}`
  return [header, ...perBucket.map(row), '─'.repeat(header.length), row(overall)].join('\n')
}
