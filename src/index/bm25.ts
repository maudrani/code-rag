/**
 * L3/L4 BM25 leg — FTS5 lexical retrieval over the chunk corpus (ADR-003).
 *
 * SQLite FTS5 gives true BM25 ranking with zero native extension (it ships inside
 * better-sqlite3) — the cleanest clone-and-run lexical leg. For CODE, the symbol
 * name is the strongest exact-match signal, so the `symbol` column is weighted
 * above the `body`, and identifiers are SPLIT at index time (`getUserById` ⇒
 * `get user by id`) so partial-word queries match — unicode61 alone keeps an
 * identifier as one token, so `"user"` would otherwise miss `getUserById`.
 *
 * `index()` is L3 (build); `search()` is the L4 leg surface, returning the same
 * `LegCandidate[]` shape `rrfFuse` consumes (score = -bm25, positive = better;
 * fusion uses RANK, score is carried for observability).
 */
import Database from 'better-sqlite3'
import type { Chunk } from '../contracts/chunk.js'
import type { LegCandidate } from '../retrieve/fuse.js'

export interface Bm25Options {
  /** FTS5 bm25 weight for the `symbol` column (code-tuning: identifier match dominates). Default 2. */
  symbolWeight?: number
  /** FTS5 bm25 weight for the `body` (code) column. Default 1. */
  codeWeight?: number
}

/**
 * Split a code identifier into lowercase sub-tokens (camelCase / snake_case / dotted):
 * `getUserById` → `get user by id`, `JWT_SECRET` → `jwt secret`, `HTTPServer` → `http server`.
 */
export function splitIdentifiers(identifier: string): string {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTTPServer → HTTP Server
    .replace(/[_.]+/g, ' ') // snake_case / dotted
    .trim()
    .toLowerCase()
}

/**
 * Build a safe FTS5 MATCH expression from a raw query: extract identifier-ish tokens, add their
 * sub-token splits, quote each term, OR-join. Quoting makes every term a literal — FTS5 operators
 * (`AND`, `*`, `"`, `(`) in user input cannot inject or raise a syntax error. Empty ⇒ `''`.
 */
export function toFtsQuery(query: string): string {
  const tokens = query.match(/[A-Za-z0-9_]+/g) ?? []
  const terms = new Set<string>()
  for (const token of tokens) {
    terms.add(token.toLowerCase())
    for (const part of splitIdentifiers(token).split(' ')) {
      if (part !== '') terms.add(part)
    }
  }
  return [...terms].map((term) => `"${term}"`).join(' OR ')
}

interface Bm25Row {
  chunkId: string
  score: number
}

/** An FTS5-backed BM25 index over a Chunk[] corpus. Owns its SQLite handle. */
export class Bm25Index {
  private readonly db: Database.Database
  private readonly symbolWeight: number
  private readonly codeWeight: number

  constructor(options: Bm25Options = {}) {
    this.symbolWeight = options.symbolWeight ?? 2
    this.codeWeight = options.codeWeight ?? 1
    this.db = new Database(':memory:')
    this.db.exec(
      "CREATE VIRTUAL TABLE chunks_fts USING fts5(chunk_id UNINDEXED, symbol, body, tokenize = 'unicode61')",
    )
  }

  /** Index a Chunk[] corpus (rebuild semantics — call once per ingest). */
  index(chunks: readonly Chunk[]): void {
    const insert = this.db.prepare(
      'INSERT INTO chunks_fts (chunk_id, symbol, body) VALUES (?, ?, ?)',
    )
    const insertAll = this.db.transaction((batch: readonly Chunk[]) => {
      for (const chunk of batch) {
        // augment the symbol column with split sub-tokens so partial-word queries match
        const symbolText = `${chunk.symbol} ${splitIdentifiers(chunk.symbol)}`
        insert.run(chunk.id, symbolText, chunk.code)
      }
    })
    insertAll(chunks)
  }

  /** The L4 BM25 leg: top-`limit` candidates for `query`, ranked best-first. */
  search(query: string, limit: number): LegCandidate[] {
    const match = toFtsQuery(query)
    if (match === '') return []
    const rows = this.db
      .prepare(
        `SELECT chunk_id AS chunkId, -bm25(chunks_fts, :sw, :cw) AS score
         FROM chunks_fts WHERE chunks_fts MATCH :q
         ORDER BY bm25(chunks_fts, :sw, :cw) LIMIT :lim`,
      )
      .all({ sw: this.symbolWeight, cw: this.codeWeight, q: match, lim: limit }) as Bm25Row[]
    return rows.map((row) => ({ chunkId: row.chunkId, score: row.score }))
  }

  /** Release the SQLite handle. */
  close(): void {
    this.db.close()
  }
}
