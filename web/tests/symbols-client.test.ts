import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSymbols } from '../src/clients/symbolsClient'
import { symbolsFixture } from '../src/mocks/fixtures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stubFetch(reply: { ok?: boolean; status?: number; body: unknown }) {
  const status = reply.status ?? 200
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        ({
          ok: reply.ok ?? (status >= 200 && status < 300),
          status,
          json: async () => reply.body,
        }) as unknown as Response,
    ),
  )
}

describe('fetchSymbols', () => {
  it('returns the corpus symbol list on 200', async () => {
    stubFetch({ body: { symbols: symbolsFixture } })
    const payload = await fetchSymbols('')
    expect(payload.symbols).toHaveLength(symbolsFixture.length)
    expect(payload.symbols[0]).toMatchObject({
      path: expect.any(String),
      symbol: expect.any(String),
    })
  })

  it('throws when the endpoint is absent (404) so the caller can degrade gracefully', async () => {
    stubFetch({ status: 404, body: { error: 'not found' } })
    await expect(fetchSymbols('')).rejects.toThrow(/\/symbols failed: 404/)
  })

  it('coerces a missing symbols list to [] (defensive against a malformed payload)', async () => {
    stubFetch({ body: {} })
    const payload = await fetchSymbols('')
    expect(payload.symbols).toEqual([])
  })

  it('requests the /symbols path against the given base URL', async () => {
    stubFetch({ body: { symbols: [] } })
    await fetchSymbols('http://surface.local')
    expect(fetch).toHaveBeenCalledWith('http://surface.local/symbols', expect.anything())
  })
})
