import { Activity, ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CONSUMER_TONES, OUTCOME_TONES, type OutcomeTone, STATUS_TONES } from '@/lib/badgeTones'
import { cn } from '@/lib/utils'
import type { EventSourceFactory, LedgerStatus } from '../clients/ledgerStream'
import { search } from '../clients/searchClient'
import { useLedgerStream } from '../clients/useLedgerStream'
import type { Chunk, Leg, QueryLogEntry, WireProjection } from '../contract'
import { formatCost, formatInt, formatMs, formatScore } from './observability/formatters'
import { ResultsList } from './ResultsList'
import { SourceViewer } from './SourceViewer'

const STATUS_TEXT: Record<LedgerStatus, string> = {
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Offline',
}

function StatusPill({ status }: { status: LedgerStatus }) {
  // colour from the AA-approved STATUS_TONES (TKT-526) — `closed` was muted-on-muted (illegible).
  return (
    <span
      className="flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-0.5 text-xs"
      style={{ color: STATUS_TONES[status] }}
      data-status={status}
    >
      <span
        className={cn('size-1.5 rounded-full', status === 'open' && 'animate-pulse')}
        style={{ backgroundColor: STATUS_TONES[status] }}
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

/**
 * Per-card result preview (TKT-531). Mounts ONLY while the card is expanded, so collapsing the card
 * unmounts it — the operator's "clear on close" (N open cards never accumulate N mounted result lists).
 * On mount it re-runs the card's query through the deterministic /search (same results, no backend or
 * contract change) and renders them reusing the manual-search result row. A mountedRef ignores a stale
 * in-flight response if the card is collapsed before it resolves (rapid expand/collapse). Every state.
 */
function LedgerRowResults({ query, baseUrl }: { query: string; baseUrl: string }) {
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading')
  const [projection, setProjection] = useState<WireProjection | null>(null)
  const [source, setSource] = useState<Chunk | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    setStatus('loading')
    search(query, baseUrl)
      .then((p) => {
        if (mountedRef.current) {
          setProjection(p)
          setStatus('ready')
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setStatus('error')
        }
      })
    return () => {
      mountedRef.current = false // collapse/unmount → ignore a late (stale) response
    }
  }, [query, baseUrl])

  if (status === 'loading') {
    return (
      <div role="status" className="mt-2 text-xs text-muted-foreground">
        Loading results…
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div role="alert" className="mt-2 text-xs text-muted-foreground">
        Couldn’t load results for this query.
      </div>
    )
  }
  const results = projection?.results ?? []
  if (results.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">No results retrieved for this query.</p>
    )
  }
  return (
    <div
      data-testid="ledger-row-results"
      className="mt-2 max-h-64 overflow-auto rounded-md border border-border/60 p-2"
    >
      <ResultsList results={results} onOpen={(r) => setSource(r.chunk)} />
      {source ? <SourceViewer chunk={source} /> : null}
    </div>
  )
}

function LedgerRow({ entry, baseUrl }: { entry: QueryLogEntry; baseUrl: string }) {
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
          data-consumer={entry.consumer}
          style={{ color: CONSUMER_TONES[entry.consumer] }}
          className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide"
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
          {/* the query's actual retrieved results — lazy on expand, unmounted on collapse (TKT-531) */}
          <LedgerRowResults query={entry.query} baseUrl={baseUrl} />
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
            <LedgerRow key={entry.queryId} entry={entry} baseUrl={baseUrl} />
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
