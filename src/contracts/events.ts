/** the pipeline layer that emitted an event. */
export type EventLayer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'membrane' | 'L5'

/**
 * Event — the observability event-schema (ADR-006). EVERY layer emits these.
 * `payload` carries refs + counts, NOT heavy blobs (R3) — e.g. chunk ids,
 * token-counts, scores; never the assembled context. The L5 event's payload
 * carries `{ tokens, tier, estCost }` (the cost story).
 */
export interface Event {
  /** join-key to the Projection (ADR-002) */
  queryId: string
  layer: EventLayer
  type: string
  /** refs + counts only — never the assembled blob */
  payload: unknown
  /** epoch ms */
  ts: number
}

/** what each layer is handed to emit (the bus stamps `ts`). */
export type EmitFn = (event: Omit<Event, 'ts'>) => void
