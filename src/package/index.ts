/**
 * code-rag (package) — the in-process Node Consumer API (ADR-006 contract #6).
 * The single public surface that the HTTP / MCP / CLI consumers import; they do
 * NOT reach into src/contracts or src/membrane directly.
 *
 * M1 scope: this barrel exposes the public TYPE surface. The runtime factory
 * `createEngine` is master-owned (src/membrane, ADR-002) and is re-exported from
 * the INTEGRATION POINT below once the membrane lands. Until then consumers inject
 * an Engine: the HTTP server takes one by DI; tests use the fixture makeMockEngine.
 */

// --- Retrieval results (ADR-002/003) ---
export type { Chunk } from '../contracts/chunk.js'
// --- Consumer API (ADR-006) ---
export type {
  CreateEngine,
  Engine,
  EngineConfig,
  IngestReport,
  Unsubscribe,
} from '../contracts/engine.js'
// --- Observability event-schema (ADR-006) ---
export type { EmitFn, Event, EventLayer } from '../contracts/events.js'
// --- Projection SSOT + conversation (ADR-002/005) ---
export type {
  Citation,
  ConsumerIntent,
  GateDecision,
  Projection,
  Turn,
} from '../contracts/projection.js'
// --- LLM streaming (ADR-005) ---
export type { AnswerChunk, Provider } from '../contracts/provider.js'
export type { RankedChunk, RetrievalResult } from '../contracts/retrieval.js'

// --- HTTP wire (ADR-008) — one import shared by the HTTP consumer + clients ---
export type {
  QueryRequest,
  QuerySseEvent,
  SearchRequest,
  SearchResponse,
  TraceWsMessage,
  WireProjection,
} from '../contracts/wire.js'

// --- INTEGRATION POINT (master membrane, ADR-002) ---
// The Consumer API factory. The `createEngine` BINDING is stable (master-owned,
// src/membrane); the master fills its body in-place at integration. Re-exporting
// it now is forward-compatible: consumers (HTTP server, future MCP/CLI) do
// `import { createEngine } from 'code-rag'` against a stable seam, and the
// membrane body-fill flows through transparently — no change here required.
// Until the membrane lands, calling it surfaces "not implemented yet" (the
// documented integration boundary); surface tests inject a mock Engine instead.
export { createEngine } from '../membrane/index.js'
