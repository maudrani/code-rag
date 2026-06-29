import type { Projection, Turn } from './projection.js'

/**
 * A streamed answer chunk (ADR-005, seam 2): the LLM yields `token`s, then a
 * final `usage` record so the membrane can emit the L5 cost event with REAL
 * numbers (not an estimate). The membrane streams `token` -> the wire and, on
 * `usage`, emits the L5 event + computes estCost (tokens x price(tier)).
 */
export type AnswerChunk =
  | { type: 'token'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }

/**
 * Provider — the pluggable LLM (ADR-005). One default ships (Claude:
 * haiku = cheap tier, sonnet = strong tier); OpenAI swap is config.
 *
 * Two methods, two layers:
 *  - `answer` is L5 — streams over the already-retrieved, already-cited context.
 *  - `rewrite` is the L0 residue — called by the MEMBRANE only when its
 *    deterministic anaphora gate flags a dangling reference.
 */
export interface Provider {
  /** L5 — stream `token`s then a final `usage` record; only when `decision.band === 'answer'`. */
  answer(question: string, projection: Projection, history: Turn[]): AsyncIterable<AnswerChunk>
  /** L0 residue — resolve an anaphoric turn into a standalone query. */
  rewrite(question: string, history: Turn[]): Promise<string>
}
