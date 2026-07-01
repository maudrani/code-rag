/**
 * Ledger SSE client for GET /ledger/stream (observability design §5.4) — the CROSS-CONSUMER feed.
 * Every consumer (web/http/cli/mcp/package) appends to one shared JSONL ledger; surface streams it
 * as SSE so the browser sees queries from EVERY consumer live (run the CLI or an MCP agent → its
 * query appears here). web ⊥ Node: consumes the wire only.
 *
 * The server emits a NAMED `entry` event (src/http/routes/ledger.ts: `writeSSE({event:'entry',…})`),
 * NOT the default `message` — so we addEventListener('entry'), never rely on onmessage. The
 * EventSource is injected via a factory so the parse/dedup/status logic is deterministically testable
 * (mirrors traceSocket's DI). Native EventSource handles reconnect; we only reflect its readyState:
 * a fatal (404/non-2xx → CLOSED) shows 'closed' (graceful, no infinite spinner), a transient drop
 * (still CONNECTING) shows 'reconnecting'.
 */
import type { QueryLogEntry } from '../contract'

/** The slice of the EventSource API the client depends on (keeps DI + tests simple). */
export interface MinimalEventSource {
  onopen: (() => void) | null
  onerror: (() => void) | null
  addEventListener(type: string, listener: (ev: { data: string }) => void): void
  close(): void
  readonly readyState: number
}

export type EventSourceFactory = (url: string) => MinimalEventSource
export type LedgerStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface LedgerStreamOptions {
  createEventSource?: EventSourceFactory
}

export interface LedgerStreamHandle {
  close(): void
}

/** EventSource.CLOSED — a fatal (non-2xx / wrong content-type); the browser will NOT reconnect. */
const READY_STATE_CLOSED = 2

function defaultFactory(url: string): MinimalEventSource {
  return new EventSource(url) as unknown as MinimalEventSource
}

export function openLedgerStream(
  url: string,
  onEntry: (entry: QueryLogEntry) => void,
  onStatus?: (status: LedgerStatus) => void,
  options: LedgerStreamOptions = {},
): LedgerStreamHandle {
  const create = options.createEventSource ?? defaultFactory
  const setStatus = (status: LedgerStatus): void => onStatus?.(status)

  setStatus('connecting')
  let es: MinimalEventSource
  try {
    es = create(url)
  } catch {
    setStatus('closed') // no EventSource in this env / invalid URL — give up quietly (graceful)
    return { close() {} }
  }

  es.onopen = () => setStatus('open')

  es.addEventListener('entry', (ev) => {
    const raw = typeof ev.data === 'string' ? ev.data : ''
    if (!raw) {
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return // skip a malformed frame; keep the stream open
    }
    const entry = parsed as QueryLogEntry
    if (entry && typeof entry.queryId === 'string') {
      onEntry(entry)
    }
  })

  es.onerror = () => {
    // CLOSED = fatal (404 / wrong content-type) → unavailable; otherwise the browser is reconnecting.
    setStatus(es.readyState === READY_STATE_CLOSED ? 'closed' : 'reconnecting')
  }

  let manualClosed = false
  return {
    close() {
      if (manualClosed) {
        return
      }
      manualClosed = true
      es.close()
      setStatus('closed')
    },
  }
}
