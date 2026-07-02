import { afterEach, describe, expect, it, vi } from 'vitest'
import { ingest } from '../src/clients/ingestClient'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const OK_RESPONSE = {
  activeCorpus: { url: 'https://github.com/foo/bar.git' },
  ingestReport: { filesIndexed: 12, chunks: 72, durationMs: 850 },
}

describe('ingestClient — POST /ingest (FTR-5 P4, TKT-533)', () => {
  it('POSTs /ingest with {url} and returns the {activeCorpus, ingestReport} envelope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => OK_RESPONSE })
    vi.stubGlobal('fetch', fetchMock)

    const res = await ingest('https://github.com/foo/bar.git', 'http://api')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe('http://api/ingest')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://github.com/foo/bar.git' })
    expect(res.activeCorpus.url).toBe('https://github.com/foo/bar.git')
    expect(res.ingestReport.filesIndexed).toBe(12)
  })

  it('stamps the browser as the `web` consumer via the X-Consumer header (ledger attribution)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => OK_RESPONSE })
    vi.stubGlobal('fetch', fetchMock)

    await ingest('https://github.com/foo/bar')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['X-Consumer']).toBe('web')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('surfaces the server {error} message on a 4xx (bad URL / clone failed)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'url must be a git repo URL (https/http/git/ssh or git@host:path)',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(ingest('/etc/passwd')).rejects.toThrow(/git repo url/i)
  })

  it('falls back to a status message when the error body is not the {error} envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(ingest('https://github.com/foo/bar')).rejects.toThrow(/502/)
  })
})
