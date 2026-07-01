import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { healthFixture, statsFixture } from '../src/mocks/fixtures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stubTelemetryFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown) => {
      const u = String(url)
      if (u.includes('/stats')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => statsFixture,
        } as unknown as Response)
      }
      if (u.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => healthFixture,
        } as unknown as Response)
      }
      return Promise.reject(new Error(`unrouted ${u}`))
    }),
  )
}

describe('App — Observability tab', () => {
  it('switches to Observability: telemetry renders, chat composer + trace rail hidden', async () => {
    stubTelemetryFetch()
    const user = userEvent.setup()
    render(<App />)

    // chat is the default tab — the composer is present
    expect(screen.getByRole('textbox', { name: /message/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /observability/i }))

    // the telemetry surface appears
    expect(await screen.findByRole('region', { name: /ingest/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /health/i })).toBeInTheDocument()

    // the chat composer and the chat-only trace rail are no longer mounted
    expect(screen.queryByRole('textbox', { name: /message/i })).toBeNull()
    expect(screen.queryByText(/ask a question to watch the pipeline/i)).toBeNull()
  })
})
