/**
 * Ingest client for POST /ingest (ADR-008, FTR-5 P4) — paste a git repo URL; the server clones +
 * reindexes it and returns the ACTIVE corpus + an IngestReport. Mirrors searchClient: same X-Consumer
 * header (ledger attribution). On a non-2xx the server left the PREVIOUS corpus unchanged (no
 * half-swap), so we surface its `{ error }` envelope (already credential-redacted server-side) and the
 * caller keeps showing the prior repo.
 */

import type { IngestResponse } from '../contract'
import { CONSUMER_HEADER, WEB_CONSUMER } from '../lib/config'

export async function ingest(url: string, baseUrl = ''): Promise<IngestResponse> {
  const res = await fetch(`${baseUrl}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [CONSUMER_HEADER]: WEB_CONSUMER },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    const message = await res
      .json()
      .then((body) => (body as { error?: unknown }).error)
      .catch(() => undefined)
    throw new Error(
      typeof message === 'string' && message ? message : `/ingest failed: ${res.status}`,
    )
  }
  return (await res.json()) as IngestResponse
}
