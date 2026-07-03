/**
 * Corpus client for GET /corpus — the repo URL the SERVER is serving right now (null = default
 * self-indexed). The header reads this on load so the active-corpus chip reflects the REAL server
 * corpus, not just what this browser ingested — the single source of truth across web/CLI/MCP.
 *
 * Best-effort: a failed or unreachable call resolves to `{ url: null }` (the chip falls back to
 * "self-indexed"); reading the identity must never break the header render.
 */

import type { CorpusResponse } from '../contract'

export async function fetchActiveCorpus(baseUrl = ''): Promise<CorpusResponse> {
  try {
    const res = await fetch(`${baseUrl}/corpus`)
    if (!res.ok) return { url: null }
    const body = (await res.json()) as { url?: unknown }
    return { url: typeof body.url === 'string' ? body.url : null }
  } catch {
    return { url: null }
  }
}
