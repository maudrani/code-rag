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
export type {
  QueryRequest,
  QuerySseEvent,
  SearchRequest,
  SearchResponse,
  TraceWsMessage,
  WireProjection,
} from '../../src/contracts/wire'
