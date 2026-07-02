/**
 * Search client for POST /search (ADR-008) — the deterministic path: results + citations
 * + decision, NO answer, NO cost. An empty/whitespace query short-circuits to an empty
 * projection without a request.
 */

import type { SearchResponse, WireProjection } from '../contract'
import { CONSUMER_HEADER, WEB_CONSUMER } from '../lib/config'

/** A deterministic empty projection (used for an empty query — no grounding, refuse). */
export function emptyProjection(query = ''): WireProjection {
  return {
    queryId: '',
    question: query,
    resolvedQuery: query,
    results: [],
    citations: [],
    decision: { groundingScore: 0, band: 'refuse', tier: 'cheap', model: '' },
  }
}

export async function search(query: string, baseUrl = ''): Promise<SearchResponse> {
  const trimmed = query.trim()
  if (!trimmed) {
    return emptyProjection(query)
  }
  const res = await fetch(`${baseUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [CONSUMER_HEADER]: WEB_CONSUMER },
    body: JSON.stringify({ query: trimmed }),
  })
  if (!res.ok) {
    throw new Error(`/search failed: ${res.status}`)
  }
  return (await res.json()) as SearchResponse
}
