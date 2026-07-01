/**
 * src/contracts — the SSOT type contracts every specialist builds against (master-owned).
 * Specialists IMPORT these (read-only); a contract change is escalated to the master.
 * Each maps to a locked ADR:
 *   chunk      -> ADR-002 / ADR-004     retrieval -> ADR-002 / ADR-003
 *   projection -> ADR-002 (+ ADR-005 gate)   events -> ADR-006
 *   provider   -> ADR-005               wire     -> ADR-008
 *   engine     -> ADR-006 (Consumer API #6)
 */
export type { Chunk, SymbolEntry } from './chunk.js'
export type { CreateEngine, Engine, EngineConfig, IngestReport, Unsubscribe } from './engine.js'
export type { EmitFn, Event, EventLayer } from './events.js'
export type {
  Citation,
  ConsumerIntent,
  GateDecision,
  Projection,
  ScoreGate,
  Turn,
} from './projection.js'
export type { AnswerChunk, Provider } from './provider.js'
export type { RankedChunk, RetrievalResult } from './retrieval.js'
export { COS_FLOOR } from './retrieval.js'
export type {
  AnswerTelemetry,
  ChunkTelemetry,
  Consumer,
  EngineTelemetry,
  HealthReport,
  IndexTelemetry,
  IngestTelemetry,
  Leg,
  MembraneTelemetry,
  Observable,
  QueryLogEntry,
  RagError,
  RagErrorCode,
} from './telemetry.js'
export type {
  QueryRequest,
  QuerySseEvent,
  SearchRequest,
  SearchResponse,
  TraceWsMessage,
  WireProjection,
} from './wire.js'
