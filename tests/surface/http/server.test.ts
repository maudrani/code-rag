import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SearchResponse } from '../../../src/contracts/wire.js'
import { buildApp, resolvePort } from '../../../src/http/app.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'

describe('HTTP server bootstrap — TKT-407', () => {
  it('GET /health -> 200 + the real HealthReport from engine.health() (not the old stub)', async () => {
    const { app } = buildApp(makeMockEngine())
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; checks: Record<string, unknown> }
    expect(body.status).toBe('ok')
    // the real report carries per-check detail — proving the stub {status:'ok'} is gone.
    expect(body.checks).toBeDefined()
  })

  it('mounts POST /search (not 404) -> WireProjection', async () => {
    const { app } = buildApp(makeMockEngine())
    const res = await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'where is foo?' }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as SearchResponse).queryId).toBeTruthy()
  })

  it('mounts POST /query (not 404) -> SSE stream', async () => {
    const { app } = buildApp(makeMockEngine())
    const res = await app.request('/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'where is foo?', history: [] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('mounts GET /ws/trace (route registered)', () => {
    const { app } = buildApp(makeMockEngine())
    expect(app.routes.some((r) => r.path === '/ws/trace')).toBe(true)
  })

  it('notFound -> 404 JSON envelope', async () => {
    const { app } = buildApp(makeMockEngine())
    const res = await app.request('/no-such-route')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'Not Found' })
  })

  it('onError -> consistent JSON 500 envelope (no HTML / no stack leak)', async () => {
    const { app } = buildApp(makeMockEngine())
    app.get('/__boom', () => {
      throw new Error('kaboom internal detail')
    })
    const res = await app.request('/__boom')
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as { error: string; message?: string }
    expect(body.error).toBe('Internal Server Error')
    // the raw error message must NOT leak to the client
    expect(JSON.stringify(body)).not.toContain('kaboom internal detail')
  })

  it('onError -> a thrown HTTPException keeps its status in a JSON envelope (400)', async () => {
    const { app } = buildApp(makeMockEngine())
    const res = await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '' }),
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json()) as Record<string, unknown>).toHaveProperty('error')
  })

  it('resolvePort: defaults to 8787; parses a valid numeric env; rejects junk', () => {
    expect(resolvePort(undefined)).toBe(8787)
    expect(resolvePort('')).toBe(8787)
    expect(resolvePort('not-a-number')).toBe(8787)
    expect(resolvePort('0')).toBe(8787)
    expect(resolvePort('3000')).toBe(3000)
  })

  it('NEGATIVE: the production entrypoint (server.ts) imports no test fixtures / mock', () => {
    const src = readFileSync(new URL('../../../src/http/server.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/fixtures|mock-engine|makeMockEngine/)
  })
})
