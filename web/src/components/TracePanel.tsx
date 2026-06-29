import type { Event, EventLayer } from '../contract'

const LAYER_ORDER: EventLayer[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'membrane', 'L5']

/** Compact, INERT summary of an event payload (refs + counts, never blobs — R3). */
function summarizePayload(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    return Object.entries(payload as Record<string, unknown>)
      .map(([key, value]) => `${key}=${typeof value === 'object' ? '…' : String(value)}`)
      .join(' · ')
  }
  return ''
}

/**
 * Live per-layer trace timeline. Events are already filtered to the current queryId by
 * useTraceSocket (TKT-504); here they group by EventLayer to make the determinism gradient
 * visible. The L5 row carries the cost story. Payloads render as escaped text (no HTML).
 */
export function TracePanel({ events, status }: { events: Event[]; status?: string }) {
  const grouped = LAYER_ORDER.map((layer) => ({
    layer,
    items: events.filter((e) => e.layer === layer),
  })).filter((g) => g.items.length > 0)

  return (
    <aside className="trace">
      <div className="trace__head">Trace{status ? ` · ${status}` : ''}</div>
      {grouped.length === 0 ? (
        <div className="trace__empty">No events yet — ask a question to watch the pipeline.</div>
      ) : (
        <ol className="trace__layers">
          {grouped.map(({ layer, items }) => (
            <li key={layer} className="trace__layer">
              <span className="trace__layer-name">{layer}</span>
              <ul className="trace__events">
                {items.map((event) => (
                  <li key={`${layer}-${event.ts}-${event.type}`} className="trace__event">
                    <span className="trace__type">{event.type}</span>
                    <span className="trace__payload">{summarizePayload(event.payload)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
