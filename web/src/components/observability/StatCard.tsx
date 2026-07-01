import { type ReactNode, useId } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

/**
 * StatCard — the shell every per-layer observability card shares (FTR-56). A shadcn Card exposed as
 * an accessible landmark: `role="region"` named by its own heading (aria-labelledby), so a screen
 * reader (and `getByRole('region', { name })`) can navigate the layers. The `layerLabel` is the L1..L5
 * tag; `title` is the human name; `badge` is the headline stat; `icon` is decorative (aria-hidden).
 */
export function StatCard({
  layerLabel,
  title,
  icon,
  badge,
  children,
}: {
  layerLabel: string
  title: string
  icon?: ReactNode
  badge?: ReactNode
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <Card role="region" aria-labelledby={headingId} className="gap-3 py-4">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 px-4">
        <div className="flex items-center gap-2">
          {icon ? (
            <span className="text-muted-foreground" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <div className="flex flex-col gap-0.5">
            <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
              {layerLabel}
            </span>
            <h3 id={headingId} className="text-sm font-semibold leading-none">
              {title}
            </h3>
          </div>
        </div>
        {badge}
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  )
}

/** A single label/value row — the value is monospace + tabular so columns of numbers line up. */
export function Metric({
  label,
  value,
  title,
}: {
  label: string
  value: ReactNode
  title?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums" title={title}>
        {value}
      </span>
    </div>
  )
}

/** The explicit empty state a layer renders when it has no data yet (never a blank card). */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-1 text-sm italic text-muted-foreground">{children}</p>
}
