import type { ReactNode } from 'react'
import type { ChatTelemetry } from '../clients/useChatStream'
import type { Event, EventLayer } from '../contract'
import { formatCost, formatInt, formatScore } from './observability/formatters'

const LAYER_ORDER: EventLayer[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'membrane', 'L5']

/** Compact, INERT summary of an event payload (refs + counts, never blobs — R3). */
function summarizePayload(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    return Object.entries(payload as Record<string, unknown>)
      .map(([key, value]) => `${key}=${typeof value === 'object' ? '…' : String(value)}`)
      .join(' · ')
  }
  return ''
}

function TeleRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  )
}

/**
 * The COMPLETE per-queryId telemetry (FTR-56 P6 #2) — assembled from data the chat already receives
 * over the wire (WireProjection meta + the SSE done frame), NO extra endpoint:
 *   L0 rewrite (question → resolvedQuery) · L3/L4 top hit per-leg + fused + cosine · gate + model · L5 tokens + cost.
 */
function TelemetrySection({ telemetry }: { telemetry: ChatTelemetry }) {
  const top = telemetry.results[0]
  const rewritten = Boolean(
    telemetry.resolvedQuery && telemetry.resolvedQuery !== telemetry.question,
  )
  const { decision } = telemetry
  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded-md border border-border/60 bg-card/60 p-2 text-xs">
      <TeleRow label="L0 rewrite">
        {rewritten ? (
          <span>
            <span className="text-muted-foreground line-through">{telemetry.question}</span>
            {' → '}
            <span className="font-medium">{telemetry.resolvedQuery}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">standalone — no rewrite</span>
        )}
      </TeleRow>
      {top ? (
        <TeleRow label="L3/L4 top">
          <span className="font-mono">{top.chunk.path}</span>
          <span className="ml-1 text-muted-foreground tabular-nums">
            bm25 {formatScore(top.scores.bm25)} · dense {formatScore(top.scores.dense)} · struct{' '}
            {formatScore(top.scores.structural)} · fused {formatScore(top.fused)}
            {typeof top.cosine === 'number' ? ` · cos ${top.cosine.toFixed(3)}` : ''}
          </span>
        </TeleRow>
      ) : null}
      <TeleRow label="gate">
        <span className="tabular-nums">
          grounding {formatScore(decision.groundingScore)} · {decision.band} · {decision.tier} ·{' '}
          {decision.model || 'deterministic'}
        </span>
      </TeleRow>
      <TeleRow label="L5 answer">
        {decision.band === 'refuse' ? (
          <span className="text-muted-foreground">refused — no LLM call ($0)</span>
        ) : telemetry.usage ? (
          <span className="tabular-nums">
            {formatInt(telemetry.usage.tokensTotal)} tokens · {formatCost(telemetry.usage.estCost)}
          </span>
        ) : (
          <span className="text-muted-foreground">streaming…</span>
        )}
      </TeleRow>
    </div>
  )
}

/**
 * Trace rail. When bound to a chat queryId it shows the COMPLETE telemetry (TelemetrySection) plus the
 * live per-layer event timeline (the determinism gradient + per-event timings). Events are already
 * filtered to the current queryId by useTraceSocket; payloads render as escaped text (no HTML).
 */
export function TracePanel({
  events,
  status,
  telemetry,
}: {
  events: Event[]
  status?: string
  telemetry?: ChatTelemetry | null
}) {
  const grouped = LAYER_ORDER.map((layer) => ({
    layer,
    items: events.filter((e) => e.layer === layer),
  })).filter((g) => g.items.length > 0)
  const t0 = events.length > 0 ? Math.min(...events.map((e) => e.ts)) : 0

  return (
    <aside className="trace">
      <div className="trace__head">Trace{status ? ` · ${status}` : ''}</div>
      {telemetry ? <TelemetrySection telemetry={telemetry} /> : null}
      {grouped.length === 0 ? (
        <div className="trace__empty">No events yet — ask a question to watch the pipeline.</div>
      ) : (
        <ol className="trace__layers">
          {grouped.map(({ layer, items }) => (
            <li key={layer} className="trace__layer">
              <span className="trace__layer-name">{layer}</span>
              <ul className="trace__events">
                {items.map((event) => (
                  <li key={`${layer}-${event.ts}-${event.type}`} className="trace__event">
                    <span className="trace__type">{event.type}</span>
                    <span className="trace__payload">{summarizePayload(event.payload)}</span>
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      +{event.ts - t0}ms
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
