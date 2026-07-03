/**
 * Type-only bridge to the master-owned wire contract (ADR-008) — the SSOT.
 *
 * The browser `frontend` consumes the HTTP wire, NOT the Node package (ADR-006 G5).
 * These are `export type` only: type-only re-exports are ERASED at compile time, so
 * Vite never resolves or bundles any Node code through this file. Sourcing the types
 * from `src/contracts/*` (the relative `../../src/contracts/*` makes the boundary
 * crossing explicit) instead of a vendored copy keeps the mock + clients in exact
 * sync with the contract — zero drift (operator-approved, FTR-51).
 */

export type { Chunk } from '../../src/contracts/chunk'
export type { Event, EventLayer } from '../../src/contracts/events'
export type {
  Citation,
  ConsumerIntent,
  GateDecision,
  Projection,
  Turn,
} from '../../src/contracts/projection'
export type { RankedChunk, RetrievalResult } from '../../src/contracts/retrieval'
// Telemetry read-surface (GET /stats + /health + /log). These live in the master SSOT
// (src/contracts/telemetry) already — the Observability tab (FTR-56) consumes them over the wire,
// so we re-export the SAME types (type-only, erased at compile time) for zero drift. No wire.ts
// change was needed; the /stats + /health payloads ARE these structs.
export type {
  AnswerTelemetry,
  ChunkTelemetry,
  Consumer,
  EngineTelemetry,
  HealthReport,
  IndexTelemetry,
  IngestTelemetry,
  Leg,
  QueryLogEntry,
} from '../../src/contracts/telemetry'
export type {
  QueryRequest,
  QuerySseEvent,
  SearchRequest,
  SearchResponse,
  TraceWsMessage,
  WireProjection,
  WirePrompt,
  WirePromptTurn,
} from '../../src/contracts/wire'

// ─────────────────────────────────────────────────────────────────────────────
// /symbols read-surface (TKT-517 RATIFIED). `SymbolEntry` now lives in the master SSOT
// (src/contracts/chunk — a Chunk projected to its identity), so we bridge it type-only like the
// other contracts (zero-drift). `SymbolsPayload` is surface's consume WIRE shape
// (src/consume/telemetry.ts getSymbolsPayload); web ⊥ Node bars bridging from src/consume, so it
// stays a trivial LOCAL envelope over the SSOT SymbolEntry — its content can't drift because
// SymbolEntry itself is sourced from the contract.
import type { SymbolEntry } from '../../src/contracts/chunk'

export type { SymbolEntry }

export interface SymbolsPayload {
  symbols: SymbolEntry[]
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /ingest response (FTR-5 P4, TKT-533). `IngestReport` lives in the master SSOT
// (src/contracts/engine — the Engine.reindex return), so we bridge it type-only (zero drift). The
// /ingest response ENVELOPE is inlined at the route (`c.json({ activeCorpus, ingestReport })`), not a
// named wire type, so — exactly like SymbolsPayload — it stays a trivial LOCAL envelope over the
// bridged report; its content can't drift because IngestReport itself is sourced from the contract.
import type { IngestReport } from '../../src/contracts/engine'

export type { IngestReport }

export interface IngestResponse {
  activeCorpus: { url: string }
  ingestReport: IngestReport
}

// GET /corpus response — the repo URL the SERVER is serving right now (null = default self-indexed).
// The header reads this on load so the active-corpus chip reflects the real server corpus, not just
// what this browser ingested (the single source of truth across web/CLI/MCP).
export interface CorpusResponse {
  url: string | null
}
