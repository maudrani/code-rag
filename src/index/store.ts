/**
 * L3 unified store — one file-backed SQLite database for all three legs (ADR-003, TKT-205).
 *
 * Composes the per-leg storage into ONE Database (single-file, zero native extension → clone-and-run):
 *   - `chunks_fts`        FTS5 virtual table (BM25 leg) — the bm25.ts schema, grafted onto the shared
 *                         handle; index-time identifier splitting + the same `toFtsQuery` builder.
 *   - `chunks`           chunk metadata + `structural_refs` JSON + a nullable `embedding` BLOB (dense leg).
 *   - `structural_edges`  the persisted call/import adjacency (TKT-203 builds it in memory; here it is
 *                         materialised so `structuralIndex()` reconstructs an index == buildStructuralIndex).
 *
 * `index(chunks)` has REBUILD semantics (no triggers — rebuild-per-ingest, not incremental): it embeds
 * the batch (async), then writes FTS + chunks + edges in ONE synchronous transaction (better-sqlite3
 * transactions cannot span an `await`, so embedding is the pre-step). The legs read from this one handle.
 *
 * Scale path (ADR-003, documented not built): the embedding BLOB column → `sqlite-vec` (vec0) → pgvector.
 */
import Database from 'better-sqlite3'
import type { Chunk } from '../contracts/chunk.js'
import { createDenseLeg, type VectorEntry } from '../retrieve/dense.js'
import type { LegCandidate } from '../retrieve/fuse.js'
import type { LexicalLeg, RetrieveDeps } from '../retrieve/retrieve.js'
import { buildStructuralIndex, type StructuralIndex } from '../retrieve/structural.js'
import { splitIdentifiers, toFtsQuery } from './bm25.js'
import { decodeVector, type Embedder, encodeVector } from './embed.js'

export interface SqliteStoreOptions {
  /** file path, or ':memory:' (default). WAL is enabled for a file path. */
  path?: string
  /** enable WAL on the file path for concurrent reads during a rebuild (default true; n/a for :memory:). */
  walMode?: boolean
  /** FTS5 bm25 weight for the `symbol` column (default 2 — mirrors bm25.ts code-tuning). */
  symbolWeight?: number
  /** FTS5 bm25 weight for the `body` column (default 1). */
  codeWeight?: number
}

export interface IndexOptions {
  /** if present, embed each chunk's code → stored BLOB; if absent, the embedding column stays NULL. */
  embedder?: Embedder
}

interface ChunkRow {
  id: string
  path: string
  lang: string
  symbol: string
  kind: string
  start_line: number
  end_line: number
  code: string
  structural_refs: string
}

/** A unified L3 store backing all three retrieval legs over one SQLite handle. */
export class SqliteStore {
  private readonly db: Database.Database
  private readonly symbolWeight: number
  private readonly codeWeight: number

  constructor(options: SqliteStoreOptions = {}) {
    const path = options.path ?? ':memory:'
    this.symbolWeight = options.symbolWeight ?? 2
    this.codeWeight = options.codeWeight ?? 1
    this.db = new Database(path) // throws an explicit SqliteError if the file cannot be opened
    if (path !== ':memory:' && options.walMode !== false) {
      // WAL lets searches read while a rebuild writes. (For a long-lived multi-process daemon,
      // peripheral's sqlite adapter also sets locking_mode=EXCLUSIVE to avoid the -shm pagein
      // SIGBUS during FTS5 merge — out of scope for this single-process M1 store.)
      this.db.pragma('journal_mode = WAL')
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        lang TEXT NOT NULL,
        symbol TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        code TEXT NOT NULL,
        structural_refs TEXT NOT NULL,
        embedding BLOB
      ) STRICT;
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
        USING fts5(chunk_id UNINDEXED, symbol, body, tokenize = 'unicode61');
      CREATE TABLE IF NOT EXISTS structural_edges (
        src TEXT NOT NULL,
        dst TEXT NOT NULL,
        PRIMARY KEY (src, dst)
      ) STRICT;
    `)
  }

  /** The active journal mode (e.g. 'wal' on disk, 'memory' for :memory:). */
  journalMode(): string {
    return this.db.pragma('journal_mode', { simple: true }) as string
  }

  /**
   * Build the store from a Chunk[] corpus (rebuild semantics — clears + repopulates). Embeds the
   * batch first (async), then writes FTS + chunks + adjacency in one transaction. Idempotent.
   */
  async index(chunks: readonly Chunk[], options: IndexOptions = {}): Promise<void> {
    const { embedder } = options
    const blobs: (Buffer | null)[] =
      embedder && chunks.length > 0
        ? (await embedder.embed(chunks.map((chunk) => chunk.code))).map(encodeVector)
        : chunks.map(() => null)
    const structural = buildStructuralIndex(chunks)

    const insertChunk = this.db.prepare(
      `INSERT INTO chunks (id, path, lang, symbol, kind, start_line, end_line, code, structural_refs, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertFts = this.db.prepare(
      'INSERT INTO chunks_fts (chunk_id, symbol, body) VALUES (?, ?, ?)',
    )
    const insertEdge = this.db.prepare('INSERT INTO structural_edges (src, dst) VALUES (?, ?)')

    const rebuild = this.db.transaction(() => {
      this.db.exec('DELETE FROM chunks; DELETE FROM chunks_fts; DELETE FROM structural_edges;')
      chunks.forEach((chunk, i) => {
        insertChunk.run(
          chunk.id,
          chunk.path,
          chunk.lang,
          chunk.symbol,
          chunk.kind,
          chunk.span.startLine,
          chunk.span.endLine,
          chunk.code,
          JSON.stringify(chunk.structuralRefs),
          blobs[i] ?? null,
        )
        // augment the symbol column with split sub-tokens so partial-word queries match (bm25.ts)
        insertFts.run(chunk.id, `${chunk.symbol} ${splitIdentifiers(chunk.symbol)}`, chunk.code)
      })
      for (const [src, neighbours] of structural.neighbours) {
        for (const dst of neighbours) insertEdge.run(src, dst)
      }
    })
    rebuild()
  }

  /** The BM25 leg over the shared FTS5 table — same ranking as a standalone Bm25Index. */
  searchBm25(query: string, limit: number): LegCandidate[] {
    const match = toFtsQuery(query)
    if (match === '') return []
    const rows = this.db
      .prepare(
        `SELECT chunk_id AS chunkId, -bm25(chunks_fts, :sw, :cw) AS score
         FROM chunks_fts WHERE chunks_fts MATCH :q
         ORDER BY bm25(chunks_fts, :sw, :cw) LIMIT :lim`,
      )
      .all({ sw: this.symbolWeight, cw: this.codeWeight, q: match, lim: limit }) as LegCandidate[]
    return rows.map((row) => ({ chunkId: row.chunkId, score: row.score }))
  }

  /** The dense leg's stored vectors (BLOB → Float32Array). Only chunks with an embedding. */
  vectors(): VectorEntry[] {
    const rows = this.db
      .prepare('SELECT id, embedding FROM chunks WHERE embedding IS NOT NULL ORDER BY rowid')
      .all() as { id: string; embedding: Buffer }[]
    return rows.map((row) => ({ chunkId: row.id, vector: decodeVector(row.embedding) }))
  }

  /** Reconstruct the structural index from the persisted adjacency (== buildStructuralIndex). */
  structuralIndex(): StructuralIndex {
    const chunks = this.chunkList()
    const byId = new Map<string, Chunk>()
    const definers = new Map<string, string[]>()
    for (const chunk of chunks) {
      byId.set(chunk.id, chunk)
      const defs = definers.get(chunk.symbol)
      if (defs === undefined) definers.set(chunk.symbol, [chunk.id])
      else defs.push(chunk.id)
    }
    const neighbours = new Map<string, Set<string>>()
    const edges = this.db.prepare('SELECT src, dst FROM structural_edges').all() as {
      src: string
      dst: string
    }[]
    for (const { src, dst } of edges) {
      let set = neighbours.get(src)
      if (set === undefined) {
        set = new Set<string>()
        neighbours.set(src, set)
      }
      set.add(dst)
    }
    return { byId, definers, neighbours }
  }

  /** All stored chunks as an id → Chunk map (round-trips the indexed corpus). */
  chunkMap(): ReadonlyMap<string, Chunk> {
    return new Map(this.chunkList().map((chunk) => [chunk.id, chunk]))
  }

  /**
   * Assemble retrieve()-ready deps from this ONE store: the BM25 leg + structural index + chunk map,
   * plus the dense leg when an embedder is given (over the stored vectors). The whole hybrid runs off
   * the shared handle — no per-leg standalone DB (the TKT-205 unification, end to end).
   */
  retrievalDeps(embedder?: Embedder): RetrieveDeps {
    const bm25: LexicalLeg = { search: (query, limit) => this.searchBm25(query, limit) }
    const deps: RetrieveDeps = {
      bm25,
      structural: this.structuralIndex(),
      chunks: this.chunkMap(),
    }
    if (embedder !== undefined) {
      deps.dense = createDenseLeg({ embedder, vectors: this.vectors() })
    }
    return deps
  }

  /** Row counts for the three table groups (verification + diagnostics). */
  count(): { chunks: number; fts: number; edges: number } {
    const one = (sql: string): number => (this.db.prepare(sql).get() as { n: number }).n
    return {
      chunks: one('SELECT count(*) AS n FROM chunks'),
      fts: one('SELECT count(*) AS n FROM chunks_fts'),
      edges: one('SELECT count(*) AS n FROM structural_edges'),
    }
  }

  /** Release the SQLite handle. */
  close(): void {
    this.db.close()
  }

  private chunkList(): Chunk[] {
    const rows = this.db
      .prepare(
        'SELECT id, path, lang, symbol, kind, start_line, end_line, code, structural_refs FROM chunks ORDER BY rowid',
      )
      .all() as ChunkRow[]
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      lang: row.lang,
      symbol: row.symbol,
      kind: row.kind as Chunk['kind'],
      span: { startLine: row.start_line, endLine: row.end_line },
      code: row.code,
      structuralRefs: JSON.parse(row.structural_refs) as Chunk['structuralRefs'],
    }))
  }
}
