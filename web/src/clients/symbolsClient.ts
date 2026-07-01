/**
 * Symbols client for GET /symbols (TKT-517 escalation) — a read-only projection of the index the
 * retriever already holds: for every chunk, its {path, symbol, kind, lang, span}. No LLM, no cost.
 * Powers the assisted-search corpus browser + symbol autocomplete (web ⊥ Node — wire only, ADR-008).
 *
 * Endpoint status: PROPOSED, not landed on the real surface yet. In dev the mock serves it; on a
 * real surface that lacks it, `fetchSymbols` throws (404) and the assist degrades gracefully (the
 * caller shows "explorer unavailable" and the deterministic search still works). When surface+master
 * land GET /symbols, the SAME call lights up with zero change — see web/src/contract.ts swap note.
 */
import type { SymbolsPayload } from '../contract'

const JSON_HEADERS = { Accept: 'application/json' }

/** GET /symbols — the corpus symbol index. Throws on !ok; coerces a missing list to [] (defensive). */
export async function fetchSymbols(baseUrl = ''): Promise<SymbolsPayload> {
  const res = await fetch(`${baseUrl}/symbols`, { headers: JSON_HEADERS })
  if (!res.ok) {
    throw new Error(`/symbols failed: ${res.status}`)
  }
  const payload = (await res.json()) as Partial<SymbolsPayload> | null
  return { symbols: payload?.symbols ?? [] }
}
