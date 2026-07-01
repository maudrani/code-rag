import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatView } from '../src/components/ChatView'
import { ObservabilityTab } from '../src/components/observability/ObservabilityTab'
import { ANSWER_TEXT, answerProjection, healthFixture, statsFixture } from '../src/mocks/fixtures'
import { encodeSse } from '../src/mocks/sseEncode'
import { makeQueryStream } from '../src/mocks/wireMock'
import { streamFromString } from './sse-test-utils'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('accessibility', () => {
  it('exposes a polite live region for streaming announcements', () => {
    render(<ChatView />)
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull()
  })

  it('the composer input is reachable as a labelled textbox (keyboard)', () => {
    render(<ChatView />)
    expect(screen.getByRole('textbox', { name: /message/i })).toBeInTheDocument()
  })

  it('announces completion when the answer is done (not per token)', async () => {
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
    render(<ChatView />)

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'q')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]')
      expect(live?.textContent ?? '').toMatch(/answer ready/i)
    })
  })
})

describe('accessibility — Observability tab', () => {
  it('exposes the layers as a keyboard tablist + named region landmarks + a labelled refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        const body = String(url).includes('/health') ? healthFixture : statsFixture
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => body,
        } as unknown as Response)
      }),
    )
    render(<ObservabilityTab />)

    // the aggregate health + the default layer are landmarks with accessible names
    expect(await screen.findByRole('region', { name: /health/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /ingest/i })).toBeInTheDocument()

    // the five layers are a proper ARIA tablist (keyboard-navigable roving tabs)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    for (const name of [/ingest/i, /chunk/i, /index/i, /retrieve/i, /answer/i]) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
    // the refresh action is a real, named button
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
  })
})
