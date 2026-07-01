import { Boxes, Database, FileStack, Search, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ChartConfig } from '@/components/ui/chart'
import type {
  AnswerTelemetry,
  ChunkTelemetry,
  IndexTelemetry,
  IngestTelemetry,
  QueryLogEntry,
} from '../../contract'
import {
  distributionData,
  formatBytes,
  formatCost,
  formatInt,
  formatMs,
  formatScore,
  formatStale,
  legChartData,
} from './formatters'
import { type BarDatum, MiniBarChart } from './MiniBarChart'
import { EmptyState, Metric, StatCard } from './StatCard'

const ICON = 'size-4'

/** L1 · Ingest — files walked/indexed/skipped, chunk yield, wall time, per-language spread. */
export function IngestCard({ data }: { data: IngestTelemetry | null }) {
  return (
    <StatCard
      layerLabel="L1 · Ingest"
      title="Ingest"
      icon={<FileStack className={ICON} />}
      badge={data ? <Badge variant="secondary">{formatInt(data.filesIndexed)} files</Badge> : null}
    >
      {data ? (
        <div className="flex flex-col">
          <Metric
            label="Files indexed"
            value={`${formatInt(data.filesIndexed)} / ${formatInt(data.filesWalked)}`}
          />
          <Metric label="Skipped" value={formatInt(data.skipped)} />
          <Metric label="Errors" value={formatInt(data.errors.length)} />
          <Metric label="Chunks" value={formatInt(data.chunks)} />
          <Metric label="Duration" value={formatMs(data.durationMs)} />
        </div>
      ) : (
        <EmptyState>Not ingested yet.</EmptyState>
      )}
    </StatCard>
  )
}

const DIST_CONFIG: ChartConfig = { value: { label: 'Chunks' } }
const distColored = (rec: Record<string, number>): BarDatum[] =>
  distributionData(rec)
    .slice(0, 5)
    .map((d) => ({ ...d, color: 'var(--chart-1)' }))

/** L2 · Chunk — total chunks, glue fallbacks (a chunker health signal), kind distribution. */
export function ChunkCard({ data }: { data: ChunkTelemetry | null }) {
  return (
    <StatCard
      layerLabel="L2 · Chunk"
      title="Chunk"
      icon={<Boxes className={ICON} />}
      badge={data ? <Badge variant="secondary">{formatInt(data.count)} chunks</Badge> : null}
    >
      {data ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col">
            <Metric label="Total chunks" value={formatInt(data.count)} />
            <Metric label="Glue fallbacks" value={formatInt(data.glueFallbacks)} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">By kind</p>
            <MiniBarChart data={distColored(data.byKind)} config={DIST_CONFIG} />
            <ul className="mt-1 flex flex-wrap gap-1">
              {distributionData(data.byKind)
                .slice(0, 5)
                .map((d) => (
                  <li key={d.name}>
                    <Badge variant="outline" className="font-mono text-[0.7rem]">
                      {d.name} {formatInt(d.value)}
                    </Badge>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      ) : (
        <EmptyState>No chunks yet.</EmptyState>
      )}
    </StatCard>
  )
}

/** L3 · Index — document count, on-disk/in-memory size, freshness of the last build. */
export function IndexCard({ data }: { data: IndexTelemetry | null }) {
  return (
    <StatCard
      layerLabel="L3 · Index"
      title="Index"
      icon={<Database className={ICON} />}
      badge={data ? <Badge variant="secondary">{formatInt(data.docs)} docs</Badge> : null}
    >
      {data ? (
        <div className="flex flex-col">
          <Metric label="Documents" value={formatInt(data.docs)} />
          <Metric label="Size" value={formatBytes(data.sizeBytes)} />
          <Metric label="Built" value={formatStale(data.staleMs)} />
        </div>
      ) : (
        <EmptyState>Index not built yet.</EmptyState>
      )}
    </StatCard>
  )
}

const LEG_COLOR: Record<string, string> = {
  bm25: 'var(--chart-1)',
  dense: 'var(--chart-2)',
  structural: 'var(--chart-4)',
}
const LEG_CONFIG: ChartConfig = { value: { label: 'Score' } }

/**
 * L4 · Retrieve — the headline card. The last query's per-leg fused scores (bm25 / dense /
 * structural) as text AND an aria-hidden bar. `dense` being non-zero is the visible proof the
 * embedder is live (FTR-53). Empty until the first query populates `lastQuery.retrieve`.
 */
export function RetrieveCard({ entry }: { entry: QueryLogEntry | null }) {
  const legs = entry ? legChartData(entry.scoresByLeg) : []
  const bars: BarDatum[] = legs.map((l) => ({
    name: l.label,
    value: l.score,
    color: LEG_COLOR[l.leg],
  }))
  return (
    <StatCard
      layerLabel="L4 · Retrieve"
      title="Retrieve"
      icon={<Search className={ICON} />}
      badge={
        entry ? (
          <Badge variant={entry.band === 'answer' ? 'default' : 'outline'}>{entry.band}</Badge>
        ) : null
      }
    >
      {entry ? (
        <div className="flex flex-col gap-2">
          <p className="truncate text-sm text-muted-foreground" title={entry.query}>
            “{entry.query}”
          </p>
          <div className="flex flex-col">
            <Metric label="Consumer" value={<Badge variant="outline">{entry.consumer}</Badge>} />
            <Metric label="Results" value={formatInt(entry.resultCount)} />
            <Metric label="Latency" value={formatMs(entry.latencyMs)} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Fused score by leg</p>
            <div className="flex flex-col">
              {legs.map((l) => (
                <Metric key={l.leg} label={l.label} value={formatScore(l.score)} />
              ))}
            </div>
            <MiniBarChart data={bars} config={LEG_CONFIG} />
          </div>
        </div>
      ) : (
        <EmptyState>No query yet — ask a question to populate L4.</EmptyState>
      )}
    </StatCard>
  )
}

/** L5 · Answer — the only non-deterministic layer: tier, model, tokens, estimated cost. */
export function AnswerCard({ data }: { data: AnswerTelemetry | null }) {
  return (
    <StatCard
      layerLabel="L5 · Answer"
      title="Answer"
      icon={<Sparkles className={ICON} />}
      badge={
        data ? (
          <Badge variant={data.tier === 'strong' ? 'default' : 'secondary'}>{data.tier}</Badge>
        ) : null
      }
    >
      {data ? (
        <div className="flex flex-col">
          <Metric label="Band" value={data.band} />
          <Metric label="Tier" value={data.tier} />
          <Metric label="Model" value={data.model} />
          <Metric label="Tokens" value={formatInt(data.tokens)} />
          <Metric label="Est. cost" value={formatCost(data.estCost)} />
        </div>
      ) : (
        <EmptyState>No answer yet — the last query refused or none has run.</EmptyState>
      )}
    </StatCard>
  )
}
