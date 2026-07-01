import { useCallback, useEffect, useRef, useState } from 'react'

export interface PollState<T> {
  /** the most recent successful value; null until the first success. */
  data: T | null
  /** the most recent error; cleared on the next success. */
  error: Error | null
  /** true only on first paint (no data AND no error yet) — never re-raised on a background poll. */
  loading: boolean
  /** force an immediate re-fetch (also used by an error-state Retry). */
  refetch: () => void
}

/**
 * usePoll — a generic live-refresh hook. Fetches on mount, then every `intervalMs`.
 *
 * RESILIENT BY DESIGN: a poll failure KEEPS the last-good `data` (a live dashboard that blanks on
 * one dropped poll is worse than useless) and surfaces `error`; `loading` is first-paint only. Only
 * a first-load failure leaves `data` null so the caller can show an explicit error + Retry. The
 * fetcher is read through a ref so passing a fresh closure each render does NOT reset the interval —
 * only `intervalMs` does. setState is guarded past unmount (no act()/leak warnings in tests).
 */
export function usePoll<T>(fetcher: () => Promise<T>, intervalMs = 5000): PollState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const mountedRef = useRef(true)

  const run = useCallback(async () => {
    try {
      const next = await fetcherRef.current()
      if (!mountedRef.current) {
        return
      }
      setData(next)
      setError(null)
    } catch (err) {
      if (!mountedRef.current) {
        return
      }
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void run()
    const id = setInterval(() => {
      void run()
    }, intervalMs)
    return () => {
      mountedRef.current = false
      clearInterval(id)
    }
  }, [run, intervalMs])

  return { data, error, loading, refetch: run }
}
