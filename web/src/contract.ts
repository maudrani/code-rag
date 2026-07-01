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
} from '../../src/contracts/wire'

// ─────────────────────────────────────────────────────────────────────────────
// PENDING master ratification (TKT-517 escalation) — the corpus/symbols read-surface.
//
// GET /symbols -> SymbolsPayload powers the assisted-search UI (CorpusTree + SymbolCombobox).
// The SSOT does NOT hold these types yet (verified: no SymbolEntry in src/contracts). Rather than
// edit the master-owned contracts (RULE-019), we mirror the ESCALATED shape here, clearly marked.
// These are `interface`/`type` declarations — also fully erased at compile time, so web ⊥ Node holds
// (no Node code is bundled). THE 1-LINE SWAP: when master lands SymbolEntry/SymbolsPayload in
// src/contracts, delete this block and add a single `export type { SymbolEntry, SymbolsPayload }
// from '../../src/contracts/…'` line — the whole app imports from `../contract`, so nothing else
// changes. Keep the shapes byte-identical to the escalation so the swap is mechanical.
export interface SymbolEntry {
  path: string
  symbol: string
  /** 'function' | 'class' | 'interface' | 'module' | 'type' | … (mirrors Chunk.kind). */
  kind: string
  lang: string
  span: { startLine: number; endLine: number }
}

export interface SymbolsPayload {
  symbols: SymbolEntry[]
}
