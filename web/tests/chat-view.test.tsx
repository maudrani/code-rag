import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatView } from '../src/components/ChatView'
import { ANSWER_TEXT, answerProjection, refuseProjection } from '../src/mocks/fixtures'
import { encodeSse } from '../src/mocks/sseEncode'
import { makeQueryStream } from '../src/mocks/wireMock'
import { streamFromString } from './sse-test-utils'

function stubFetch(sseText: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      body: streamFromString(sseText, 16),
    })),
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ChatView', () => {
  it('streams an answer into the transcript with its decision badge', async () => {
    stubFetch(encodeSse(makeQueryStream(answerProjection, { answer: ANSWER_TEXT })))
    const user = userEvent.setup()
    render(<ChatView />)

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'how does the membrane work')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText(ANSWER_TEXT)).toBeInTheDocument()
    })
    expect(screen.getByText('answer')).toBeInTheDocument()
  })

  it('renders a refusal with NO answer bubble for the refuse band', async () => {
    stubFetch(encodeSse(makeQueryStream(refuseProjection)))
    const user = userEvent.setup()
    render(<ChatView />)

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'capital of france')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText(/not enough grounding/i)).toBeInTheDocument()
    })
    expect(screen.getByText('refused')).toBeInTheDocument()
  })
})
