import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueryLogEntry } from '../contract'
import { clearLedger } from './ledgerClient'
import { type LedgerStatus, type LedgerStreamOptions, openLedgerStream } from './ledgerStream'

/** Cap the live feed so a long-running session never grows the DOM unbounded (newest kept). */
const MAX_ENTRIES = 100

export interface UseLedgerStreamResult {
  /** newest-first, upserted by queryId (a re-emit upgrades its row in place), capped at MAX_ENTRIES. */
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
 * entries prepend (they animate in at the top). UPSERT by queryId: the server re-emits a query's
 * entry enriched when its L5 outcome lands, and a reconnect re-replays the last N entries — so a
 * repeat queryId REPLACES its row in place (upgrades it, never doubles it). SSR/jsdom-safe: with no EventSource
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
        setEntries((prev) => {
          // UPSERT by queryId (NOT dedup-by-ignore). The server re-emits a query's entry ENRICHED once
          // the L5 outcome lands (answered/tier/tokens/estCost) — so an existing row must UPGRADE in
          // place from 'deterministic' to the real model badge live. Ignoring the re-emit left the row
          // stuck 'deterministic' until a refresh (the bug); replacing in place also keeps the reconnect
          // replay from doubling entries (the original dedup's job) and preserves the row's position.
          const idx = prev.findIndex((e) => e.queryId === entry.queryId)
          if (idx === -1) return [entry, ...prev].slice(0, MAX_ENTRIES)
          const next = prev.slice()
          next[idx] = entry
          return next
        }),
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
