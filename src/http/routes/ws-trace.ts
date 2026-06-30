import type { NodeWebSocket } from '@hono/node-ws'
import type { MiddlewareHandler } from 'hono'
import type { Engine, Unsubscribe } from '../../contracts/engine.js'
import type { Event } from '../../contracts/events.js'
import type { Observable } from '../../contracts/telemetry.js'

/** The exact upgradeWebSocket type bound by @hono/node-ws (Node, not Cloudflare). */
type UpgradeWebSocket = NodeWebSocket['upgradeWebSocket']

/** Minimal frame sink — the WS socket, or a test double. */
export interface TraceSink {
  send(data: string): void
}

/**
 * forwardTrace — the pure core. Subscribe to the event stream and forward each
 * Event VERBATIM (ADR-006 schema: refs + counts, never blobs — the WS is just
 * transport) as JSON to the sink. Returns the unsubscribe handle (call on socket
 * close → no leak). M1 is single-consumer: the server streams ALL events; the
 * client filters by queryId (ADR-008).
 */
export function forwardTrace(
  subscribe: (handler: (event: Event) => void) => Unsubscribe,
  sink: TraceSink,
): Unsubscribe {
  return subscribe((event) => sink.send(JSON.stringify(event)))
}

/** A stable per-query key: each (queryId, layer, type) fires exactly once per query,
 *  so this dedups the replay backlog against the live tail WITHOUT relying on event
 *  object identity (robust if the membrane returns copies). */
function eventKey(e: Event): string {
  return `${e.queryId}|${e.layer}|${e.type}`
}

/**
 * forwardTraceReplay — the late-subscriber fix (observability design §4). A client
 * that learns its queryId from the SSE `meta` connects AFTER L0–L4 already fired, so
 * a plain live subscription catches only L5. This drains the server-side ring buffer
 * (`engine.replay(queryId)`) BEFORE tailing live, so the late subscriber sees the
 * WHOLE trace.
 *
 * Race-free: subscribe FIRST (live events queue in `pending`), THEN drain the backlog,
 * THEN flush `pending` — deduping by `eventKey` so an event that fired in the
 * subscribe→drain window (present in both backlog and pending) is sent exactly once.
 * The live tail is filtered to this queryId (the client subscribed for one query).
 */
export function forwardTraceReplay(
  subscribe: (handler: (event: Event) => void) => Unsubscribe,
  replay: (queryId: string) => Event[],
  queryId: string,
  sink: TraceSink,
): Unsubscribe {
  const seen = new Set<string>()
  const send = (event: Event): void => {
    const key = eventKey(event)
    if (seen.has(key)) return
    seen.add(key)
    sink.send(JSON.stringify(event))
  }

  let flushed = false
  const pending: Event[] = []
  const unsubscribe = subscribe((event) => {
    if (event.queryId !== queryId) return // this socket is scoped to one query
    if (flushed) send(event)
    else pending.push(event)
  })

  for (const event of replay(queryId)) send(event) // the buffered backlog (chronological)
  flushed = true
  for (const event of pending) send(event) // live events from the window, deduped

  return unsubscribe
}

/**
 * GET /ws/trace[?queryId=] — the ADR-008 trace endpoint. Bridges the engine
 * event-bus to a WebSocket via @hono/node-ws (on Node the upgrade needs this
 * adapter; hono's own `upgradeWebSocket` is Cloudflare-only — gap G2).
 *
 * With `?queryId=Q` the socket REPLAYS Q's buffered L0–L4 then tails Q live (the
 * late-subscriber fix). Without it, it streams ALL live events and the client filters
 * (the M1 back-compatible behavior). Subscribe on open, unsubscribe on close (no leak).
 */
export function traceRoute(
  engine: Engine & Observable,
  upgradeWebSocket: UpgradeWebSocket,
): MiddlewareHandler {
  return upgradeWebSocket((c) => {
    const queryId = c.req.query('queryId')
    let unsubscribe: Unsubscribe = () => {}
    return {
      onOpen(_evt, ws) {
        const sink: TraceSink = { send: (data) => ws.send(data) }
        unsubscribe =
          queryId === undefined
            ? forwardTrace((handler) => engine.on(handler), sink)
            : forwardTraceReplay(
                (handler) => engine.on(handler),
                (qid) => engine.replay(qid),
                queryId,
                sink,
              )
      },
      onClose() {
        unsubscribe()
      },
    }
  })
}
