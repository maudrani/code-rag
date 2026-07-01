import { Bar, BarChart, Cell, XAxis, YAxis } from 'recharts'
import { type ChartConfig, ChartContainer } from '@/components/ui/chart'

export interface BarDatum {
  name: string
  value: number
  /** CSS colour (e.g. `var(--chart-2)`); falls back to the primary token. */
  color?: string
}

/**
 * MiniBarChart — a compact horizontal bar chart. It is a VISUAL enhancement ONLY: the whole subtree
 * is `aria-hidden`, because the numeric truth is always rendered as text by the calling card (real
 * a11y + non-flaky jsdom tests never depend on the SVG). Recharts' ResponsiveContainer is given a
 * real `initialDimension` by ChartContainer, and ResizeObserver is stubbed in the test setup, so the
 * chart mounts cleanly under jsdom without any assertion touching it.
 */
export function MiniBarChart({
  data,
  config,
  className,
}: {
  data: BarDatum[]
  config: ChartConfig
  className?: string
}) {
  if (data.length === 0) {
    return null
  }
  return (
    <div className={className} aria-hidden="true" data-testid="mini-bar-chart">
      <ChartContainer config={config} className="h-[120px] w-full">
        <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 6, right: 12 }}>
          <YAxis
            type="category"
            dataKey="name"
            width={74}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
          />
          <XAxis type="number" hide />
          <Bar dataKey="value" radius={4}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color ?? 'var(--primary)'} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}
