import type { Event } from './events.js'
import type { ConsumerIntent, Projection, Turn } from './projection.js'
import type { AnswerChunk } from './provider.js'

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
}

/**
 * Engine — the in-process Node Consumer API (ADR-006, contract #6). The HTTP
 * server, MCP server, and CLI import this. The browser `frontend` does NOT —
 * it consumes the HTTP wire (ADR-008).
 *
 * `query` runs the deterministic membrane (L0 -> retrieve -> project) and returns
 * the Projection incl. the gate decision. `answer` streams L5 (token + usage)
 * over a projection (only when `decision.band === 'answer'`). They are split so
 * `cli-dry` / `mcp` can call `query` alone (no LLM, no cost).
 */
export interface Engine {
  ingest(repoPath: string): Promise<IngestReport>
  query(question: string, history: Turn[], intent: ConsumerIntent): Promise<Projection>
  answer(projection: Projection, history: Turn[]): AsyncIterable<AnswerChunk>
  on(handler: (event: Event) => void): Unsubscribe
}

/** the membrane factory — master-owned impl in `src/membrane/`. */
export type CreateEngine = (config: EngineConfig) => Engine
