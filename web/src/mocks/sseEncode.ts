/**
 * text/event-stream framing for the ADR-008 chat wire. Encodes QuerySseEvent[] into
 * `event: <type>\ndata: <json>\n\n` frames (+ a heartbeat constant). parseSse is the
 * inverse, used by tests for round-tripping and by the mock to stay honest.
 */
import type { QuerySseEvent } from '../contract'

/** One SSE frame: `event: <type>\ndata: <json>\n\n`. */
export function encodeFrame(event: QuerySseEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`
}

/** Serialize a full QuerySseEvent[] stream. */
export function encodeSse(events: QuerySseEvent[]): string {
  return events.map(encodeFrame).join('')
}

/** Heartbeat comment frame — ignored by spec-compliant SSE clients. */
export const HEARTBEAT_FRAME = ': ping\n\n'

export interface ParsedFrame {
  event: string
  data: unknown
}

/** Parse a text/event-stream into {event,data} frames, skipping `:` heartbeat lines. */
export function parseSse(text: string): ParsedFrame[] {
  const out: ParsedFrame[] = []
  for (const raw of text.split('\n\n')) {
    if (!raw.trim() || raw.startsWith(':')) {
      continue
    }
    let event = 'message'
    let dataStr = ''
    for (const line of raw.split('\n')) {
      if (line.startsWith('event: ')) {
        event = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        dataStr = line.slice(6)
      }
    }
    if (!dataStr) {
      continue
    }
    out.push({ event, data: JSON.parse(dataStr) })
  }
  return out
}
