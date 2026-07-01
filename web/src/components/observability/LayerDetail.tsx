import { Terminal } from 'lucide-react'
import type { EngineTelemetry } from '../../contract'
import type { LayerContent } from './layerContent'

/**
 * LayerDetail — one layer's full sub-tab view (FTR-56 P3). Instead of cramming all five layers into a
 * single grid, each layer gets room to breathe: a blurb (what it measures), its live telemetry card,
 * a glossary (what each number means), and the CLI command an agent owning that layer would run.
 */
export function LayerDetail({ layer, stats }: { layer: LayerContent; stats: EngineTelemetry }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{layer.blurb}</p>
      {layer.card(stats)}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          What each number means
        </h4>
        <dl className="flex max-w-2xl flex-col gap-2">
          {layer.glossary.map((g) => (
            <div key={g.term} className="text-sm">
              <dt className="font-medium">{g.term}</dt>
              <dd className="text-muted-foreground">{g.meaning}</dd>
            </div>
          ))}
        </dl>
      </div>
      <CliCallout command={layer.cli} />
    </div>
  )
}

/**
 * CliCallout — the "per-layer agent" angle: the same telemetry this dashboard shows is readable by a
 * script/agent responsible for the layer, via a one-liner. Byte-identical across CLI · MCP · HTTP.
 */
function CliCallout({ command }: { command: string }) {
  return (
    <div className="max-w-2xl rounded-lg border border-border bg-muted/40 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Terminal className="size-3.5" aria-hidden="true" />
        Programmatic access — an agent owning this layer reads the same telemetry
      </div>
      <pre className="overflow-x-auto rounded bg-background px-2.5 py-1.5 font-mono text-sm text-foreground">
        <code>$ {command}</code>
      </pre>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Byte-identical across CLI · MCP · HTTP (parity by construction) — this dashboard is just one
        of five consumers of the same read-surface.
      </p>
    </div>
  )
}
