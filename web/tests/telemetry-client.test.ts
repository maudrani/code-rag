import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHealth, fetchStats } from '../src/clients/telemetryClient'
import type { HealthReport } from '../src/contract'
import { healthFixture, statsFixture } from '../src/mocks/fixtures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stubFetch(impl: (url: string) => Promise<Response> | Response) {
  const spy = vi.fn((url: unknown) => impl(String(url)))
  vi.stubGlobal('fetch', spy)
  return spy
}

const okJson = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

describe('telemetryClient — GET /stats', () => {
  it('requests /stats on the base URL and returns the parsed EngineTelemetry', async () => {
    const spy = stubFetch(() => okJson(statsFixture))
    const result = await fetchStats('http://api.test')
    expect(spy.mock.calls[0]?.[0]).toBe('http://api.test/stats')
    expect(result.index?.docs).toBe(642)
    expect(result.lastQuery?.retrieve.scoresByLeg.dense).toBe(0.0231)
  })

  it('throws when /stats returns a non-ok status (failure twin)', async () => {
    stubFetch(() => okJson({ error: 'boom' }, 500))
    await expect(fetchStats()).rejects.toThrow(/500/)
  })
})

describe('telemetryClient — GET /health', () => {
  it('returns the parsed HealthReport on 200', async () => {
    stubFetch(() => okJson(healthFixture))
    const report = await fetchHealth()
    expect(report.status).toBe('ok')
    expect(report.checks.indexed?.ok).toBe(true)
  })

  // The demonstrate-deterministically boundary: `down` arrives as a 503 with a VALID body. A client
  // that threw on !ok would blank the health card exactly when it matters — so this MUST return data.
  it('returns the down report on 503 (down is data, not a transport error)', async () => {
    const down: HealthReport = {
      status: 'down',
      checks: { indexed: { ok: false, detail: 'no index' } },
      ts: 1_719_792_042_000,
    }
    stubFetch(() => okJson(down, 503))
    const report = await fetchHealth()
    expect(report.status).toBe('down')
    expect(report.checks.indexed?.ok).toBe(false)
  })

  it('propagates a genuine transport failure (network error)', async () => {
    stubFetch(() => Promise.reject(new Error('network down')))
    await expect(fetchHealth()).rejects.toThrow(/network down/)
  })
})
