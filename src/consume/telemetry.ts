import type {
  AnswerTelemetry,
  ChunkTelemetry,
  Consumer,
  EngineTelemetry,
  HealthReport,
  IndexTelemetry,
  IngestTelemetry,
  Observable,
  QueryLogEntry,
  SymbolEntry,
} from '../contracts/index.js'
import { readLedger } from './ledger.js'

/**
 * The telemetry read-surface SSOT (ADR-012 / observability design §5.2). The CLI,
 * the MCP server, and the HTTP routes ALL read telemetry through these verbs, so
 * the three payloads are identical BY CONSTRUCTION (the parity test guards that no
 * transport bypasses this module). The master's contract structs (telemetry.ts)
 * are already wire-safe plain objects — so these functions ARE the serializer: the
 * single place the wire shape is pinned (and where a future non-wire field would be
 * stripped). No redundant identity wrappers.
 */

/**
 * The layers `stats --layer X` can surface — EXACTLY those EngineTelemetry holds
 * (ingest, chunk, index + the last query's retrieve/answer). `membrane` is NOT in the
 * holding snapshot, so it is not selectable here (surfacing more is a contract ask,
 * not a guess — escalate, don't fabricate).
 */
export type StatsLayer = 'ingest' | 'chunk' | 'index' | 'retrieve' | 'answer'

export const STATS_LAYERS: readonly StatsLayer[] = [
  'ingest',
  'chunk',
  'index',
  'retrieve',
  'answer',
]

/** Runtime guard for an untrusted layer string (CLI `--layer`, HTTP `?layer=`). */
export function isStatsLayer(value: string): value is StatsLayer {
  return (STATS_LAYERS as readonly string[]).includes(value)
}

/** The ledger consumers (telemetry.ts Consumer). The `log` filter validates against these. */
export const CONSUMERS: readonly Consumer[] = ['web', 'http', 'cli', 'mcp', 'package']

/** Runtime guard for an untrusted consumer string (CLI `--consumer`, HTTP `?consumer=`). */
export function isConsumer(value: string): value is Consumer {
  return (CONSUMERS as readonly string[]).includes(value)
}

/** The per-layer struct a `stats --layer X` returns. */
export type LayerTelemetry =
  | IngestTelemetry
  | ChunkTelemetry
  | IndexTelemetry
  | QueryLogEntry
  | AnswerTelemetry

/** A layer-scoped stats payload — the shape `stats --layer X` emits over every transport. */
export interface LayerStats {
  layer: StatsLayer
  /** null = the layer has no data yet (e.g. retrieve/answer before the first query). */
  data: LayerTelemetry | null
}

/**
 * selectLayer — project the holding snapshot down to one layer. Returns null (never
 * undefined, never throws) when the layer has no data: retrieve/answer are null
 * before the first query, and answer is null on a refused query (no L5 telemetry).
 */
export function selectLayer(t: EngineTelemetry, layer: StatsLayer): LayerTelemetry | null {
  switch (layer) {
    case 'ingest':
      return t.ingest
    case 'chunk':
      return t.chunk
    case 'index':
      return t.index
    case 'retrieve':
      return t.lastQuery?.retrieve ?? null
    case 'answer':
      return t.lastQuery?.answer ?? null
  }
}

/** getStats() → the full holding snapshot; getStats(layer) → just that projected layer. */
export function getStats(engine: Observable): EngineTelemetry
export function getStats(engine: Observable, layer: StatsLayer): LayerStats
export function getStats(engine: Observable, layer?: StatsLayer): EngineTelemetry | LayerStats {
  const snapshot = engine.telemetry()
  if (layer === undefined) return snapshot
  return { layer, data: selectLayer(snapshot, layer) }
}

/**
 * ledgerLayerStats — the retrieve/answer layer read from the SHARED ledger (cross-consumer), for a
 * fresh process that ran no query of its own. `retrieve`/`answer` are per-query + in-memory, so a bare
 * `code-rag stats --layer retrieve` shows null even though the web (a long-running server that HAS run
 * queries) shows them — the Observability tab promotes a command that standalone reads empty. Reading
 * CODE_RAG_LEDGER's newest entry closes that gap: `retrieve` IS the newest QueryLogEntry; `answer` is
 * the newest ANSWERED entry's L5 telemetry (a --dry / search entry has no L5, so it stays honestly null).
 * The membrane never sees this — it is a consume-side read-surface fallback, gated on the env being set.
 */
export function ledgerLayerStats(layer: 'retrieve' | 'answer', ledgerPath: string): LayerStats {
  const entries = readLedger(ledgerPath) // newest-first, reconciled (retrieve ⊕ outcome)
  if (layer === 'retrieve') return { layer, data: entries[0] ?? null }
  const answered = entries.find((e) => e.answered === true)
  const data: AnswerTelemetry | null = answered
    ? {
        band: answered.band === 'refuse' ? 'refuse' : 'answer',
        // tier + model ARE on the entry (populated at L4 from the gate decision, FTR-3 P1); fall back
        // only for a pre-FTR-3 ledger line that predates the fields.
        tier: answered.tier ?? 'cheap',
        model: answered.model ?? '(unknown)',
        tokens: answered.tokens ?? 0,
        estCost: answered.estCost ?? 0,
      }
    : null
  return { layer, data }
}

/** getHealth — the aggregate health surface (CLI exits non-zero on 'down'; HTTP 200/503). */
export function getHealth(engine: Observable): HealthReport {
  return engine.health()
}

/** getLog — the cross-consumer ledger, optionally filtered by consumer + limited. */
export function getLog(
  engine: Observable,
  opts?: { consumer?: Consumer; limit?: number },
): QueryLogEntry[] {
  return engine.queryLog(opts)
}

/** The `log` WIRE payload — an OBJECT (not a bare array), so MCP structuredContent can carry it
 *  and the CLI/MCP/HTTP shapes stay byte-identical (parity by construction). */
export interface LogPayload {
  entries: QueryLogEntry[]
}

/** getLogPayload — the single wire shape for `log` across every transport. */
export function getLogPayload(
  engine: Observable,
  opts?: { consumer?: Consumer; limit?: number },
): LogPayload {
  return { entries: getLog(engine, opts) }
}

/** The `symbols` WIRE payload — an OBJECT (not a bare array), so MCP structuredContent can carry it
 *  and the CLI/MCP/HTTP shapes stay byte-identical (parity by construction). Mirrors LogPayload. */
export interface SymbolsPayload {
  symbols: SymbolEntry[]
}

/**
 * getSymbols — the corpus symbol read-surface (autocomplete + a corpus tree). ASYNC: the membrane
 * ensures the index and projects its chunks to their identity (path, symbol, kind, lang, span) — it
 * works with no prior query. The only read-surface verb that awaits (symbols() returns a Promise).
 */
export async function getSymbols(engine: Observable): Promise<SymbolEntry[]> {
  return engine.symbols()
}

/** getSymbolsPayload — the single wire shape for `symbols` across every transport. */
export async function getSymbolsPayload(engine: Observable): Promise<SymbolsPayload> {
  return { symbols: await getSymbols(engine) }
}
