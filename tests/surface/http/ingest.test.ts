import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildEngine } from '../../../src/consume/index.js'
import type { Engine } from '../../../src/contracts/engine.js'
import { ingestRoutes } from '../../../src/http/routes/ingest.js'
import { searchRoutes } from '../../../src/http/routes/search.js'

// POST /ingest: clone (fake, deterministic) → engine.reindex (REAL, tree-sitter only; no ONNX under
// VITEST, no key) → report the active corpus. Uses a REAL engine so the swap is observable end-to-end
// (a mock reindex is a no-op and could not prove ingest-then-search). Injection-safety reuses TKT-444.

const FIXTURE_CORPUS = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'cli',
  'fixtures',
  'corpus',
)
// a fake cloner that copies the fixture repo into dest — no network, deterministic.
const cloneFixture = async (_url: string, dest: string): Promise<void> => {
  cpSync(FIXTURE_CORPUS, dest, { recursive: true })
}

function appWith(engine: Engine, clone?: (url: string, dest: string) => Promise<void>): Hono {
  const app = new Hono()
  app.route('/', ingestRoutes(engine, clone !== undefined ? { clone } : {}))
  app.route('/', searchRoutes(engine))
  return app
}
async function post(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
async function searchHits(app: Hono, query: string): Promise<number> {
  const res = await post(app, '/search', { query })
  return ((await res.json()) as { results: unknown[] }).results.length
}

let emptyDir: string
beforeEach(() => {
  emptyDir = mkdtempSync(join(tmpdir(), 'ingest-empty-'))
})
afterEach(() => {
  rmSync(emptyDir, { recursive: true, force: true })
})

describe('POST /ingest — clone + reindex + report the active corpus (TKT-446)', () => {
  it('ingests a repo (fake clone → fixture) → 200 {activeCorpus, ingestReport}; a follow-up /search finds its symbol', async () => {
    const engine = buildEngine({ corpusPath: emptyDir }) // start EMPTY → `greet` is not yet searchable
    const app = appWith(engine, cloneFixture)

    const res = await post(app, '/ingest', { url: 'https://github.com/acme/fixture.git' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      activeCorpus: { url: string }
      ingestReport: { chunks: number; filesIndexed: number }
    }
    expect(body.activeCorpus.url).toBe('https://github.com/acme/fixture.git')
    expect(body.ingestReport.chunks).toBeGreaterThan(0) // the REAL reindex indexed the cloned fixture

    expect(await searchHits(app, 'greet')).toBeGreaterThan(0) // the ingested repo's symbol is searchable
  }, 30000)

  it('NEGATIVE: a bad URL → 400 and the ACTIVE corpus is UNCHANGED (GAP-P4-E)', async () => {
    const engine = buildEngine({ corpusPath: FIXTURE_CORPUS }) // start over the fixture (greet indexed)
    const app = appWith(engine, cloneFixture)
    expect(await searchHits(app, 'greet')).toBeGreaterThan(0) // the old corpus

    const res = await post(app, '/ingest', { url: 'not-a-url' })
    expect(res.status).toBe(400)

    expect(await searchHits(app, 'greet')).toBeGreaterThan(0) // still the OLD corpus — reindex never ran
  }, 30000)

  it('NEGATIVE: a URL with shell metacharacters → 400 (reuses TKT-444 validation; never reaches a shell)', async () => {
    const engine = buildEngine({ corpusPath: emptyDir })
    const app = appWith(engine, cloneFixture)
    const res = await post(app, '/ingest', { url: 'https://github.com/a/b;rm -rf /' })
    expect(res.status).toBe(400)
  }, 30000)

  it('NEGATIVE: a local path (not a git URL) is rejected — an HTTP client cannot index a server path', async () => {
    const engine = buildEngine({ corpusPath: emptyDir })
    const app = appWith(engine, cloneFixture)
    expect((await post(app, '/ingest', { url: '/etc' })).status).toBe(400)
    expect((await post(app, '/ingest', {})).status).toBe(400) // missing url
  }, 30000)

  it('the response echoes NO credential (activeCorpus is just the clean url — no token userinfo)', async () => {
    const engine = buildEngine({ corpusPath: emptyDir })
    const app = appWith(engine, cloneFixture)
    const text = await (
      await post(app, '/ingest', { url: 'https://github.com/acme/fixture.git' })
    ).text()
    expect(text).not.toMatch(/\/\/[^/\s"]+@/) // no `//userinfo@` (a token) anywhere in the response
  }, 30000)
})
