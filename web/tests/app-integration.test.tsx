import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { ANSWER_TEXT, answerProjection } from '../src/mocks/fixtures'
import { encodeSse } from '../src/mocks/sseEncode'
import { makeQueryStream } from '../src/mocks/wireMock'
import { streamFromString } from './sse-test-utils'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('App integration (whole UI against the mock wire)', () => {
  it('drives a full chat query: streamed answer + decision badge + clickable citation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        body: streamFromString(
          encodeSse(makeQueryStream(answerProjection, { answer: ANSWER_TEXT })),
          16,
        ),
      })),
    )
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'how does the membrane work')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.getByText(ANSWER_TEXT)).toBeInTheDocument())
    expect(screen.getByText('answer')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: answerProjection.citations[0].label }),
    ).toBeInTheDocument()
  })

  it('switches to the deterministic manual-search tab', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /manual search/i }))
    expect(screen.getByRole('textbox', { name: /search query/i })).toBeInTheDocument()
  })

  it('PRESERVES a tab across a switch: the streamed answer survives leaving + returning to Chat', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        body: streamFromString(
          encodeSse(makeQueryStream(answerProjection, { answer: ANSWER_TEXT })),
          16,
        ),
      })),
    )
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'how does the membrane work')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByText(ANSWER_TEXT)).toBeInTheDocument())

    // leave Chat for Manual search, then return — the old conditional render UNMOUNTED chat here,
    // wiping the transcript; now the tabs stay mounted (display toggles) so the answer persists.
    await user.click(screen.getByRole('button', { name: /manual search/i }))
    await user.click(screen.getByRole('button', { name: /^chat$/i }))

    expect(screen.getByText(ANSWER_TEXT)).toBeInTheDocument()
  })
})
