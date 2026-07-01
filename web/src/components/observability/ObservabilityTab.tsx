import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fetchHealth, fetchStats } from '../../clients/telemetryClient'
import { usePoll } from '../../clients/usePoll'
import { HealthCard } from './HealthCard'
import { LayerDetail } from './LayerDetail'
import { LAYERS } from './layerContent'

/** Live poll cadence — fast enough to feel live in the demo, gentle on the deterministic surface. */
const POLL_MS = 5000

/**
 * ObservabilityTab (FTR-56 P2 + P3) — the demo wow. Surfaces the full L0→L5 telemetry the backend
 * already exposes (GET /stats + /health). The aggregate HEALTH card stays always-visible; the five
 * per-layer views live in their own sub-tabs (operator feedback: don't cram every layer into one
 * pane — give each room to breathe with descriptions + the per-layer agent CLI command). Live-polled
 * via usePoll; every state handled (loading → skeletons, first-load error → message + Retry, empty
 * layers → per-card empty states). Web ⊥ Node: consumes the HTTP wire only.
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

      {/* Aggregate health — always visible (the summary you never want hidden behind a tab). */}
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
        <div role="status" aria-label="Loading telemetry" className="flex flex-col gap-3">
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-56 w-full" />
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
        <Tabs defaultValue="ingest" orientation="vertical" className="items-start">
          <TabsList variant="line" className="shrink-0">
            {LAYERS.map((l) => (
              <TabsTrigger key={l.key} value={l.key} className="justify-start">
                <span className="font-mono text-xs text-muted-foreground">{l.label}</span>
                {l.title}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="min-w-0 flex-1">
            {LAYERS.map((l) => (
              <TabsContent key={l.key} value={l.key}>
                {stats.data ? <LayerDetail layer={l} stats={stats.data} /> : null}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      ) : null}
    </section>
  )
}
