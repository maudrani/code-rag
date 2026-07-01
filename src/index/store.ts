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
import { shortNameOf } from '../retrieve/symbols.js'
import {
  FTS_INSERT_SQL,
  ftsCreateTableSql,
  ftsSearchSql,
  ftsSymbolText,
  toFtsQuery,
} from './bm25.js'
import { decodeVector, type Embedder, encodeVector } from './embed.js'
import { diffManifest, type FileStat, type ManifestEntry } from './manifest.js'

export interface SqliteStoreOptions {
  /** file path, or ':memory:' (default). WAL is enabled for a file path. */
  path?: string
  /** enable WAL on the file path for concurrent reads during a rebuild (default true; n/a for :memory:). */
  walMode?: boolean
  /**
   * SQLite locking mode for the file path (n/a for :memory:). `'exclusive'` (DEFAULT for this
   * single-process store) emits `PRAGMA locking_mode = EXCLUSIVE` BEFORE the WAL pragma, so the
   * wal-index lives in HEAP and the `-shm` shared-memory file is never created or mmapped — this
   * structurally eliminates the `-shm`-pagein SIGBUS class during an FTS5 merge (adopt peripheral
   * FTR-051; pragma ORDER is load-bearing). `'normal'` is standard WAL with the mmap'd `-shm`.
   * CONSTRAINT: EXCLUSIVE locks the DB to this ONE connection — never open the same file twice.
   */
  lockingMode?: 'normal' | 'exclusive'
  /** FTS5 bm25 weight for the `symbol` column (default 2 — mirrors bm25.ts code-tuning). */
  symbolWeight?: number
  /** FTS5 bm25 weight for the `body` column (default 1). */
  codeWeight?: number
}

export interface IndexOptions {
  /** if present, embed each chunk's code → stored BLOB; if absent, the embedding column stays NULL. */
  embedder?: Embedder
}

/**
 * Chunk ONLY the given (changed) file paths — injected into syncIndex so the store never re-reads or
 * re-parses UNCHANGED files (the warm-restart win). The caller (membrane) wires this over ingest-chunk.
 */
export type ChunkChanged = (paths: string[]) => Chunk[] | Promise<Chunk[]>

export interface SyncOptions {
  embedder?: Embedder
  /** model identity (e.g. 'Xenova/all-MiniLM-L6-v2:q8'); a change invalidates the persisted vectors ⇒ cold rebuild. Default 'none'. */
  modelId?: string
}

/** What a warm sync did — the observability of the skip (embeddedChunks 0 ⇒ a fully-warm start). */
export interface SyncReport {
  cold: boolean
  reusedFiles: number
  reindexedFiles: number
  deletedFiles: number
  embeddedChunks: number
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
    const lockingMode = options.lockingMode ?? 'exclusive'
    if (lockingMode !== 'normal' && lockingMode !== 'exclusive') {
      throw new Error(`Invalid lockingMode: '${lockingMode}'. Allowed: normal, exclusive`)
    }
    this.symbolWeight = options.symbolWeight ?? 2
    this.codeWeight = options.codeWeight ?? 1
    this.db = new Database(path) // throws an explicit SqliteError if the file cannot be opened
    if (path !== ':memory:' && options.walMode !== false) {
      // WAL lets searches read while a rebuild writes. The pragma ORDER is load-bearing (adopt
      // peripheral FTR-051): locking_mode=EXCLUSIVE MUST precede the first WAL access — set then,
      // SQLite keeps the wal-index in HEAP and never creates/mmaps the `-shm` file, structurally
      // eliminating the `-shm`-pagein SIGBUS during an FTS5 merge. Set AFTER WAL it silently fails
      // (the `-shm` already exists). Default 'exclusive' is safe: this store is single-connection.
      if (lockingMode === 'exclusive') this.db.pragma('locking_mode = EXCLUSIVE')
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
      ${ftsCreateTableSql(true)};
      CREATE TABLE IF NOT EXISTS structural_edges (
        src TEXT NOT NULL,
        dst TEXT NOT NULL,
        PRIMARY KEY (src, dst)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS file_manifest (
        path TEXT PRIMARY KEY,
        mtime_ms REAL NOT NULL,
        size INTEGER NOT NULL,
        chunk_ids TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS index_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `)
  }

  /** The active journal mode (e.g. 'wal' on disk, 'memory' for :memory:). */
  journalMode(): string {
    return this.db.pragma('journal_mode', { simple: true }) as string
  }

  /** The active locking mode ('exclusive' ⇒ heap wal-index, no `-shm`; 'normal' ⇒ mmap'd `-shm`). */
  lockingMode(): string {
    return this.db.pragma('locking_mode', { simple: true }) as string
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
    // Legacy full rebuild — no warm-tracking (empty manifest, model 'none'). syncIndex() is the warm path.
    this.writeAll(chunks, blobs, [], 'none')
  }

  /**
   * The full-rebuild transaction shared by index() + syncIndex(): clear everything and repopulate from
   * (chunks, blobs) with the given manifest + model id, atomically. `blobs[i]` is chunk[i]'s stored
   * vector (reused for unchanged files, freshly embedded for changed) or null. Writing the manifest in
   * the SAME transaction is the partial-index guard: a process killed mid-rebuild commits nothing, so no
   * file is falsely marked warm.
   */
  private writeAll(
    chunks: readonly Chunk[],
    blobs: readonly (Buffer | null)[],
    manifest: readonly ManifestEntry[],
    modelId: string,
  ): void {
    const structural = buildStructuralIndex(chunks)
    const insertChunk = this.db.prepare(
      `INSERT INTO chunks (id, path, lang, symbol, kind, start_line, end_line, code, structural_refs, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertFts = this.db.prepare(FTS_INSERT_SQL)
    const insertEdge = this.db.prepare('INSERT INTO structural_edges (src, dst) VALUES (?, ?)')
    const insertManifest = this.db.prepare(
      'INSERT INTO file_manifest (path, mtime_ms, size, chunk_ids) VALUES (?, ?, ?, ?)',
    )
    const setMeta = this.db.prepare('INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)')

    const rebuild = this.db.transaction(() => {
      this.db.exec(
        'DELETE FROM chunks; DELETE FROM chunks_fts; DELETE FROM structural_edges; DELETE FROM file_manifest;',
      )
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
        insertFts.run(chunk.id, ftsSymbolText(chunk.symbol), chunk.code)
      })
      for (const [src, neighbours] of structural.neighbours) {
        for (const dst of neighbours) insertEdge.run(src, dst)
      }
      for (const entry of manifest) {
        insertManifest.run(entry.path, entry.mtimeMs, entry.size, JSON.stringify(entry.chunkIds))
      }
      setMeta.run('model_id', modelId)
    })
    rebuild()
  }

  /** The BM25 leg over the shared FTS5 table — same ranking as a standalone Bm25Index. */
  searchBm25(query: string, limit: number): LegCandidate[] {
    const match = toFtsQuery(query)
    if (match === '') return []
    const rows = this.db
      .prepare(ftsSearchSql())
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
    const byName = new Map<string, string[]>() // short-name bucket (edge-independent; FTR-22 resolution)
    for (const chunk of chunks) {
      byId.set(chunk.id, chunk)
      const defs = definers.get(chunk.symbol)
      if (defs === undefined) definers.set(chunk.symbol, [chunk.id])
      else defs.push(chunk.id)
      const short = shortNameOf(chunk.symbol)
      const named = byName.get(short)
      if (named === undefined) byName.set(short, [chunk.id])
      else named.push(chunk.id)
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
    return { byId, definers, byName, neighbours }
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

  /** The persisted per-file manifest (path → its stat + chunk ids at index time). Empty when cold. */
  readManifest(): ManifestEntry[] {
    const rows = this.db
      .prepare('SELECT path, mtime_ms, size, chunk_ids FROM file_manifest')
      .all() as { path: string; mtime_ms: number; size: number; chunk_ids: string }[]
    return rows.map((row) => ({
      path: row.path,
      mtimeMs: row.mtime_ms,
      size: row.size,
      chunkIds: JSON.parse(row.chunk_ids) as string[],
    }))
  }

  /** The model id the persisted vectors were produced with; null if never indexed (cold). */
  readModelId(): string | null {
    const row = this.db.prepare("SELECT value FROM index_meta WHERE key = 'model_id'").get() as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  /** Read the stored chunks + their embedding blobs for the given paths (the reuse path — no embed). */
  private readChunksWithBlobs(paths: readonly string[]): {
    chunks: Chunk[]
    blobs: (Buffer | null)[]
  } {
    if (paths.length === 0) return { chunks: [], blobs: [] }
    const placeholders = paths.map(() => '?').join(',')
    const rows = this.db
      .prepare(
        `SELECT id, path, lang, symbol, kind, start_line, end_line, code, structural_refs, embedding
         FROM chunks WHERE path IN (${placeholders}) ORDER BY rowid`,
      )
      .all(...paths) as (ChunkRow & { embedding: Buffer | null })[]
    const chunks: Chunk[] = []
    const blobs: (Buffer | null)[] = []
    for (const row of rows) {
      chunks.push({
        id: row.id,
        path: row.path,
        lang: row.lang,
        symbol: row.symbol,
        kind: row.kind as Chunk['kind'],
        span: { startLine: row.start_line, endLine: row.end_line },
        code: row.code,
        structuralRefs: JSON.parse(row.structural_refs) as Chunk['structuralRefs'],
      })
      blobs.push(row.embedding ?? null)
    }
    return { chunks, blobs }
  }

  /**
   * Warm restart (FTR-57): (re)build the index from the CURRENT file set, re-chunking + re-embedding
   * ONLY changed/new files and REUSING the stored chunks+vectors of unchanged ones — the stat-only skip
   * (mtime+size). Deleted files drop out; a model-id change (or an empty manifest) forces a cold rebuild.
   *
   * `chunkChanged` is called with ONLY the changed paths (never for unchanged files — no re-read/parse);
   * the embedder embeds ONLY those chunks. A fully-warm start returns immediately with 0 embedded chunks.
   * The structural graph is rebuilt from the full reused+new chunk set (edges are global; no embed).
   */
  async syncIndex(
    current: readonly FileStat[],
    chunkChanged: ChunkChanged,
    options: SyncOptions = {},
  ): Promise<SyncReport> {
    const modelId = options.modelId ?? 'none'
    const embedder = options.embedder
    const manifest = this.readManifest()
    const storedModel = this.readModelId()
    // cold = never indexed OR the embedder changed (persisted vectors are model-specific).
    const cold = manifest.length === 0 || (storedModel !== null && storedModel !== modelId)

    const diff = cold
      ? { unchanged: [] as ManifestEntry[], changed: [...current], deleted: [] as ManifestEntry[] }
      : diffManifest(current, manifest)

    // TRUE warm skip: nothing changed or deleted ⇒ ZERO work, ZERO embed, no rewrite.
    if (!cold && diff.changed.length === 0 && diff.deleted.length === 0) {
      return {
        cold: false,
        reusedFiles: diff.unchanged.length,
        reindexedFiles: 0,
        deletedFiles: 0,
        embeddedChunks: 0,
      }
    }

    const changedPaths = diff.changed.map((file) => file.path)
    const newChunks = changedPaths.length > 0 ? await chunkChanged(changedPaths) : []
    // reuse the unchanged files' chunks+vectors straight from disk (no re-chunk, no re-embed)…
    const reused = this.readChunksWithBlobs(diff.unchanged.map((entry) => entry.path))
    // …and embed ONLY the changed files' chunks.
    const newBlobs: (Buffer | null)[] =
      embedder && newChunks.length > 0
        ? (await embedder.embed(newChunks.map((chunk) => chunk.code))).map(encodeVector)
        : newChunks.map(() => null)

    // manifest after this sync: unchanged kept + one entry per changed file (new stat + its new chunk ids).
    const chunksByPath = new Map<string, string[]>()
    for (const chunk of newChunks) {
      const list = chunksByPath.get(chunk.path)
      if (list === undefined) chunksByPath.set(chunk.path, [chunk.id])
      else list.push(chunk.id)
    }
    const changedEntries: ManifestEntry[] = diff.changed.map((file) => ({
      ...file,
      chunkIds: chunksByPath.get(file.path) ?? [],
    }))
    const nextManifest = [...diff.unchanged, ...changedEntries]

    this.writeAll(
      [...reused.chunks, ...newChunks],
      [...reused.blobs, ...newBlobs],
      nextManifest,
      modelId,
    )

    return {
      cold,
      reusedFiles: diff.unchanged.length,
      reindexedFiles: diff.changed.length,
      deletedFiles: diff.deleted.length,
      embeddedChunks: newChunks.length,
    }
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
