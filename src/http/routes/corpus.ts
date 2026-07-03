import { Hono } from 'hono'

/** A mutable holder for the server's active-corpus identity. `url` = the repo the server is serving
 *  right now, or null when it is on the default self-indexed corpus (no repo ingested). */
export interface CorpusHolder {
  url: string | null
}

/**
 * GET /corpus — the repo URL the SERVER is serving right now (null = default self-indexed corpus).
 *
 * The web reads this ON LOAD so the active-corpus chip reflects the REAL server corpus, not just what
 * this browser happened to ingest. Without it the chip is browser-local: a repo ingested from the CLI,
 * the MCP, or a prior/other browser session leaves the chip stuck on "self-indexed" while chat/search
 * already answer over that repo — the split-brain that made the corpus feel incoherent. The holder is
 * updated by POST /ingest and initialised at startup from the shared CODE_RAG_STATE pointer, so this is
 * the single source of truth every consumer can read.
 */
export function corpusRoutes(corpus: CorpusHolder): Hono {
  const app = new Hono()
  app.get('/corpus', (c) => c.json({ url: corpus.url }))
  return app
}
