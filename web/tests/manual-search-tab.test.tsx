import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualSearchTab } from '../src/components/ManualSearchTab'
import { ANSWER_TEXT, answerProjection } from '../src/mocks/fixtures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ManualSearchTab', () => {
  it('runs a search: renders decision badge + ranked results (RRF + per-leg), NO streamed answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => answerProjection }),
    )
    const user = userEvent.setup()
    render(<ManualSearchTab />)

    await user.type(screen.getByRole('textbox', { name: /search query/i }), 'membrane')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(screen.getByText('answer')).toBeInTheDocument())
    // answerProjection has 2 ranked results — each renders an RRF + per-leg row.
    expect(screen.getAllByText(/RRF/).length).toBe(answerProjection.results.length)
    expect(screen.getAllByText(/bm25/).length).toBe(answerProjection.results.length)
    // deterministic path — there is NO streamed answer bubble in manual search
    expect(screen.queryByText(ANSWER_TEXT)).not.toBeInTheDocument()
  })

  it('shows a distinct empty state before any search', () => {
    render(<ManualSearchTab />)
    expect(screen.getByText(/run a search/i)).toBeInTheDocument()
  })
})
