import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { type CloneDeps, isRepoUrl, resolveCorpus } from '../../consume/index.js'
import type { Engine, IngestReport } from '../../contracts/engine.js'

interface IngestRequest {
  url?: unknown
}

/**
 * POST /ingest {url} (FTR-5 P4) — the interactive web ingest. Validate a git repo URL, clone it
 * (resolveCorpus, TKT-444), reindex the single engine (engine.reindex, TKT-008), and report the ACTIVE
 * corpus. On a bad URL / clone / reindex failure → a typed 4xx and the CURRENT corpus is left UNCHANGED
 * (the membrane keeps the old index on a failed rebuild — GAP-P4-E; the endpoint simply returns the error).
 *
 * The cloner is injected (DI) so tests use a fake (deterministic, no network); prod uses the real shallow
 * clone. M1 is synchronous + public-repo (a spinner client-side); SSE progress + private-token-over-web +
 * auth/rate-limit are documented productionize follow-ups.
 */
export function ingestRoutes(engine: Engine, deps: { clone?: CloneDeps['clone'] } = {}): Hono {
  const app = new Hono()

  app.post('/ingest', async (c) => {
    const body = await c.req.json<IngestRequest>().catch(() => ({}) as IngestRequest)
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    // Must be a git repo URL: an HTTP client must NOT be able to make the server index an arbitrary
    // LOCAL path. isRepoUrl rejects local paths; resolveCorpus re-validates safety (metachars/ext::).
    if (url === '' || !isRepoUrl(url)) {
      throw new HTTPException(400, {
        message: 'url must be a git repo URL (https/http/git/ssh or git@host:path)',
      })
    }

    let dir: string
    try {
      dir = await resolveCorpus(url, deps.clone !== undefined ? { clone: deps.clone } : {})
    } catch (err) {
      // resolveCorpus already redacts any credential in its message; a bad/unsafe URL or a clone
      // failure is a client-visible 400 — nothing was reindexed, so the corpus is unchanged.
      throw new HTTPException(400, {
        message: `clone failed: ${err instanceof Error ? err.message : 'invalid repo URL'}`,
      })
    }

    let ingestReport: IngestReport
    try {
      // The membrane keeps the OLD corpus if this throws (no empty-index window) — GAP-P4-E.
      ingestReport = await engine.reindex(dir)
    } catch (err) {
      throw new HTTPException(502, {
        message: `reindex failed (active corpus unchanged): ${err instanceof Error ? err.message : 'error'}`,
      })
    }

    // activeCorpus = the human identity (the URL the client asked for). M1 public-repo → no token here,
    // so nothing sensitive is echoed. The IngestReport tells the client what got indexed.
    return c.json({ activeCorpus: { url }, ingestReport })
  })

  return app
}
