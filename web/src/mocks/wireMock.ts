/**
 * Pure wire-mock generators (no I/O) — the deterministic core of the ADR-008 mock.
 * Tests target these directly; devServer.ts is a thin transport adapter over them.
 * Types come from the type-only contract bridge (../contract) — zero drift.
 */
import type {
  Event,
  EventLayer,
  IngestResponse,
  QuerySseEvent,
  SearchResponse,
  WireProjection,
} from '../contract'

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

// ── POST /ingest (FTR-5 P4, TKT-533) ────────────────────────────────────────
// web ⊥ Node bars importing surface's isRepoUrl, so the mock re-states its allowlist shape: a git
// scheme (or scp-like git@host:path) and NO whitespace/shell metacharacters. A local path or an unsafe
// URL is rejected → the devServer answers 400, exactly like the real route (security boundary: an HTTP
// client must not make the server index an arbitrary local path).
const GIT_SCHEME = /^(https?|git|ssh):\/\//i
const SCP_LIKE = /^[\w.-]+@[\w.-]+:[\w./~-]+$/
const SHELL_META = /[\s;&|`$(){}<>'"\\]/

export function looksLikeRepoUrl(url: string): boolean {
  return !SHELL_META.test(url) && (GIT_SCHEME.test(url) || SCP_LIKE.test(url))
}

/** Deterministic /ingest success for a valid-looking repo URL (no I/O). The report is derived from the
 *  URL so the demo shows plausible, STABLE numbers without cloning anything. */
export function makeIngestResponse(url: string): IngestResponse {
  const filesIndexed = 40 + (url.length % 60)
  return {
    activeCorpus: { url },
    ingestReport: {
      filesIndexed,
      chunks: filesIndexed * 6,
      durationMs: 700 + (url.length % 40) * 15,
    },
  }
}
