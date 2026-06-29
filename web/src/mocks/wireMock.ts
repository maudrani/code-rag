/**
 * Pure wire-mock generators (no I/O) — the deterministic core of the ADR-008 mock.
 * Tests target these directly; devServer.ts is a thin transport adapter over them.
 * Types come from the type-only contract bridge (../contract) — zero drift.
 */
import type { Event, EventLayer, QuerySseEvent, SearchResponse, WireProjection } from '../contract'

const COST_PER_TOKEN = 0.000002

/** Split answer text into token-ish chunks that rejoin to the original (deterministic). */
export function tokenize(text: string): string[] {
  if (!text) {
    return []
  }
  return text.match(/\S+\s*/g) ?? []
}

export interface QueryStreamOptions {
  answer?: string
}

/**
 * Band-driven SSE event stream (ADR-008). ALWAYS `meta` first; `token`* ONLY when
 * `decision.band === 'answer'`; ALWAYS `done` last. refuse => `[meta, done]`, 0 tokens.
 */
export function makeQueryStream(
  projection: WireProjection,
  options: QueryStreamOptions = {},
): QuerySseEvent[] {
  const events: QuerySseEvent[] = [{ event: 'meta', data: projection }]
  const tokens = projection.decision.band === 'answer' ? tokenize(options.answer ?? '') : []
  for (const text of tokens) {
    events.push({ event: 'token', data: { text } })
  }
  const tokensTotal = tokens.length
  events.push({
    event: 'done',
    data: { tokensTotal, estCost: Number((tokensTotal * COST_PER_TOKEN).toFixed(6)) },
  })
  return events
}

const TRACE_LAYERS: EventLayer[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'membrane', 'L5']

/** Per-layer trace Events for one queryId. Payloads carry refs + counts, never blobs (R3). */
export function makeTraceEvents(queryId: string, baseTs = 1_000): Event[] {
  return TRACE_LAYERS.map((layer, i) => ({
    queryId,
    layer,
    type: `${layer.toLowerCase()}.done`,
    payload: tracePayload(layer),
    ts: baseTs + i * 5,
  }))
}

function tracePayload(layer: EventLayer): Record<string, unknown> {
  switch (layer) {
    case 'L4':
      return { retrieved: 5, fusedTop: 0.0312 }
    case 'L5':
      return { tokens: 128, tier: 'strong', estCost: 0.00026 }
    case 'membrane':
      return { resolved: true, band: 'answer' }
    default:
      return { count: 1 }
  }
}

/** The /search response is the deterministic projection (results + decision), no answer. */
export function makeSearchResponse(projection: WireProjection): SearchResponse {
  return projection
}
