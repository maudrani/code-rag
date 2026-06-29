import type { Unsubscribe } from '../contracts/engine.js'
import type { EmitFn, Event } from '../contracts/events.js'

export interface Bus {
  /** stamp ts + deliver to all current subscribers. */
  emit: EmitFn
  /** subscribe; returns an idempotent Unsubscribe. */
  on(handler: (event: Event) => void): Unsubscribe
}

export interface BusOptions {
  /** clock for the ts stamp — injectable for deterministic tests. Default: Date.now. */
  now?: () => number
}

/**
 * createBus — the in-process event bus (ADR-006). Layers emit through `emit`
 * (EmitFn takes Omit<Event,'ts'>; the bus stamps ts); the HTTP /ws/trace route
 * subscribes via `on`. Synchronous, ordered, multi-subscriber, zero deps.
 *
 * D3: emit iterates a SNAPSHOT of subscribers, so a handler that unsubscribes
 *     mid-emit cannot corrupt iteration (re-entrancy safe).
 * D5: subscriber errors are NOT swallowed — M1 is single-consumer and the WS
 *     handler (TKT-406) must be defensive. Revisit isolation at multi-consumer (M2).
 */
export function createBus(options: BusOptions = {}): Bus {
  const now = options.now ?? Date.now
  const handlers = new Set<(event: Event) => void>()

  const emit: EmitFn = (event) => {
    const stamped: Event = { ...event, ts: now() }
    for (const handler of [...handlers]) handler(stamped)
  }

  return {
    emit,
    on(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }
}
