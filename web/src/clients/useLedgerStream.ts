import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueryLogEntry } from '../contract'
import { clearLedger } from './ledgerClient'
import { type LedgerStatus, type LedgerStreamOptions, openLedgerStream } from './ledgerStream'

/** Cap the live feed so a long-running session never grows the DOM unbounded (newest kept). */
const MAX_ENTRIES = 100

export interface UseLedgerStreamResult {
  /** newest-first, deduped by queryId, capped at MAX_ENTRIES. */
  entries: QueryLogEntry[]
  status: LedgerStatus
  /** truncate the shared ledger on the server, then empty the local feed (survives a refresh). */
  clear: () => Promise<void>
}

export interface UseLedgerStreamOptions extends LedgerStreamOptions {
  baseUrl?: string
}

/**
 * useLedgerStream — subscribe to the cross-consumer ledger SSE and expose the live feed. Newest
 * entries prepend (they animate in at the top). DEDUP by queryId: a reconnect re-replays the last N
 * entries, so without dedup the feed would double every entry. SSR/jsdom-safe: with no EventSource
 * and no injected factory there is nothing to connect to → 'closed'. The factory is read from a ref so
 * a fresh options object per render does not re-open the stream — only baseUrl does.
 */
export function useLedgerStream(options: UseLedgerStreamOptions = {}): UseLedgerStreamResult {
  const [entries, setEntries] = useState<QueryLogEntry[]>([])
  const [status, setStatus] = useState<LedgerStatus>('connecting')

  const optionsRef = useRef(options)
  optionsRef.current = options
  const baseUrl = options.baseUrl ?? ''

  useEffect(() => {
    const opts = optionsRef.current
    if (!opts.createEventSource && typeof EventSource === 'undefined') {
      setStatus('closed')
      return
    }
    setEntries([])
    const handle = openLedgerStream(
      `${baseUrl}/ledger/stream`,
      (entry) =>
        setEntries((prev) =>
          prev.some((e) => e.queryId === entry.queryId)
            ? prev
            : [entry, ...prev].slice(0, MAX_ENTRIES),
        ),
      (next) => setStatus(next),
      opts,
    )
    return () => handle.close()
  }, [baseUrl])

  // Truncate the server ledger FIRST (so a refetch/refresh sees it empty), then drop the local feed.
  // Order matters: clearing local first could let an in-flight tail re-add an entry before the truncate.
  const clear = useCallback(async () => {
    try {
      await clearLedger(baseUrl)
    } catch {
      // best-effort — still clear the local view so the operator gets immediate feedback
    }
    setEntries([])
  }, [baseUrl])

  return { entries, status, clear }
}
