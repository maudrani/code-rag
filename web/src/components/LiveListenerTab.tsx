import { Activity, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { OUTCOME_TONES, type OutcomeTone } from '@/lib/badgeTones'
import { cn } from '@/lib/utils'
import type { EventSourceFactory, LedgerStatus } from '../clients/ledgerStream'
import { useLedgerStream } from '../clients/useLedgerStream'
import type { Consumer, Leg, QueryLogEntry } from '../contract'
import { formatCost, formatInt, formatMs, formatScore } from './observability/formatters'

/** Each consumer of the one read-surface gets a distinct hue so the cross-consumer story reads at a glance. */
const CONSUMER_STYLE: Record<Consumer, string> = {
  cli: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  mcp: 'border-violet-500/40 bg-violet-500/15 text-violet-300',
  http: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  web: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  package: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
}

const STATUS_TEXT: Record<LedgerStatus, string> = {
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Offline',
}

function StatusPill({ status }: { status: LedgerStatus }) {
  const tone =
    status === 'open'
      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
      : status === 'reconnecting'
        ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
        : 'border-border bg-muted text-muted-foreground'
  return (
    <span
      className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs', tone)}
      data-status={status}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'open' ? 'animate-pulse bg-emerald-400' : 'bg-current',
        )}
        aria-hidden="true"
      />
      {STATUS_TEXT[status]}
    </span>
  )
}

const LEG_LABELS: Leg[] = ['bm25', 'dense', 'structural']

/**
 * The L5 outcome of a ledger entry (the enriched QueryLogEntry, FTR-3). The tone maps to an
 * AA-approved design token (badgeTones.ts, proven in ui-verify.test.ts) so the label is always
 * legible — the earlier `refused` badge was muted-on-muted and invisible (TKT-522):
 *  - `refused · $0`  — the gate withheld the LLM (band refuse, zero cost)
 *  - the model id    — an LLM answer (tokens + cost recorded)
 *  - `deterministic` — a search-only query that never invoked the LLM (contract: answered undefined)
 */
function llmOutcome(entry: QueryLogEntry): { label: string; tone: OutcomeTone } {
  if (entry.band === 'refuse' || entry.answered === false) {
    return { label: 'refused · $0', tone: 'refused' }
  }
  if (entry.model) {
    return { label: entry.model, tone: 'model' }
  }
  return { label: 'deterministic', tone: 'deterministic' }
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  )
}

function LedgerRow({ entry }: { entry: QueryLogEntry }) {
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  const outcome = llmOutcome(entry)
  const isLlm = entry.band === 'answer' && Boolean(entry.model)
  return (
    <li className="ledger-entry min-h-10 shrink-0 overflow-hidden rounded-md border border-border/60 bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/40"
      >
        <span
          className={cn(
            'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide',
            CONSUMER_STYLE[entry.consumer],
          )}
        >
          {entry.consumer}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm" title={entry.query}>
          {entry.query}
        </span>
        <span
          data-testid="ledger-outcome"
          data-tone={outcome.tone}
          style={{ color: OUTCOME_TONES[outcome.tone] }}
          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px]"
          title="L5 outcome — the model that served, or deterministic / refused"
        >
          {outcome.label}
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {formatMs(entry.latencyMs)}
        </span>
        <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {open ? (
        <div className="border-t border-border/60 px-3 py-2">
          {/* the full (untruncated) query — more context than the summary row (TKT-521) */}
          <p className="mb-2 break-words text-xs">
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              query
            </span>{' '}
            {entry.query}
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
            <Detail label="Consumer" value={entry.consumer} />
            <Detail label="Band" value={entry.band} />
            <Detail label="Results" value={String(entry.resultCount)} />
            <Detail label="Latency" value={formatMs(entry.latencyMs)} />
            {isLlm ? (
              <>
                <Detail label="Tier" value={entry.tier ?? '—'} />
                <Detail label="Tokens" value={formatInt(entry.tokens ?? 0)} />
                <Detail label="Est. cost" value={formatCost(entry.estCost ?? 0)} />
              </>
            ) : null}
            {LEG_LABELS.map((leg) => (
              <Detail
                key={leg}
                label={`${leg} score`}
                value={formatScore(entry.scoresByLeg[leg] ?? 0)}
              />
            ))}
          </dl>
        </div>
      ) : null}
    </li>
  )
}

/**
 * LiveListenerTab (FTR-56 P5) — THE wow. Subscribes to GET /ledger/stream (SSE) and renders a live,
 * consumer-tagged feed of every query hitting the one read-surface: run `code-rag ask` in the CLI or
 * call an MCP tool and its query streams into the browser, tagged by transport. Newest-first, animates
 * on arrival. Every state: waiting (connected, no queries yet), reconnecting, and unavailable (no
 * /ledger/stream on this backend — graceful, never crashes). Web ⊥ Node: consumes the wire only.
 */
export function LiveListenerTab({
  baseUrl = '',
  createEventSource,
}: {
  baseUrl?: string
  createEventSource?: EventSourceFactory
}) {
  const { entries, status } = useLedgerStream(
    createEventSource ? { baseUrl, createEventSource } : { baseUrl },
  )

  return (
    <section className="obs flex min-h-0 flex-1 flex-col pb-8" aria-label="Live listener">
      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold leading-tight">
            <Activity className="size-5 text-primary" aria-hidden="true" />
            Live ledger
          </h2>
          <p className="text-sm text-muted-foreground">
            Every query, every consumer — one shared read-surface, streamed live over{' '}
            <code className="font-mono">/ledger/stream</code>.
          </p>
        </div>
        <StatusPill status={status} />
      </div>

      {entries.length > 0 ? (
        <ul
          data-testid="live-feed"
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-1"
          aria-label="Live query feed"
          aria-live="polite"
        >
          {entries.map((entry) => (
            <LedgerRow key={entry.queryId} entry={entry} />
          ))}
        </ul>
      ) : status === 'closed' ? (
        <div
          role="status"
          className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground"
        >
          Live listener unavailable — this backend has no{' '}
          <code className="font-mono">/ledger/stream</code>. The feed lights up automatically once a
          streaming surface is connected.
        </div>
      ) : (
        <div
          role="status"
          className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground"
        >
          Waiting for queries… run <code className="font-mono">code-rag ask "…"</code> in the CLI,
          or call an MCP tool — it appears here live, tagged by consumer.
        </div>
      )}
    </section>
  )
}
