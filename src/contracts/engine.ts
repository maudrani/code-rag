import type { Event } from './events.js'
import type { ConsumerIntent, Projection, Turn } from './projection.js'
import type { AnswerChunk, Provider } from './provider.js'
import type { Observable } from './telemetry.js'

export interface IngestReport {
  filesIndexed: number
  chunks: number
  durationMs: number
}

/** unsubscribe handle for the event bus. */
export type Unsubscribe = () => void

export interface EngineConfig {
  /** the codebase to index (default: self-index this repo — ADR-006 G6) */
  corpusPath?: string
  /** LLM API key — the ONLY key clone-and-run needs (embeddings are local, ADR-003) */
  apiKey?: string
  /**
   * enable the local-ONNX dense leg — recall 0.50 / exact-id 1.00 vs 0.273 (BM25+structural only).
   * Default: ON in a live process, OFF under vitest (the model download would slow the deterministic
   * suite). First live use downloads the MiniLM model (~25MB); set `false` for instant fully-offline.
   */
  dense?: boolean
  /**
   * persist the index at this path for warm-restart (FTR-57): a second run stat-checks each file
   * (mtime+size) and re-embeds ONLY changed files — the whole-repo cold embed (minutes) drops to
   * ~seconds warm. Absent → an in-memory index (always cold). A model-id change forces a cold rebuild.
   */
  indexPath?: string
  /** an injected LLM Provider — a TEST SEAM (FTR-4 TKT-003): a test passes a deterministic fake so the
   *  full query -> answer flow is E2E-testable through L5 with no network/key. Absent -> the real Claude
   *  provider (createClaudeProvider(apiKey)), exactly as production. */
  provider?: Provider
  /** an injected clock — a TEST SEAM (FTR-4 TKT-004): a test passes a fixed/monotonic now() so the
   *  observability record (ts, latencyMs, staleMs) is deterministic. Default: Date.now (prod unchanged). */
  now?: () => number
}

/**
 * Engine — the in-process Node Consumer API (ADR-006, contract #6). The HTTP
 * server, MCP server, and CLI import this. The browser `frontend` does NOT —
 * it consumes the HTTP wire (ADR-008).
 *
 * `query` runs the deterministic membrane (L0 -> retrieve -> project) and returns
 * the Projection incl. the gate decision. `answer` streams L5 (token + usage)
 * over a projection (only when `decision.band === 'answer'`). They are split so
 * a dry CLI call / `mcp` can call `query` alone (no LLM, no cost).
 */
export interface Engine {
  ingest(repoPath: string): Promise<IngestReport>
  /** FTR-5 P4: rebuild the in-memory index over a NEW local corpus and make it the active one.
   *  Build-then-swap: the new index is built off to the side, then installed atomically, so a failed
   *  rebuild keeps the previous corpus (no empty-index window). Local path only (the clone is the
   *  consume layer's). Powers POST /ingest — paste a repo URL, index it, chat over it. */
  reindex(corpusPath: string): Promise<IngestReport>
  query(question: string, history: Turn[], intent: ConsumerIntent): Promise<Projection>
  answer(projection: Projection, history: Turn[]): AsyncIterable<AnswerChunk>
  on(handler: (event: Event) => void): Unsubscribe
}

/**
 * the membrane factory — master-owned impl in `src/membrane/`. Returns `Engine &
 * Observable`: the core query/answer surface PLUS the telemetry read-surface (§5.2).
 * Kept as an intersection so a plain `Engine` mock still type-checks for query/answer
 * consumers; only the telemetry transports depend on `Observable`.
 */
export type CreateEngine = (config: EngineConfig) => Engine & Observable
