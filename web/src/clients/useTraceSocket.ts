/**
 * useTraceSocket — React hook over the trace WS. Returns the current query's Events
 * (already filtered by queryId) + connection status. Resets events when the queryId
 * changes so a prior query's events never bleed into the next (M1 single-consumer).
 */
import { useEffect, useRef, useState } from 'react'
import type { Event } from '../contract'
import { openTraceSocket, type TraceSocketOptions, type TraceStatus } from './traceSocket'

export interface UseTraceSocketResult {
  events: Event[]
  status: TraceStatus
}

export interface UseTraceSocketOptions extends TraceSocketOptions {
  baseUrl?: string
}

export function useTraceSocket(
  queryId: string | null,
  options: UseTraceSocketOptions = {},
): UseTraceSocketResult {
  const [events, setEvents] = useState<Event[]>([])
  const [status, setStatus] = useState<TraceStatus>('closed')

  // Read options from a ref so a fresh options object per render does not re-open the
  // socket — only a queryId change does.
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    setEvents([]) // reset on queryId change
    if (!queryId) {
      setStatus('closed')
      return
    }
    const opts = optionsRef.current
    // SSR / jsdom safety: with no WebSocket and no injected factory there is nothing to connect to.
    if (!opts.createWebSocket && typeof WebSocket === 'undefined') {
      setStatus('closed')
      return
    }
    const url = `${opts.baseUrl ?? ''}/ws/trace`
    const socket = openTraceSocket(
      url,
      queryId,
      (event) => setEvents((prev) => [...prev, event]),
      (next) => setStatus(next),
      opts,
    )
    return () => {
      socket.close()
    }
  }, [queryId])

  return { events, status }
}
