import type { Event } from './events.js'
import type { Citation, GateDecision, Turn } from './projection.js'
import type { RankedChunk } from './retrieval.js'

/** A provider-agnostic chat turn as it goes to L5 (mirrors the answer layer's PromptTurn). */
export interface WirePromptTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * WirePrompt — the EXACT L5 prompt the model receives (buildPrompt output): `system` is the
 * answer-only policy + the assembled context (the substrate) + the citable id set + the cite
 * instruction; `messages` is the windowed history + the resolved query. Sent so a consumer can show
 * the substrate the LLM actually reasons over — the guardrail made inspectable.
 */
export interface WirePrompt {
  system: string
  messages: WirePromptTurn[]
}

/**
 * WireProjection — the Projection MINUS the heavy `context.assembled` (ADR-008).
 * What `surface` sends over the wire and `frontend` renders.
 */
export interface WireProjection {
  queryId: string
  question: string
  resolvedQuery: string
  results: RankedChunk[]
  citations: Citation[]
  decision: GateDecision
  /**
   * The exact L5 prompt (substrate + messages). Optional: /query (meta) and /search include it so the
   * UI can reveal what the model receives; absent when a surface chooses not to (keeps the field additive).
   * It carries the assembled context that WireProjection otherwise drops — an OPT-IN transparency view.
   */
  prompt?: WirePrompt
}

/** POST /query request (ADR-008). */
export interface QueryRequest {
  question: string
  history: Turn[]
}

/**
 * SSE stream for POST /query (ADR-008), in order:
 *   meta  -> the WireProjection (citations + decision, before/as the answer streams)
 *   token -> 0..N answer chunks (only when decision.band === 'answer')
 *   done  -> final usage (mirrors the L5 event)
 * On refuse: meta then done, no token events.
 */
export type QuerySseEvent =
  | { event: 'meta'; data: WireProjection }
  | { event: 'token'; data: { text: string } }
  | { event: 'done'; data: { tokensTotal: number; estCost: number } }

/** POST /search request — deterministic, no LLM (the HTTP face of CLI `--dry`). */
export interface SearchRequest {
  query: string
}
/** POST /search response — WireProjection (results + decision, no answer). */
export type SearchResponse = WireProjection

/** GET /ws/trace — streams Event (ADR-006) verbatim, client filters by queryId (M1 single-consumer). */
export type TraceWsMessage = Event
