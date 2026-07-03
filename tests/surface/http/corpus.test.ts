import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { buildEngine } from '../../../src/consume/index.js'
import type { Engine } from '../../../src/contracts/engine.js'
import type { Observable } from '../../../src/contracts/telemetry.js'
import { buildApp } from '../../../src/http/app.js'
import { type CorpusHolder, corpusRoutes } from '../../../src/http/routes/corpus.js'
import { ingestRoutes } from '../../../src/http/routes/ingest.js'

// GET /corpus is the identity the web reads on load so its active-corpus chip reflects the REAL server
// corpus (not just this browser's own ingest). These lock the two ways it stays truthful: seeded from the
// shared pointer at startup, and updated by a successful POST /ingest.

const FIXTURE_CORPUS = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'cli',
  'fixtures',
  'corpus',
)
const cloneFixture = async (_url: string, dest: string): Promise<void> => {
  cpSync(FIXTURE_CORPUS, dest, { recursive: true })
}

async function corpusUrl(app: Hono): Promise<string | null> {
  const res = await app.request('/corpus')
  expect(res.status).toBe(200)
  return ((await res.json()) as { url: string | null }).url
}

describe('GET /corpus — the server active-corpus identity the web chip reads on load', () => {
  it('defaults to null (the self-indexed corpus) when no repo pointer seeded the server', async () => {
    const engine = buildEngine({ corpusPath: FIXTURE_CORPUS }) as Engine & Observable
    const { app } = buildApp(engine)
    expect(await corpusUrl(app)).toBeNull()
  })

  it('reflects the initial corpus url passed at startup (seeded from the shared CODE_RAG_STATE pointer)', async () => {
    const engine = buildEngine({ corpusPath: FIXTURE_CORPUS }) as Engine & Observable
    const { app } = buildApp(engine, undefined, 'https://github.com/sindresorhus/ky')
    expect(await corpusUrl(app)).toBe('https://github.com/sindresorhus/ky')
  })

  it('a successful POST /ingest updates the identity GET /corpus reports (the chip stays truthful)', async () => {
    // Compose the exact production wiring (shared holder between /ingest and /corpus) with a FAKE cloner
    // so there is no network — buildApp uses the real cloner, so this is the one seam we assemble by hand.
    const engine = buildEngine({ corpusPath: FIXTURE_CORPUS }) as Engine
    const corpus: CorpusHolder = { url: null }
    const app = new Hono()
    app.route('/', ingestRoutes(engine, { clone: cloneFixture }, corpus))
    app.route('/', corpusRoutes(corpus))

    expect(await corpusUrl(app)).toBeNull() // before: default self-indexed

    const res = await app.request('/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/acme/fixture.git' }),
    })
    expect(res.status).toBe(200)

    expect(await corpusUrl(app)).toBe('https://github.com/acme/fixture.git') // after: the ingested repo
  }, 30000)

  it('a FAILED POST /ingest (bad url) leaves the identity UNCHANGED (no half-swap of the chip)', async () => {
    const engine = buildEngine({ corpusPath: FIXTURE_CORPUS }) as Engine
    const corpus: CorpusHolder = { url: 'https://github.com/sindresorhus/ky' } // a repo is already active
    const app = new Hono()
    app.route('/', ingestRoutes(engine, { clone: cloneFixture }, corpus))
    app.route('/', corpusRoutes(corpus))

    const res = await app.request('/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' }),
    })
    expect(res.status).toBe(400)
    expect(await corpusUrl(app)).toBe('https://github.com/sindresorhus/ky') // unchanged — still the old repo
  })
})
