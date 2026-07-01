import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ObservabilityTab } from '../src/components/observability/ObservabilityTab'
import type { EngineTelemetry } from '../src/contract'
import { healthFixture, statsFixture } from '../src/mocks/fixtures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type RouteReply = { body: unknown; ok?: boolean; status?: number } | Error

/** Stub global fetch, routing /stats + /health to per-test replies (a value, a status, or an Error). */
function stubTelemetryFetch(routes: { stats?: RouteReply; health?: RouteReply }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown) => {
      const u = String(url)
      const reply = u.includes('/stats')
        ? routes.stats
        : u.includes('/health')
          ? routes.health
          : undefined
      if (reply === undefined) {
        return Promise.reject(new Error(`unrouted ${u}`))
      }
      if (reply instanceof Error) {
        return Promise.reject(reply)
      }
      const status = reply.status ?? 200
      return Promise.resolve({
        ok: reply.ok ?? (status >= 200 && status < 300),
        status,
        json: async () => reply.body,
      } as unknown as Response)
    }),
  )
}

describe('ObservabilityTab', () => {
  it('renders per-layer telemetry from /stats (L1→L5 cards, via sub-tabs)', async () => {
    stubTelemetryFetch({ stats: { body: statsFixture }, health: { body: healthFixture } })
    const user = userEvent.setup()
    render(<ObservabilityTab />)

    // the default sub-tab (L1 Ingest) shows its telemetry
    const ingest = await screen.findByRole('region', { name: /ingest/i })
    expect(within(ingest).getByText(/198 \/ 214/)).toBeInTheDocument()

    // navigating to another layer's sub-tab surfaces that layer's telemetry
    await user.click(screen.getByRole('tab', { name: /index/i }))
    const index = await screen.findByRole('region', { name: /index/i })
    expect(within(index).getByText('in-memory')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /answer/i }))
    const answer = await screen.findByRole('region', { name: /answer/i })
    expect(within(answer).getByText('claude-haiku-4-5')).toBeInTheDocument()
    expect(within(answer).getByText('$0.00007')).toBeInTheDocument()
  })

  it('renders the health status and per-check pass/fail from /health (always visible)', async () => {
    stubTelemetryFetch({ stats: { body: statsFixture }, health: { body: healthFixture } })
    render(<ObservabilityTab />)

    const health = await screen.findByRole('region', { name: /health/i })
    // status badge + both passing checks all read "ok" (status + per-check) — assert it surfaces
    expect(within(health).getAllByText('ok').length).toBeGreaterThanOrEqual(1)
    expect(within(health).getByText('indexed')).toBeInTheDocument()
    expect(within(health).getByText('provider')).toBeInTheDocument()
  })

  it('renders the L4 per-leg scores (bm25/dense/structural) — dense is live (non-zero)', async () => {
    stubTelemetryFetch({ stats: { body: statsFixture }, health: { body: healthFixture } })
    const user = userEvent.setup()
    render(<ObservabilityTab />)

    await user.click(await screen.findByRole('tab', { name: /retrieve/i }))
    const retrieve = await screen.findByRole('region', { name: /retrieve/i })
    expect(within(retrieve).getByText('bm25')).toBeInTheDocument()
    expect(within(retrieve).getByText('dense')).toBeInTheDocument()
    expect(within(retrieve).getByText('structural')).toBeInTheDocument()
    // the dense contribution is a concrete, non-zero score (FTR-53 made visible)
    expect(within(retrieve).getByText('0.0231')).toBeInTheDocument()
  })

  it('shows the per-layer CLI command an agent would run (CLI/MCP/HTTP parity)', async () => {
    stubTelemetryFetch({ stats: { body: statsFixture }, health: { body: healthFixture } })
    const user = userEvent.setup()
    render(<ObservabilityTab />)

    // the default (ingest) sub-tab shows its command
    expect(await screen.findByText(/code-rag stats --layer ingest/)).toBeInTheDocument()
    // and each layer shows ITS command
    await user.click(screen.getByRole('tab', { name: /retrieve/i }))
    expect(await screen.findByText(/code-rag stats --layer retrieve/)).toBeInTheDocument()
  })

  it('renders an empty state when there is no last query (null lastQuery)', async () => {
    const cold: EngineTelemetry = { ...statsFixture, lastQuery: null }
    stubTelemetryFetch({ stats: { body: cold }, health: { body: healthFixture } })
    const user = userEvent.setup()
    render(<ObservabilityTab />)

    await user.click(await screen.findByRole('tab', { name: /retrieve/i }))
    expect(await screen.findByText(/no query yet/i)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /answer/i }))
    expect(await screen.findByText(/no answer yet/i)).toBeInTheDocument()
  })

  it('renders an error state with retry when /stats fails (and NOT the layer tabs)', async () => {
    stubTelemetryFetch({
      stats: { body: { error: 'boom' }, status: 500 },
      health: { body: healthFixture },
    })
    render(<ObservabilityTab />)

    // the stats error region + a Retry control
    const alert = await screen.findByText(/load telemetry/i)
    expect(alert).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    // branch assertion (non-vacuous): the error path renders NO layer tabs and NO layer cards
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('region', { name: /ingest/i })).toBeNull()
  })

  it('shows a loading skeleton before the first telemetry resolves', () => {
    // a never-resolving fetch keeps the hook in its first-paint loading state
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    render(<ObservabilityTab />)
    expect(screen.getByRole('status', { name: /loading telemetry/i })).toBeInTheDocument()
  })

  it('the Refresh control shows in-flight feedback (spins + disabled) while re-fetching', async () => {
    // the two mount fetches resolve; every later fetch (the refetch) hangs so we can observe the
    // in-flight state deterministically.
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        calls += 1
        if (calls <= 2) {
          const body = String(url).includes('/health') ? healthFixture : statsFixture
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => body,
          } as unknown as Response)
        }
        return new Promise<Response>(() => {}) // refetch never resolves -> stays "Refreshing…"
      }),
    )
    const user = userEvent.setup()
    render(<ObservabilityTab />)

    await screen.findByRole('region', { name: /health/i }) // initial load settled
    await user.click(screen.getByRole('button', { name: /refresh/i }))

    const busy = await screen.findByRole('button', { name: /refreshing/i })
    expect(busy).toBeDisabled()
  })
})
