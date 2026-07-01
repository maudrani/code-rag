import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchHealth, fetchStats } from '../../clients/telemetryClient'
import { usePoll } from '../../clients/usePoll'
import { HealthCard } from './HealthCard'
import { AnswerCard, ChunkCard, IndexCard, IngestCard, RetrieveCard } from './LayerCards'

/** Live poll cadence — fast enough to feel live in the demo, gentle on the deterministic surface. */
const POLL_MS = 5000

/**
 * ObservabilityTab (FTR-56 Phase 2) — the demo wow. Surfaces the full L0->L5 telemetry the backend
 * already exposes (GET /stats + /health) but the UI hid. Live-polled via usePoll; EVERY state is
 * handled (loading -> skeletons, first-load error -> message + Retry, empty layers -> per-card empty
 * states, healthy -> the grid). Health and stats poll independently so one failing does not blank the
 * other. Web ⊥ Node: consumes the HTTP wire only.
 */
export function ObservabilityTab({ baseUrl = '' }: { baseUrl?: string }) {
  const statsFetcher = useCallback(() => fetchStats(baseUrl), [baseUrl])
  const healthFetcher = useCallback(() => fetchHealth(baseUrl), [baseUrl])
  const stats = usePoll(statsFetcher, POLL_MS)
  const health = usePoll(healthFetcher, POLL_MS)

  const refreshAll = useCallback(() => {
    stats.refetch()
    health.refetch()
  }, [stats, health])

  return (
    <section className="obs" aria-label="Observability">
      <div className="obs__header mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold leading-tight">Observability</h2>
          <p className="text-sm text-muted-foreground">
            Live L0→L5 telemetry over the wire · the deterministic read-surface
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refreshAll}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="mb-4">
        {health.loading && !health.data ? (
          <Skeleton className="h-32 w-full" role="status" aria-label="Loading health" />
        ) : health.data ? (
          <HealthCard report={health.data} />
        ) : (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
            <span>Health surface unavailable.</span>
            <Button type="button" variant="outline" size="sm" onClick={health.refetch}>
              Retry
            </Button>
          </div>
        )}
      </div>

      {stats.loading && !stats.data ? (
        <div
          role="status"
          aria-label="Loading telemetry"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : stats.error && !stats.data ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
            Couldn’t load telemetry: {stats.error.message}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={stats.refetch}>
            Retry
          </Button>
        </div>
      ) : stats.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <IngestCard data={stats.data.ingest} />
          <ChunkCard data={stats.data.chunk} />
          <IndexCard data={stats.data.index} />
          <RetrieveCard entry={stats.data.lastQuery?.retrieve ?? null} />
          <AnswerCard data={stats.data.lastQuery?.answer ?? null} />
        </div>
      ) : null}
    </section>
  )
}
