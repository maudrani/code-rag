import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualSearchTab } from '../src/components/ManualSearchTab'
import { ANSWER_TEXT, answerProjection } from '../src/mocks/fixtures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/**
 * Route both the on-mount corpus fetch (GET /symbols) and the search (POST /search). The corpus is
 * stubbed empty here so these tests stay focused on the deterministic-search behavior; the assisted
 * flow has its own suite (manual-search-assisted.test.tsx).
 */
function stubFetch(searchBody: unknown, symbolsBody: unknown = { symbols: [] }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => (String(url).includes('/symbols') ? symbolsBody : searchBody),
      } as unknown as Response),
    ),
  )
}

describe('ManualSearchTab', () => {
  it('runs a search: renders decision badge + ranked results (RRF + per-leg), NO streamed answer', async () => {
    stubFetch(answerProjection)
    const user = userEvent.setup()
    render(<ManualSearchTab />)
    // let the corpus assist settle (empty) before driving the deterministic search
    await screen.findByText(/no symbols indexed yet/i)

    await user.type(screen.getByRole('textbox', { name: /search query/i }), 'membrane')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(screen.getByText('answer')).toBeInTheDocument())
    // answerProjection has 2 ranked results — each renders an RRF + per-leg row.
    expect(screen.getAllByText(/RRF/).length).toBe(answerProjection.results.length)
    expect(screen.getAllByText(/bm25/).length).toBe(answerProjection.results.length)
    // deterministic path — there is NO streamed answer bubble in manual search
    expect(screen.queryByText(ANSWER_TEXT)).not.toBeInTheDocument()
  })

  it('shows a distinct empty state before any search', async () => {
    stubFetch(answerProjection)
    render(<ManualSearchTab />)
    await screen.findByText(/no symbols indexed yet/i)
    expect(screen.getByText(/run a search/i)).toBeInTheDocument()
  })
})
