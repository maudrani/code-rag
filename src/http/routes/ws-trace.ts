import type { NodeWebSocket } from '@hono/node-ws'
import type { MiddlewareHandler } from 'hono'
import type { Engine, Unsubscribe } from '../../contracts/engine.js'
import type { Event } from '../../contracts/events.js'

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

/**
 * GET /ws/trace — the ADR-008 trace endpoint. Bridges the engine event-bus to a
 * WebSocket via @hono/node-ws: on Node the upgrade needs this adapter (hono's
 * own `upgradeWebSocket` ships from hono/cloudflare-workers and is CF-only —
 * gap G2). Subscribe on open, unsubscribe on close. The engine + upgradeWebSocket
 * are injected so the route stays unit-testable and the prod entrypoint owns wiring.
 */
export function traceRoute(engine: Engine, upgradeWebSocket: UpgradeWebSocket): MiddlewareHandler {
  return upgradeWebSocket(() => {
    let unsubscribe: Unsubscribe = () => {}
    return {
      onOpen(_evt, ws) {
        unsubscribe = forwardTrace((handler) => engine.on(handler), {
          send: (data) => ws.send(data),
        })
      },
      onClose() {
        unsubscribe()
      },
    }
  })
}
