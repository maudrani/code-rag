import type { RankedChunk } from './retrieval.js'

/** one conversational turn (multi-turn chat). */
export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

/** a clickable citation the UI renders (file:line -> opens source). */
export interface Citation {
  chunkId: string
  path: string
  span: { startLine: number; endLine: number }
  label: string
}

/**
 * The score-gate decision (ADR-005) — TWO deterministic signals:
 *  - groundingScore -> band (refuse gate)
 *  - complexity-proxy -> tier (model selection)
 */
export interface GateDecision {
  /** top-k fused retrieval score (grounding confidence) */
  groundingScore: number
  /** below the floor -> 'refuse'; else 'answer' */
  band: 'refuse' | 'answer'
  /** cheap (single-file lookup) | strong (multi-file reasoning) */
  tier: 'cheap' | 'strong'
  /** the selected model id */
  model: string
}

/**
 * ScoreGate (ADR-005, seam 1) — the deterministic 2-signal gate. The `answer`
 * specialist owns this pure function (in src/answer/); the MEMBRANE imports it
 * and calls it in project() to populate `Projection.decision`. It is NOT the LLM:
 * grounding-score -> band (refuse floor); complexity-proxy -> tier (cheap/strong).
 */
export type ScoreGate = (
  retrieval: RankedChunk[],
  query: { question: string; resolvedQuery: string },
) => GateDecision

/** which consumer is reading — each reads its slice of the Projection. */
export type ConsumerIntent = 'http' | 'cli-dry' | 'mcp' | 'package'

/**
 * Projection — the SSOT every consumer reads (ADR-002). Master-owned: the
 * membrane projects it (it never recomputes). `context.assembled` is the mise
 * en place for L5; consumers that don't answer (cli-dry, mcp) ignore it, and
 * the HTTP wire (ADR-008) sends a Projection MINUS `context`.
 */
export interface Projection {
  /** join-key to the event stream (ADR-006) */
  queryId: string
  /** raw user turn */
  question: string
  /** after L0 — anaphora resolved into a standalone query */
  resolvedQuery: string
  results: RankedChunk[]
  citations: Citation[]
  /** the assembled prompt context handed to L5 (heavy; omitted on the wire) */
  context: { assembled: string; tokensEst: number }
  decision: GateDecision
}
