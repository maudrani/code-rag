/**
 * buildIndexedStore — index a corpus into one SqliteStore and return retrieve()-ready deps, with the
 * dense leg wired iff an embedder is given (FTR-22 dense-wiring).
 *
 * The whole point is to thread ONE embedder through BOTH `index()` (store the chunk vectors) AND
 * `retrievalDeps()` (the query-time dense leg) — so dense is all-or-nothing. The live `createEngine`
 * regressed precisely because those two calls drifted apart (vectors could be stored but the dense
 * leg left unwired, or the leg requested with no stored vectors): observability caught the live
 * system retrieving at recall ~0.273 (BM25 + structural) instead of the eval's 0.50 (with dense).
 * One call eliminates that footgun.
 */
import type { Chunk } from '../contracts/chunk.js'
import type { RetrieveDeps } from '../retrieve/retrieve.js'
import type { Embedder } from './embed.js'
import { SqliteStore, type SqliteStoreOptions } from './store.js'

export interface BuildIndexedStoreOptions {
  /**
   * the dense embedder. When present, each chunk's code is embedded + stored AND the query-time dense
   * leg is created over those vectors — threaded through both so the leg can never be half-wired.
   * Absent ⇒ BM25 + structural only (clone-and-run, no model download).
   */
  embedder?: Embedder
  /** forwarded to the SqliteStore (path / WAL / locking / bm25 weights). Defaults to in-memory. */
  store?: SqliteStoreOptions
}

export interface IndexedStore {
  /** the live store handle — own it for telemetry (count/journalMode) and `close()`. */
  store: SqliteStore
  /** retrieve()-ready deps; `deps.dense` is present iff an embedder was supplied. */
  deps: RetrieveDeps
}

/**
 * Build a fully-indexed store + its retrieval deps in one call. `deps` reflects the corpus at build
 * time (the store has REBUILD semantics — re-index then re-derive deps for a new corpus).
 */
export async function buildIndexedStore(
  chunks: readonly Chunk[],
  options: BuildIndexedStoreOptions = {},
): Promise<IndexedStore> {
  const { embedder } = options
  const store = new SqliteStore(options.store)
  await store.index(chunks, embedder ? { embedder } : {})
  const deps = store.retrievalDeps(embedder)
  return { store, deps }
}
