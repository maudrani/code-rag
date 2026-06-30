/**
 * Retrieval IR eval — gold-query recall@10 / MRR / nDCG@10 over 4 buckets (ADR-003, TKT-206).
 *
 * Two tiers:
 *   - The pure metric maths (recall/MRR/nDCG) — hand-checked, always runs.
 *   - The eval over the REAL self-indexed `src/` corpus (ADR-006 self-index, via ingest-chunk's
 *     ingestAndChunk). Offline tier = BM25 + structural only (no network → CI-safe). The RUN_SLOW
 *     tier adds the real ONNX dense leg and is the README-citable number; it proves the dense leg
 *     recovers the zero-id (BM25-blind) bucket — the empirical case for parallel-not-cascade.
 */
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { beforeAll, describe, expect, it } from 'vitest'
import { ingestAndChunk, initParser } from '../../src/chunk/index.js'
import type { Chunk } from '../../src/contracts/chunk.js'
import type { RetrievalResult } from '../../src/contracts/retrieval.js'
import { createOnnxEmbedder, type Embedder } from '../../src/index/embed.js'
import { SqliteStore } from '../../src/index/store.js'
import {
  aggregate,
  formatReport,
  type GoldQuery,
  ndcgAtK,
  type RelevanceFn,
  recallAtK,
  reciprocalRank,
  scoreQuery,
} from '../../src/retrieve/eval.js'
import { retrieve } from '../../src/retrieve/retrieve.js'

const RUN_SLOW = process.env.RUN_SLOW === '1'
const K = 10
const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url))

// ── pure metric maths ────────────────────────────────────────────────────────
const fakeChunk = (id: string): Chunk => ({
  id,
  path: id,
  lang: 'ts',
  symbol: id,
  kind: 'function',
  span: { startLine: 1, endLine: 1 },
  code: '',
  structuralRefs: { calls: [], imports: [] },
})
const ranked = (ids: string[]): RetrievalResult =>
  ids.map((id) => ({
    chunk: fakeChunk(id),
    scores: { bm25: 0, dense: 0, structural: 0 },
    fused: 0,
  }))
const isTarget = (chunk: Chunk): boolean => chunk.id === 'target'

describe('IR metrics', () => {
  it('recall@k counts relevant in the top-k over the corpus total', () => {
    expect(recallAtK(ranked(['target', 'a', 'b']), isTarget, K, 1)).toBe(1)
    expect(recallAtK(ranked(['a', 'b']), isTarget, K, 1)).toBe(0)
    expect(recallAtK(ranked(['target', 'a']), isTarget, K, 2)).toBe(0.5) // 1 of 2 relevant found
  })

  it('recall@k respects the cutoff (relevant beyond k does not count)', () => {
    expect(recallAtK(ranked(['a', 'b', 'c', 'd', 'target']), isTarget, 3, 1)).toBe(0)
  })

  it('reciprocal rank is 1/rank of the first relevant, 0 if absent', () => {
    expect(reciprocalRank(ranked(['target', 'a']), isTarget)).toBe(1)
    expect(reciprocalRank(ranked(['a', 'b', 'target']), isTarget)).toBeCloseTo(1 / 3, 6)
    expect(reciprocalRank(ranked(['a', 'b']), isTarget)).toBe(0)
  })

  it('nDCG@k is 1 at rank 1, 0.5 at rank 3, 0 when absent (single relevant)', () => {
    expect(ndcgAtK(ranked(['target']), isTarget, K, 1)).toBe(1)
    expect(ndcgAtK(ranked(['a', 'b', 'target']), isTarget, K, 1)).toBeCloseTo(0.5, 6) // 1/log2(4)
    expect(ndcgAtK(ranked(['a', 'b']), isTarget, K, 1)).toBe(0)
  })

  it('nDCG@k is 1 when all relevant fill the top ranks (ideal ordering)', () => {
    const isAB = (c: Chunk): boolean => c.id === 'a' || c.id === 'b'
    expect(ndcgAtK(ranked(['a', 'b', 'x']), isAB, K, 2)).toBeCloseTo(1, 6)
  })

  it('aggregate averages per bucket + overall', () => {
    const s = (recall: number): ReturnType<typeof scoreQuery> => ({
      recallAtK: recall,
      rr: recall,
      ndcgAtK: recall,
      hit: recall > 0,
    })
    const { perBucket, overall } = aggregate([
      { bucket: 'keyword', score: s(1) },
      { bucket: 'keyword', score: s(0) },
      { bucket: 'semantic', score: s(1) },
    ])
    expect(perBucket.find((b) => b.bucket === 'keyword')?.recallAtK).toBe(0.5)
    expect(overall.recallAtK).toBeCloseTo(2 / 3, 6)
  })
})

// ── gold-query set over the repo's own source (self-index) ────────────────────
/** relevant = the chunk defining `symbol` in a file whose path ends with `file`. */
const defines =
  (symbol: string, file: string): GoldQuery['relevant'] =>
  (chunk) =>
    chunk.symbol === symbol && chunk.path.endsWith(file)

const GOLD: GoldQuery[] = [
  // keyword — the exact identifier is in the query (BM25 should nail it)
  { bucket: 'keyword', query: 'rrfFuse', relevant: defines('rrfFuse', 'fuse.ts') },
  { bucket: 'keyword', query: 'Bm25Index', relevant: defines('Bm25Index', 'bm25.ts') },
  {
    bucket: 'keyword',
    query: 'cosineSimilarity',
    relevant: defines('cosineSimilarity', 'dense.ts'),
  },
  {
    bucket: 'keyword',
    query: 'buildStructuralIndex',
    relevant: defines('buildStructuralIndex', 'structural.ts'),
  },
  { bucket: 'keyword', query: 'ingestAndChunk', relevant: defines('ingestAndChunk', 'index.ts') },
  {
    bucket: 'keyword',
    query: 'createOnnxEmbedder',
    relevant: defines('createOnnxEmbedder', 'embed.ts'),
  },

  // mixed — an identifier-ish token + natural language
  {
    bucket: 'mixed',
    query: 'splitIdentifiers camelCase tokens',
    relevant: defines('splitIdentifiers', 'bm25.ts'),
  },
  { bucket: 'mixed', query: 'rrf fusion of ranked legs', relevant: defines('rrfFuse', 'fuse.ts') },
  {
    bucket: 'mixed',
    query: 'structuralExpand one hop neighbours',
    relevant: defines('structuralExpand', 'structural.ts'),
  },
  { bucket: 'mixed', query: 'walk the repo files', relevant: defines('walk', 'walker.ts') },
  {
    bucket: 'mixed',
    query: 'deriveSeeds from the query',
    relevant: defines('deriveSeeds', 'seed.ts'),
  },

  // semantic — pure NL, the target identifier is NOT in the query (dense helps)
  {
    bucket: 'semantic',
    query: 'combine results from several search methods into one ranking',
    relevant: defines('rrfFuse', 'fuse.ts'),
  },
  {
    bucket: 'semantic',
    query: 'load a local model and turn text into a vector',
    relevant: defines('createOnnxEmbedder', 'embed.ts'),
  },
  {
    bucket: 'semantic',
    query: 'walk a directory tree and collect source files',
    relevant: defines('walk', 'walker.ts'),
  },
  {
    bucket: 'semantic',
    query: 'keep search data in a single sqlite file',
    relevant: defines('SqliteStore', 'store.ts'),
  },
  {
    bucket: 'semantic',
    query: 'build a call graph and import graph from code',
    relevant: defines('buildStructuralIndex', 'structural.ts'),
  },

  // zero-id — NL with no token that the BM25 leg can latch onto (dense + structural carry it)
  {
    bucket: 'zero-id',
    query: 'how close in direction are two numeric arrays',
    relevant: defines('cosineSimilarity', 'dense.ts'),
  },
  {
    bucket: 'zero-id',
    query: 'scale a list of numbers so its magnitude is one',
    relevant: defines('l2Normalize', 'embed.ts'),
  },
  {
    bucket: 'zero-id',
    query: 'find code reachable from a matched symbol',
    relevant: defines('structuralExpand', 'structural.ts'),
  },
  {
    bucket: 'zero-id',
    query: 'turn a list of floats into bytes to save on disk',
    relevant: defines('encodeVector', 'embed.ts'),
  },
  {
    bucket: 'zero-id',
    query: 'produce embeddings without paying for an api',
    relevant: defines('createOnnxEmbedder', 'embed.ts'),
  },
  {
    bucket: 'zero-id',
    query: 'pick which chunks to grow the graph from',
    relevant: defines('deriveSeeds', 'seed.ts'),
  },
]

describe('gold-query set', () => {
  it('has >= 20 queries across all four buckets', () => {
    expect(GOLD.length).toBeGreaterThanOrEqual(20)
    expect(new Set(GOLD.map((g) => g.bucket))).toEqual(
      new Set(['keyword', 'mixed', 'semantic', 'zero-id']),
    )
  })
})

// ── eval over the real self-indexed corpus ────────────────────────────────────
describe('retrieval eval over the self-indexed src/ corpus', () => {
  let chunks: Chunk[]
  beforeAll(async () => {
    await initParser()
    chunks = ingestAndChunk(SRC_ROOT).chunks
  })

  /** Score the whole gold set over a store built with (or without) the dense embedder. */
  const runEval = async (embedder?: Embedder): Promise<ReturnType<typeof aggregate>> => {
    const store = new SqliteStore()
    await store.index(chunks, embedder ? { embedder } : {})
    const deps = store.retrievalDeps(embedder)
    const rows: { bucket: string; score: ReturnType<typeof scoreQuery> }[] = []
    for (const g of GOLD) {
      const result = await retrieve(g.query, deps, { k: K })
      const relevantTotal = chunks.filter(g.relevant).length
      rows.push({ bucket: g.bucket, score: scoreQuery(result, g.relevant, K, relevantTotal) })
    }
    store.close()
    return aggregate(rows)
  }

  it('every gold target exists in the self-indexed corpus', () => {
    const missing = GOLD.filter((g) => chunks.filter(g.relevant).length === 0).map((g) => g.query)
    expect(missing).toEqual([])
  })

  it('offline (BM25 + structural): harness is well-formed; lexical buckets beat NL buckets', async () => {
    const { perBucket, overall } = await runEval()
    console.log(`\n[offline: BM25 + structural, no dense]\n${formatReport(perBucket, overall, K)}`)
    expect(perBucket.map((b) => b.bucket)).toEqual(['keyword', 'mixed', 'semantic', 'zero-id'])
    expect(perBucket.reduce((n, b) => n + b.n, 0)).toBe(GOLD.length)
    const recall = new Map(perBucket.map((b) => [b.bucket, b.recallAtK]))
    const lexical = ((recall.get('keyword') ?? 0) + (recall.get('mixed') ?? 0)) / 2
    const nl = ((recall.get('semantic') ?? 0) + (recall.get('zero-id') ?? 0)) / 2
    expect(lexical).toBeGreaterThan(nl) // BM25 is a lexical leg — exact/mixed > pure-NL without dense
  })

  describe.skipIf(!RUN_SLOW)('full eval (RUN_SLOW, real ONNX dense leg)', () => {
    it('reports recall@10/MRR/nDCG@10 per bucket; the dense leg lifts overall recall vs BM25-only', async () => {
      const offline = await runEval()
      const full = await runEval(createOnnxEmbedder())
      console.log(
        `\n[full: BM25 + dense + structural]\n${formatReport(full.perBucket, full.overall, K)}`,
      )
      const recall = new Map(full.perBucket.map((b) => [b.bucket, b.recallAtK]))
      // measured: keyword 1.00 · mixed 0.80 · semantic 0.20 · zero-id 0.00 · overall 0.50.
      // zero-id 0.00 is the general-MiniLM NL↔code ceiling — the documented jina-v2-base-code case
      // (src/index/embedder.md); NOT asserted, reported as the finding.
      expect(recall.get('keyword') ?? 0).toBeGreaterThanOrEqual(0.8) // exact-identifier search is strong
      expect(recall.get('mixed') ?? 0).toBeGreaterThanOrEqual(0.6)
      expect(full.overall.recallAtK).toBeGreaterThan(offline.overall.recallAtK) // dense pays off
    }, 300_000)
  })
})

// ── C1: metric invariants (contract guards + fast-check property floor) ────────
describe('IR metric invariants (C1: contract guards)', () => {
  it('recall@k returns 0 for a non-positive k (no negative-index slice leak)', () => {
    expect(recallAtK(ranked(['target', 'a']), isTarget, 0, 1)).toBe(0)
    expect(recallAtK(ranked(['target', 'a']), isTarget, -1, 1)).toBe(0) // was 1 via slice(0,-1)
  })

  it('ndcg@k returns 0 for a non-positive k', () => {
    expect(ndcgAtK(ranked(['target']), isTarget, 0, 1)).toBe(0)
    expect(ndcgAtK(ranked(['target']), isTarget, -1, 1)).toBe(0)
  })

  it('counts duplicate relevant ids once — recall stays in [0,1]', () => {
    // a ranking that repeats the one relevant chunk must not score recall 3/1 = 3
    expect(recallAtK(ranked(['target', 'target', 'target']), isTarget, 10, 1)).toBe(1)
  })

  it('counts duplicate relevant ids once — ndcg stays in [0,1]', () => {
    expect(ndcgAtK(ranked(['target', 'target', 'target']), isTarget, 10, 1)).toBe(1) // was > 1
  })
})

describe('IR metric invariants under fast-check (C1: property-based floor)', () => {
  // Model a corpus + a relevance subset + a (possibly duplicate-laden, partial, shuffled) ranking,
  // mirroring real harness usage (relevantTotal = |relevant in corpus|, ranking ⊆ corpus).
  const scenario = fc
    .uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 10 })
    .chain((ids) =>
      fc.record({
        relevant: fc.subarray(ids),
        rankingIds: fc.array(fc.constantFrom(...ids), { maxLength: 20 }),
        k: fc.integer({ min: -3, max: 15 }),
      }),
    )

  it('recall/ndcg/rr ∈ [0,1] & never NaN; recall monotonic non-decreasing in k; k<=0 → 0', () => {
    fc.assert(
      fc.property(scenario, ({ relevant, rankingIds, k }) => {
        const relevantSet = new Set(relevant)
        const isRel: RelevanceFn = (c) => relevantSet.has(c.id)
        const total = relevantSet.size
        const r = ranked(rankingIds)
        const recall = recallAtK(r, isRel, k, total)
        const ndcg = ndcgAtK(r, isRel, k, total)
        const rr = reciprocalRank(r, isRel)
        for (const m of [recall, ndcg, rr]) {
          expect(Number.isNaN(m)).toBe(false)
          expect(m).toBeGreaterThanOrEqual(0)
          expect(m).toBeLessThanOrEqual(1)
        }
        if (k <= 0) {
          expect(recall).toBe(0)
          expect(ndcg).toBe(0)
        }
        expect(recallAtK(r, isRel, k + 1, total)).toBeGreaterThanOrEqual(recall) // monotonic in k
      }),
    )
  })

  it('duplicate ids are counted once — a repeated ranking scores identically', () => {
    fc.assert(
      fc.property(scenario, ({ relevant, rankingIds }) => {
        const relevantSet = new Set(relevant)
        const isRel: RelevanceFn = (c) => relevantSet.has(c.id)
        const total = relevantSet.size
        const kBig = 1000
        const once = ranked(rankingIds)
        const twice = ranked([...rankingIds, ...rankingIds])
        expect(recallAtK(twice, isRel, kBig, total)).toBe(recallAtK(once, isRel, kBig, total))
        expect(ndcgAtK(twice, isRel, kBig, total)).toBeCloseTo(
          ndcgAtK(once, isRel, kBig, total),
          10,
        )
      }),
    )
  })

  it('empty ranking and empty relevant set both score 0 (never NaN)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (k) => {
        const allRel: RelevanceFn = () => true
        const noneRel: RelevanceFn = () => false
        expect(recallAtK([], allRel, k, 3)).toBe(0) // empty ranking
        expect(ndcgAtK([], allRel, k, 3)).toBe(0)
        expect(recallAtK(ranked(['x']), noneRel, k, 0)).toBe(0) // empty relevant set (total 0)
        expect(ndcgAtK(ranked(['x']), noneRel, k, 0)).toBe(0)
      }),
    )
  })
})
