import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { WireProjection } from '../../../src/contracts/wire.js'
import { buildApp } from '../../../src/http/app.js'
import { searchRoutes } from '../../../src/http/routes/search.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'

// The standalone web UI runs on the Vite dev server — a DIFFERENT origin. This is
// the real browser consumer (ADR-008) that the in-process app.request tests missed.
const ORIGIN = 'http://localhost:5173'

async function appRequest(path: string, init: RequestInit): Promise<Response> {
  return buildApp(makeMockEngine()).app.request(path, init)
}

function sseEvents(raw: string): string[] {
  return raw
    .split('\n\n')
    .filter((block) => block.trim())
    .map(
      (block) =>
        block
          .split('\n')
          .find((l) => l.startsWith('event:'))
          ?.slice(6)
          .trim() ?? '',
    )
}

describe('CORS — TKT-415 (the browser consumer, cross-origin)', () => {
  it('POST /search with an Origin -> Access-Control-Allow-Origin present', async () => {
    const res = await appRequest('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ query: 'where is foo?' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
  })

  it('POST /query (SSE) with an Origin -> Access-Control-Allow-Origin present', async () => {
    const res = await appRequest('/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ question: 'where is foo?', history: [] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
  })

  it('preflight OPTIONS /search is NOT 404 (204 + allow-methods)', async () => {
    const res = await appRequest('/search', {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    })
    expect(res.status).not.toBe(404)
    expect(res.headers.get('access-control-allow-methods')).toBeTruthy()
  })

  it('preflight OPTIONS /query is NOT 404 (+ allow-origin)', async () => {
    const res = await appRequest('/query', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    })
    expect(res.status).not.toBe(404)
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
  })

  it('NON-VACUITY: a bare app WITHOUT cors() serves the route but has NO Access-Control-Allow-Origin', async () => {
    const bare = new Hono()
    bare.route('/', searchRoutes(makeMockEngine()))
    const res = await bare.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ query: 'q' }),
    })
    expect(res.status).toBe(200) // the route works...
    expect(res.headers.get('access-control-allow-origin')).toBeNull() // ...but no CORS header
  })

  it('INTEGRATION: cross-origin search returns a WireProjection + ACAO', async () => {
    const res = await appRequest('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ query: 'where is foo?' }),
    })
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
    const wire = (await res.json()) as WireProjection
    expect(wire.queryId).toBeTruthy()
    expect(wire.decision.band).toBe('answer')
  })

  it('INTEGRATION: cross-origin SSE chat streams meta -> token -> done + ACAO', async () => {
    const res = await appRequest('/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ question: 'where is foo?', history: [] }),
    })
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
    const events = sseEvents(await res.text())
    expect(events[0]).toBe('meta')
    expect(events).toContain('token')
    expect(events.at(-1)).toBe('done')
  })

  it('error-envelope cross-origin: a thrown route error keeps ACAO (the browser can read the error)', async () => {
    const { app } = buildApp(makeMockEngine())
    app.get('/__boom', () => {
      throw new Error('kaboom')
    })
    const res = await app.request('/__boom', { headers: { origin: ORIGIN } })
    expect(res.status).toBe(500)
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
    expect((await res.json()) as { error: string }).toEqual({ error: 'Internal Server Error' })
  })
})
