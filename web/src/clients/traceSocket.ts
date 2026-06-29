/**
 * Trace WS client for GET /ws/trace (ADR-008 §3). Connects, JSON-parses Event (ADR-006),
 * filters to the CURRENT queryId (M1 single-consumer, A4), and reconnects with bounded
 * backoff on an UNEXPECTED close. A manual close() never reconnects. The WebSocket is
 * injected via a factory so the reconnect/filter logic is deterministically testable.
 */
import type { Event } from '../contract'

/** The slice of the WebSocket API the client depends on (keeps DI + tests simple). */
export interface MinimalWebSocket {
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  close(): void
}

export type WebSocketFactory = (url: string) => MinimalWebSocket
export type TraceStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface TraceSocketOptions {
  createWebSocket?: WebSocketFactory
  maxRetries?: number
  backoffMs?: (attempt: number) => number
}

export interface TraceSocketHandle {
  readonly status: TraceStatus
  close(): void
}

function defaultBackoff(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 10_000)
}

function defaultFactory(url: string): MinimalWebSocket {
  return new WebSocket(url) as unknown as MinimalWebSocket
}

export function openTraceSocket(
  url: string,
  queryId: string,
  onEvent: (event: Event) => void,
  onStatus?: (status: TraceStatus) => void,
  options: TraceSocketOptions = {},
): TraceSocketHandle {
  const createWebSocket = options.createWebSocket ?? defaultFactory
  const maxRetries = options.maxRetries ?? 5
  const backoff = options.backoffMs ?? defaultBackoff

  let ws: MinimalWebSocket | null = null
  let attempt = 0
  let manualClose = false
  let status: TraceStatus = 'connecting'
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  const setStatus = (next: TraceStatus): void => {
    status = next
    onStatus?.(next)
  }

  const connect = (): void => {
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting')
    let socket: MinimalWebSocket
    try {
      socket = createWebSocket(url)
    } catch {
      setStatus('closed') // invalid URL / no WebSocket in this environment — give up quietly
      return
    }
    ws = socket

    socket.onopen = () => {
      attempt = 0
      setStatus('open')
    }
    socket.onmessage = (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : ''
      if (!raw) {
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return // skip malformed frame; keep the socket open
      }
      const event = parsed as Event
      if (event && typeof event.queryId === 'string' && event.queryId === queryId) {
        onEvent(event) // foreign queryIds are dropped here (SC-03)
      }
    }
    socket.onclose = () => {
      if (manualClose || attempt >= maxRetries) {
        setStatus('closed')
        return
      }
      const delay = backoff(attempt)
      attempt += 1
      setStatus('reconnecting')
      reconnectTimer = setTimeout(connect, delay)
    }
    socket.onerror = () => {
      // onclose drives reconnection; nothing to do here.
    }
  }

  connect()

  return {
    get status() {
      return status
    },
    close() {
      manualClose = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      ws?.close()
      setStatus('closed')
    },
  }
}
