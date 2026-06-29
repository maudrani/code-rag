import { afterEach, describe, expect, it, vi } from 'vitest'
import { search } from '../src/clients/searchClient'
import { answerProjection } from '../src/mocks/fixtures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('searchClient — deterministic, no answer', () => {
  it('POSTs /search and returns a WireProjection (results + decision, no answer field)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => answerProjection,
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await search('how does the membrane work')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/search')
    expect(init.method).toBe('POST')
    expect(res.decision).toBeDefined()
    expect(res.results.length).toBeGreaterThan(0)
    expect('answer' in res).toBe(false)
  })

  it('empty / whitespace query returns an empty projection WITHOUT fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await search('   ')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.results).toEqual([])
    expect(res.citations).toEqual([])
    expect(res.decision.band).toBe('refuse')
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(search('q')).rejects.toThrow()
  })
})
