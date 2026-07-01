import { Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EventSourceFactory, LedgerStatus } from '../clients/ledgerStream'
import { useLedgerStream } from '../clients/useLedgerStream'
import type { Consumer, QueryLogEntry } from '../contract'
import { formatMs, formatScore } from './observability/formatters'

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

function LedgerRow({ entry }: { entry: QueryLogEntry }) {
  return (
    <li className="ledger-entry flex items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2">
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
        className={cn(
          'shrink-0 rounded px-1.5 py-0.5 text-[11px]',
          entry.band === 'answer' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        {entry.band}
      </span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {formatMs(entry.latencyMs)}
      </span>
      <span
        className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
        title="dense-leg fused score"
      >
        d {formatScore(entry.scoresByLeg.dense ?? 0)}
      </span>
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
    <section className="obs" aria-label="Live listener">
      <div className="mb-4 flex items-start justify-between gap-3">
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
        <ul className="flex flex-col gap-2" aria-label="Live query feed" aria-live="polite">
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
