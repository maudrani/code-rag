import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchActiveCorpus } from '../src/clients/corpusClient'
import { ingest } from '../src/clients/ingestClient'
import { RepoIngestBar } from '../src/components/RepoIngestBar'
import type { IngestResponse } from '../src/contract'
import { assertWithinPane } from './_ui-verify'

vi.mock('../src/clients/ingestClient', () => ({ ingest: vi.fn() }))
vi.mock('../src/clients/corpusClient', () => ({ fetchActiveCorpus: vi.fn() }))
const ingestMock = vi.mocked(ingest)
const corpusMock = vi.mocked(fetchActiveCorpus)

beforeEach(() => {
  // default: the server reports no repo (self-indexed) so the on-mount sync is a no-op unless a test
  // opts into a server corpus. Every render mounts RepoIngestBar, which calls fetchActiveCorpus.
  corpusMock.mockResolvedValue({ url: null })
})
afterEach(() => {
  vi.clearAllMocks()
})

function report(url: string): IngestResponse {
  return { activeCorpus: { url }, ingestReport: { filesIndexed: 12, chunks: 72, durationMs: 850 } }
}

describe('RepoIngestBar — paste a git URL to index a repo (TKT-533)', () => {
  it('submits the typed URL to ingest(), disabling the input + showing a spinner while in-flight', async () => {
    // a never-resolving promise pins the component in the submitting state
    ingestMock.mockImplementation(() => new Promise<IngestResponse>(() => {}))
    const user = userEvent.setup()
    render(<RepoIngestBar baseUrl="" />)

    const input = screen.getByTestId('repo-url-input')
    await user.type(input, 'https://github.com/acme/widgets')
    await user.click(screen.getByTestId('repo-index-submit'))

    expect(ingestMock).toHaveBeenCalledWith('https://github.com/acme/widgets', '')
    expect(input).toBeDisabled()
    expect(screen.getByTestId('repo-ingest-spinner')).toBeInTheDocument()
  })

  it('on success, the active-corpus chip shows the repo and the input re-enables (chat/search now over it)', async () => {
    ingestMock.mockResolvedValue(report('https://github.com/acme/widgets.git'))
    const user = userEvent.setup()
    render(<RepoIngestBar baseUrl="" />)

    const input = screen.getByTestId('repo-url-input')
    await user.type(input, 'https://github.com/acme/widgets')
    await user.click(screen.getByTestId('repo-index-submit'))

    const chip = await screen.findByTestId('active-corpus-chip')
    expect(chip).toHaveTextContent('acme/widgets')
    expect(input).not.toBeDisabled()
    // the chip lives INSIDE the header pane (not detached) — RULE-UI-001 structural leg
    assertWithinPane(chip, 'repo-ingest-bar')
  })

  it('NEGATIVE: a 4xx shows the error AND leaves the PRIOR active-corpus chip unchanged (no context switch)', async () => {
    const user = userEvent.setup()
    render(<RepoIngestBar baseUrl="" />)
    const input = screen.getByTestId('repo-url-input')

    // first: a successful ingest sets the chip to acme/widgets
    ingestMock.mockResolvedValueOnce(report('https://github.com/acme/widgets.git'))
    await user.type(input, 'https://github.com/acme/widgets')
    await user.click(screen.getByTestId('repo-index-submit'))
    expect(await screen.findByTestId('active-corpus-chip')).toHaveTextContent('acme/widgets')

    // then: a rejected ingest (bad URL) — the server kept the previous corpus, so must the UI
    ingestMock.mockRejectedValueOnce(
      new Error('url must be a git repo URL (https/http/git/ssh or git@host:path)'),
    )
    await user.clear(input)
    await user.type(input, '/etc/passwd')
    await user.click(screen.getByTestId('repo-index-submit'))

    expect(await screen.findByTestId('repo-ingest-error')).toHaveTextContent(/git repo url/i)
    // the chip did NOT flip to the failed repo — still the previously-indexed one
    expect(screen.getByTestId('active-corpus-chip')).toHaveTextContent('acme/widgets')
  })

  it('ignores a stale in-flight response after unmount — the chip never flickers to the wrong repo (mountedRef guard)', async () => {
    let resolveIngest: ((r: IngestResponse) => void) | null = null
    ingestMock.mockImplementation(
      () =>
        new Promise<IngestResponse>((resolve) => {
          resolveIngest = resolve
        }),
    )
    const user = userEvent.setup()
    const { unmount } = render(<RepoIngestBar baseUrl="" />)

    await user.type(screen.getByTestId('repo-url-input'), 'https://github.com/acme/widgets')
    await user.click(screen.getByTestId('repo-index-submit'))
    await waitFor(() => expect(ingestMock).toHaveBeenCalled())

    // unmount BEFORE the request resolves, then let the stale response land
    unmount()
    act(() => {
      resolveIngest?.(report('https://github.com/acme/widgets.git'))
    })

    // no chip is rendered anywhere (the component is gone) and nothing threw on the late resolve
    expect(screen.queryByTestId('active-corpus-chip')).not.toBeInTheDocument()
  })

  it('on mount, SYNCS the chip to the server active corpus (GET /corpus) — reflects a CLI/MCP/other-session ingest, not just this browser', async () => {
    corpusMock.mockResolvedValue({ url: 'https://github.com/sindresorhus/ky' })
    render(<RepoIngestBar baseUrl="http://localhost:8787" />)

    // no ingest happened in THIS browser, yet the chip reflects the repo the server is serving
    const chip = await screen.findByTestId('active-corpus-chip')
    await waitFor(() => expect(chip).toHaveTextContent('sindresorhus/ky'))
    expect(corpusMock).toHaveBeenCalledWith('http://localhost:8787')
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('when the server reports no repo (url: null), the chip stays on the default self-indexed corpus', async () => {
    corpusMock.mockResolvedValue({ url: null })
    render(<RepoIngestBar baseUrl="http://localhost:8787" />)

    const chip = await screen.findByTestId('active-corpus-chip')
    await waitFor(() => expect(corpusMock).toHaveBeenCalled())
    expect(chip).toHaveTextContent('self-indexed corpus')
  })

  it('a browser ingest WINS over the on-mount server sync — the chip does not revert to the server value', async () => {
    // server is on repo A; the user ingests repo B here → chip must show B (this browser's choice)
    corpusMock.mockResolvedValue({ url: 'https://github.com/other/server-repo.git' })
    ingestMock.mockResolvedValue(report('https://github.com/acme/widgets.git'))
    const user = userEvent.setup()
    render(<RepoIngestBar baseUrl="http://localhost:8787" />)

    await user.type(screen.getByTestId('repo-url-input'), 'https://github.com/acme/widgets')
    await user.click(screen.getByTestId('repo-index-submit'))

    const chip = await screen.findByTestId('active-corpus-chip')
    await waitFor(() => expect(chip).toHaveTextContent('acme/widgets'))
    // the late/early server sync used `prev ?? …`, so it never clobbers the browser's own ingest
    expect(chip).not.toHaveTextContent('server-repo')
  })
})
