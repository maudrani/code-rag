import { Activity, Check, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { HealthReport } from '../../contract'
import { StatCard } from './StatCard'

type Status = HealthReport['status']

const STATUS_VARIANT: Record<Status, 'default' | 'secondary' | 'destructive'> = {
  ok: 'default',
  degraded: 'secondary',
  down: 'destructive',
}

/**
 * HealthCard — the readiness / anti-vacuity surface (GET /health). The aggregate `status` drives a
 * coloured Badge (ok / degraded / down) and each named check (indexed, provider, …) renders pass/fail
 * with its detail. This is the health half of "observability + determinism = one discipline": the
 * checks are the standing guarantees the engine asserts about itself.
 */
export function HealthCard({ report }: { report: HealthReport }) {
  const checks = Object.entries(report.checks)
  return (
    <StatCard
      layerLabel="Runtime · Health"
      title="Health"
      icon={<Activity className="size-4" />}
      badge={<Badge variant={STATUS_VARIANT[report.status]}>{report.status}</Badge>}
    >
      {checks.length === 0 ? (
        <p className="py-1 text-sm italic text-muted-foreground">No checks reported.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {checks.map(([name, check]) => (
            <li key={name} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-1.5">
                {check.ok ? (
                  <Check className="size-3.5 text-primary" aria-hidden="true" />
                ) : (
                  <X className="size-3.5 text-destructive" aria-hidden="true" />
                )}
                <span className="font-medium">{name}</span>
              </span>
              <span className="flex items-center gap-2">
                {check.detail ? (
                  <span className="text-xs text-muted-foreground">{check.detail}</span>
                ) : null}
                <Badge variant={check.ok ? 'outline' : 'destructive'}>
                  {check.ok ? 'ok' : 'fail'}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </StatCard>
  )
}
