/**
 * Mock Chunk[] fixtures for L4 retrieval tests (retrieval specialist, timeline `retrieval`).
 *
 * These stand in for the `Chunk` output of the `ingest-chunk` specialist (B) until its
 * real fixtures land — we build against the Chunk CONTRACT (src/contracts/chunk.ts, ADR-002/004),
 * in parallel, per the charter. They form a small call graph so the structural leg
 * (one-hop call/import neighbours from `structuralRefs`) has something real to traverse.
 *
 * Call graph (calls):
 *   searchIndex -> embedQuery, bm25Search
 *   embedQuery  -> pipeline
 *   bm25Search  -> (none)
 *   rrfFuse     -> (none)
 *   VectorStore -> (none)
 */
import type { Chunk } from '../../../src/contracts/chunk.js'

/** Build a Chunk with the ADR-002 stable id `${path}#${symbol}@${start}-${end}`. */
function chunk(
  path: string,
  symbol: string,
  kind: Chunk['kind'],
  startLine: number,
  endLine: number,
  code: string,
  structuralRefs: Chunk['structuralRefs'],
): Chunk {
  return {
    id: `${path}#${symbol}@${startLine}-${endLine}`,
    path,
    lang: 'ts',
    symbol,
    kind,
    span: { startLine, endLine },
    code,
    structuralRefs,
  }
}

export const searchIndexChunk = chunk(
  'src/retrieve/search.ts',
  'searchIndex',
  'function',
  10,
  28,
  'export async function searchIndex(q: string) {\n  const v = await embedQuery(q)\n  return rrfFuse({ bm25: bm25Search(q), dense: denseSearch(v), structural: [] })\n}',
  { calls: ['embedQuery', 'bm25Search', 'denseSearch', 'rrfFuse'], imports: ['better-sqlite3'] },
)

export const embedQueryChunk = chunk(
  'src/index/embed.ts',
  'embedQuery',
  'function',
  4,
  9,
  "export async function embedQuery(q: string) {\n  const extractor = await pipeline('feature-extraction', MODEL)\n  return extractor(q, { pooling: 'mean', normalize: true })\n}",
  { calls: ['pipeline'], imports: ['@huggingface/transformers'] },
)

export const bm25SearchChunk = chunk(
  'src/retrieve/bm25.ts',
  'bm25Search',
  'function',
  6,
  12,
  "export function bm25Search(q: string): LegCandidate[] {\n  return db.prepare('SELECT id, rank FROM fts WHERE fts MATCH ? ORDER BY rank').all(q)\n}",
  { calls: [], imports: ['better-sqlite3'] },
)

export const vectorStoreChunk = chunk(
  'src/index/store.ts',
  'VectorStore',
  'class',
  14,
  40,
  'export class VectorStore {\n  upsert(id: string, blob: Buffer) {}\n  all(): { id: string; blob: Buffer }[] { return [] }\n}',
  { calls: [], imports: ['better-sqlite3'] },
)

export const rrfFuseChunk = chunk(
  'src/retrieve/fuse.ts',
  'rrfFuse',
  'function',
  30,
  60,
  'export function rrfFuse(legs, chunks, config) {\n  /* reciprocal rank fusion, k=60 */\n}',
  { calls: [], imports: [] },
)

/** All fixtures, and a lookup Map keyed by chunk id (what rrfFuse consumes). */
export const allChunks: Chunk[] = [
  searchIndexChunk,
  embedQueryChunk,
  bm25SearchChunk,
  vectorStoreChunk,
  rrfFuseChunk,
]

export const chunkMap: ReadonlyMap<string, Chunk> = new Map(allChunks.map((c) => [c.id, c]))
