import type { SymbolEntry } from './chunk.js'
import type { Event } from './events.js'

/**
 * Telemetry — the PULL half of observability (design: observability-and-telemetry.md §5).
 *
 * The event bus (events.ts) is the PUSH half: live, per-query, L0→L5. This file is the
 * durable, queryable half: a typed struct PER LAYER about its own behavior, plus the
 * read-surface (`Observable`) every transport (CLI/MCP/HTTP) calls. Master owns these
 * types; each specialist fills + emits their own struct (RULE-019). Adopts peripheral's
 * typed-telemetry-contract pattern (FTR-016) — NOT a generic metrics registry.
 */

/** Which leg of the hybrid retrieval (for `scoresByLeg`). */
export type Leg = 'bm25' | 'dense' | 'structural'

/** Who issued a query — the cross-consumer discriminator that makes one ledger see all. */
export type Consumer = 'web' | 'http' | 'cli' | 'mcp' | 'package'

/** L1 ingest. Invariant: `filesWalked === filesIndexed + skipped + errors.length`. */
export interface IngestTelemetry {
  filesWalked: number
  filesIndexed: number
  skipped: number
  chunks: number
  byLang: Record<string, number>
  errors: string[]
  durationMs: number
}

/** L2 chunk. */
export interface ChunkTelemetry {
  count: number
  byKind: Record<string, number>
  byLang: Record<string, number>
  /** symbols demoted to a `<module>` glue chunk (a body-guard fallback). */
  glueFallbacks: number
}

/** L3 index. */
export interface IndexTelemetry {
  docs: number
  /** null when the live index is `:memory:` (no on-disk size). */
  sizeBytes: number | null
  /** epoch ms of the last build; `staleMs = now - builtAt` at snapshot time. */
  builtAt: number
  staleMs: number
}

/**
 * L4 retrieve — the per-query ledger entry. Append-only; the cross-consumer record
 * (adopt peripheral QueryLogEntry; `scoresByLeg` + `consumer` are novel for us).
 */
export interface QueryLogEntry {
  ts: number
  queryId: string
  consumer: Consumer
  query: string
  resultCount: number
  /** top fused contribution per leg — the per-leg breakdown a specialist reviews. */
  scoresByLeg: Record<Leg, number>
  band: 'refuse' | 'answer'
  /** the gate's routing decision for this query: the tier + the model id that would serve
   *  (or did serve) L5. Populated at L4 from the gate decision (the SSOT, RULE-019); OPTIONAL
   *  for back-compat with pre-FTR-3 ledger lines that predate these fields (FTR-3 P1). */
  tier?: 'cheap' | 'strong'
  model?: string
  /** the L5 outcome, joined by queryId when the answer completes (FTR-3 P2). `answered` is false for
   *  a refused query (band refuse, zero cost) and UNDEFINED for a search-only query that never invoked
   *  answer(); tokens + estCost mirror AnswerTelemetry (the L5 SSOT). */
  answered?: boolean
  tokens?: number
  estCost?: number
  latencyMs: number
}

/** L5 answer. */
export interface AnswerTelemetry {
  band: 'refuse' | 'answer'
  tier: 'cheap' | 'strong'
  model: string
  tokens: number
  estCost: number
}

/** membrane — per-layer latency for one query (novel; no peripheral analog). */
export interface MembraneTelemetry {
  queryId: string
  layerMs: Partial<Record<'L0' | 'L4' | 'project' | 'L5', number>>
  citations: number
}

/** The holding (non-per-query) snapshot `Observable.telemetry()` returns. */
export interface EngineTelemetry {
  ingest: IngestTelemetry | null
  /** L2 chunk telemetry — its read-surface slot (else ChunkTelemetry is the
   *  "telemetry no one can read" anti-pattern). Wired when ingest-chunk ships
   *  collectChunkTelemetry (RULE-019); null until then. */
  chunk: ChunkTelemetry | null
  index: IndexTelemetry | null
  /** the most recent query's per-query telemetry (null before the first query). */
  lastQuery: { retrieve: QueryLogEntry; answer: AnswerTelemetry | null } | null
}

/** Health — the `health` surface (CLI exits non-zero on `down`; HTTP 200/503). */
export interface HealthReport {
  status: 'ok' | 'degraded' | 'down'
  checks: Record<string, { ok: boolean; detail?: string }>
  ts: number
}

/** Typed error codes — a union, not a raw `Error` (adopt peripheral PeripheralError). */
export type RagErrorCode =
  | 'NOT_INDEXED'
  | 'INGEST_FAILED'
  | 'RETRIEVE_FAILED'
  | 'PROVIDER_FAILED'
  | 'INVALID_INPUT'

export interface RagError {
  code: RagErrorCode
  message: string
}

/**
 * Observable — the read-surface every transport calls (design §5.2). Kept SEPARATE
 * from `Engine` so a plain `Engine` mock still type-checks for the existing query/answer
 * consumers; `createEngine` returns `Engine & Observable`, and the telemetry transports
 * (CLI/MCP/HTTP `stats`/`health`, the trace replay) depend on `Observable`.
 *
 * `replay` is the fix for the trace late-subscriber race (§4): a client that subscribes
 * after L0–L4 already emitted drains the ring buffer for its queryId, then tails live.
 */
export interface Observable {
  /** the holding per-layer snapshot (ingest/index + the last query). */
  telemetry(): EngineTelemetry
  /** the aggregate health surface. */
  health(): HealthReport
  /** the buffered events for a queryId (the late-subscriber replay); empty if evicted. */
  replay(queryId: string): Event[]
  /** the cross-consumer ledger — every query from every consumer, newest first. */
  queryLog(opts?: { consumer?: Consumer; limit?: number }): QueryLogEntry[]
  /** the corpus symbol read-surface (path/symbol/kind/lang/span); indexes on first call. Feeds
   *  `/symbols` (autocomplete + corpus tree) — the fifth read-surface, one per consumer. */
  symbols(): Promise<SymbolEntry[]>
}
