import { describe, expect, it } from 'vitest'
import { getHealth, getLogPayload, getStats } from '../../../src/consume/index.js'
import { buildApp } from '../../../src/http/app.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'

/** app.request returns Response | Promise<Response>; normalize to a Promise. */
async function req(path: string, init?: RequestInit): Promise<Response> {
  const { app } = buildApp(makeMockEngine())
  return app.request(path, init)
}

// reference values from the same deterministic SSOT the CLI + MCP use
const ref = makeMockEngine()

describe('HTTP telemetry routes — GET /stats,/health,/log (TKT-420)', () => {
  it('GET /stats → 200 + the full snapshot (= getStats(engine))', async () => {
    const res = await req('/stats')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(getStats(ref))
  })

  it('GET /stats?layer=index → 200 + { layer, data } (= getStats(engine,"index"))', async () => {
    const res = await req('/stats?layer=index')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(getStats(ref, 'index'))
  })

  it('FAIL: GET /stats?layer=bogus → 400 JSON error (not 500, not a crash)', async () => {
    const res = await req('/stats?layer=bogus')
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toHaveProperty('error')
  })

  it('GET /health → 200 + the HealthReport (= getHealth(engine)) when not down', async () => {
    const res = await req('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(getHealth(ref))
  })

  it('GET /health → 503 when status is "down" (the readiness contract)', async () => {
    const { app } = buildApp(
      makeMockEngine({ health: { status: 'down', checks: { indexed: { ok: false } }, ts: 1 } }),
    )
    const res = await app.request('/health')
    expect(res.status).toBe(503)
    expect(((await res.json()) as { status: string }).status).toBe('down')
  })

  it('GET /log → 200 + { entries } (= getLogPayload(engine))', async () => {
    const res = await req('/log')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(getLogPayload(ref))
  })

  it('GET /log?consumer=mcp → filtered ledger', async () => {
    const res = await req('/log?consumer=mcp')
    expect(await res.json()).toEqual(getLogPayload(ref, { consumer: 'mcp' }))
  })

  it('FAIL: GET /log?consumer=bogus → 400; GET /log?limit=0 → 400', async () => {
    expect((await req('/log?consumer=bogus')).status).toBe(400)
    expect((await req('/log?limit=0')).status).toBe(400)
  })
})

describe('HTTP telemetry — cross-origin (the boundary the CORS bug taught us)', () => {
  const ORIGIN = 'http://localhost:5173'

  it('GET /stats carries Access-Control-Allow-Origin for the browser', async () => {
    const res = await req('/stats', { headers: { Origin: ORIGIN } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).not.toBeNull()
  })

  it('GET /health + /log carry ACAO cross-origin', async () => {
    const health = await req('/health', { headers: { Origin: ORIGIN } })
    expect(health.headers.get('access-control-allow-origin')).not.toBeNull()
    const log = await req('/log', { headers: { Origin: ORIGIN } })
    expect(log.headers.get('access-control-allow-origin')).not.toBeNull()
  })

  it('a 400 error response STILL carries ACAO (the browser must read the error)', async () => {
    const res = await req('/stats?layer=bogus', { headers: { Origin: ORIGIN } })
    expect(res.status).toBe(400)
    expect(res.headers.get('access-control-allow-origin')).not.toBeNull()
  })
})
