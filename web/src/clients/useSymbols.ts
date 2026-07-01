import { useCallback, useEffect, useRef, useState } from 'react'
import type { SymbolEntry } from '../contract'
import { fetchSymbols } from './symbolsClient'

export interface SymbolsState {
  symbols: SymbolEntry[]
  loading: boolean
  error: Error | null
  retry: () => void
}

/**
 * One-shot fetch hook for the corpus symbol index (GET /symbols). Unlike usePoll, the corpus is
 * STATIC per session — fetch once on mount, expose a manual `retry` (so a transient failure isn't
 * permanent). Errors are swallowed into state (never thrown) so the assist can degrade to an
 * "unavailable" note without crashing the deterministic search around it. `mountedRef` guards every
 * setState past unmount; `retry` bumps a nonce to re-run the effect.
 */
export function useSymbols(baseUrl = ''): SymbolsState {
  const [symbols, setSymbols] = useState<SymbolEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [nonce, setNonce] = useState(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` is a manual re-fetch trigger (retry), intentionally not read in the body
  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchSymbols(baseUrl)
      .then((payload) => {
        if (mountedRef.current) {
          setSymbols(payload.symbols)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)))
        }
      })
      .finally(() => {
        if (mountedRef.current) {
          setLoading(false)
        }
      })
  }, [baseUrl, nonce])

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  return { symbols, loading, error, retry }
}
