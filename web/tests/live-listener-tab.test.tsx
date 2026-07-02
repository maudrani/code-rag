import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MinimalEventSource } from '../src/clients/ledgerStream'
import { LiveListenerTab } from '../src/components/LiveListenerTab'
import type { QueryLogEntry } from '../src/contract'
import { CARD_SURFACE, OUTCOME_TONES } from '../src/lib/badgeTones'
import { answerProjection } from '../src/mocks/fixtures'
import {
  assertContrastAA,
  assertHasMinHeight,
  assertIsScrollOwner,
  assertWithinPane,
} from './_ui-verify'

afterEach(() => vi.restoreAllMocks())

class FakeEventSource implements MinimalEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0
  closed = false
  private listeners: Record<string, ((ev: { data: string }) => void)[]> = {}

  addEventListener(type: string, listener: (ev: { data: string }) => void): void {
    const list = this.listeners[type] ?? []
    list.push(listener)
    this.listeners[type] = list
  }
  close(): void {
    this.closed = true
    this.readyState = 2
  }
  open(): void {
    this.readyState = 1
    this.onopen?.()
  }
  emit(type: string, data: string): void {
    for (const l of this.listeners[type] ?? []) {
      l({ data })
    }
  }
  fail(readyState: number): void {
    this.readyState = readyState
    this.onerror?.()
  }
}

function entry(over: Partial<QueryLogEntry> = {}): QueryLogEntry {
  return {
    ts: 1,
    queryId: 'q-1',
    consumer: 'cli',
    query: 'where is the score gate?',
    resultCount: 5,
    scoresByLeg: { bm25: 0.01, dense: 0.02, structural: 0.005 },
    band: 'answer',
    latencyMs: 30,
    ...over,
  }
}

describe('LiveListenerTab', () => {
  it('shows a waiting state until the first entry arrives', () => {
    const fake = new FakeEventSource()
    render(<LiveListenerTab createEventSource={() => fake} />)
    expect(screen.getByText(/waiting for queries/i)).toBeInTheDocument()
  })

  it('renders arriving entries as a live feed tagged by consumer (newest-first)', () => {
    const fake = new FakeEventSource()
    render(<LiveListenerTab createEventSource={() => fake} />)

    act(() => {
      fake.open()
      fake.emit('entry', JSON.stringify(entry({ queryId: 'q-cli', consumer: 'cli' })))
    })
    act(() => {
      fake.emit('entry', JSON.stringify(entry({ queryId: 'q-mcp', consumer: 'mcp' })))
    })

    const feed = screen.getByRole('list', { name: /live query feed/i })
    const rows = within(feed).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('mcp') // newest prepends
    expect(within(feed).getByText('cli')).toBeInTheDocument()
    expect(within(feed).getByText('mcp')).toBeInTheDocument()
  })

  it('expands a row on click to reveal the per-leg scores + result count', async () => {
    const fake = new FakeEventSource()
    const user = userEvent.setup()
    render(<LiveListenerTab createEventSource={() => fake} />)

    act(() => {
      fake.open()
      fake.emit('entry', JSON.stringify(entry({ queryId: 'q-x', consumer: 'cli' })))
    })

    // collapsed: the per-leg detail is not in the DOM
    expect(screen.queryByText(/bm25 score/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText(/bm25 score/i)).toBeInTheDocument()
    expect(screen.getByText(/structural score/i)).toBeInTheDocument()
  })

  it('tags each entry with its L5 outcome: the model, "deterministic", or "refused · $0"', () => {
    const fake = new FakeEventSource()
    render(<LiveListenerTab createEventSource={() => fake} />)

    act(() => {
      fake.open()
      fake.emit(
        'entry',
        JSON.stringify(
          entry({
            queryId: 'q-llm',
            band: 'answer',
            model: 'claude-haiku-4-5',
            answered: true,
            tokens: 120,
            estCost: 0.0005,
          }),
        ),
      )
      fake.emit('entry', JSON.stringify(entry({ queryId: 'q-det', band: 'answer' }))) // no model → deterministic
      fake.emit(
        'entry',
        JSON.stringify(
          entry({ queryId: 'q-ref', band: 'refuse', answered: false, tokens: 0, estCost: 0 }),
        ),
      )
    })

    const feed = screen.getByRole('list', { name: /live query feed/i })
    expect(within(feed).getByText('claude-haiku-4-5')).toBeInTheDocument()
    expect(within(feed).getByText('deterministic')).toBeInTheDocument()
    expect(within(feed).getByText(/refused/i)).toBeInTheDocument()
  })

  it('the refused-band outcome badge uses an AA-approved token — legible, not muted-on-muted (TKT-522)', () => {
    const fake = new FakeEventSource()
    render(<LiveListenerTab createEventSource={() => fake} />)

    act(() => {
      fake.open()
      fake.emit(
        'entry',
        JSON.stringify(entry({ queryId: 'q-ref', band: 'refuse', answered: false })),
      )
    })

    const badge = screen.getByTestId('ledger-outcome')
    expect(badge).toHaveTextContent(/refused/i)
    // the rendered element declares an APPROVED tone whose token is proven AA on the card surface
    expect(badge).toHaveAttribute('data-tone', 'refused')
    expect(() => assertContrastAA(OUTCOME_TONES.refused, CARD_SURFACE)).not.toThrow()
  })

  it('a search-only entry shows "deterministic", NOT a model badge (no false LLM claim, TKT-521)', () => {
    const fake = new FakeEventSource()
    render(<LiveListenerTab createEventSource={() => fake} />)

    act(() => {
      fake.open()
      // band answer, no model, answered undefined → the contract's search-only shape
      fake.emit('entry', JSON.stringify(entry({ queryId: 'q-det', band: 'answer' })))
    })

    const badge = screen.getByTestId('ledger-outcome')
    expect(badge).toHaveTextContent('deterministic')
    expect(badge).toHaveAttribute('data-tone', 'deterministic')
  })

  it('the feed OWNS its scroll (min-h-0 + overflow-y-auto) and cards have a min-height — entries never overflow-clip to nothing (TKT-530)', () => {
    const fake = new FakeEventSource()
    render(<LiveListenerTab createEventSource={() => fake} />)

    act(() => {
      fake.open()
      fake.emit('entry', JSON.stringify(entry({ queryId: 'q-a' })))
      fake.emit('entry', JSON.stringify(entry({ queryId: 'q-b' })))
    })

    const feed = screen.getByTestId('live-feed')
    // the feed scrolls internally (bounded) instead of overflowing the page and clipping rows
    assertIsScrollOwner(feed)
    // every entry card has a min-height floor so it stays legible (does not collapse)
    const rows = within(feed).getAllByRole('listitem')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      assertHasMinHeight(row)
    }
    // and the rows live INSIDE the scroll-owning feed (in-pane, not detached)
    assertWithinPane(rows[0], 'live-feed')
  })

  it('lazily fetches + renders the query results on expand, and UNMOUNTS them on collapse (TKT-531)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => answerProjection })
    vi.stubGlobal('fetch', fetchMock)
    const fake = new FakeEventSource()
    const user = userEvent.setup()
    render(<LiveListenerTab createEventSource={() => fake} baseUrl="" />)

    act(() => {
      fake.open()
      fake.emit('entry', JSON.stringify(entry({ queryId: 'q-1', query: 'membrane' })))
    })

    // LAZY: nothing is fetched until the card is expanded
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { expanded: false }))

    // expand -> the deterministic /search is re-run with THIS card's query, results render (reused row)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/search')
    expect(JSON.parse(String(init.body))).toMatchObject({ query: 'membrane' })
    const results = await screen.findByTestId('ledger-row-results')
    expect(within(results).getAllByText(/RRF/).length).toBeGreaterThan(0)

    // collapse -> the results are UNMOUNTED (cleared), not just hidden (no accumulation)
    await user.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryByTestId('ledger-row-results')).not.toBeInTheDocument()
  })

  it('ignores a stale in-flight result fetch when the card is collapsed before it resolves (TKT-531 edge)', async () => {
    let resolveFetch: (() => void) | null = null
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = () =>
            resolve({ ok: true, status: 200, json: async () => answerProjection })
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const fake = new FakeEventSource()
    const user = userEvent.setup()
    render(<LiveListenerTab createEventSource={() => fake} baseUrl="" />)

    act(() => {
      fake.open()
      fake.emit('entry', JSON.stringify(entry({ queryId: 'q-1', query: 'membrane' })))
    })

    await user.click(screen.getByRole('button', { expanded: false })) // expand (fetch pending)
    await user.click(screen.getByRole('button', { expanded: true })) // collapse before it resolves
    act(() => {
      resolveFetch?.() // the stale response arrives after unmount
    })

    // the late response must NOT render into a closed card (unmounted → ignored, no crash)
    expect(screen.queryByTestId('ledger-row-results')).not.toBeInTheDocument()
  })

  it('consumer chips + the status pill expose queryable tone attrs (data-consumer / data-status) — TKT-526', () => {
    const fake = new FakeEventSource()
    render(<LiveListenerTab createEventSource={() => fake} />)
    act(() => {
      fake.open()
      fake.emit('entry', JSON.stringify(entry({ queryId: 'q-cli', consumer: 'cli' })))
    })

    // the status pill reflects its state (open) via data-status (was muted-on-muted for closed, fixed)
    expect(screen.getByText('Live').closest('[data-status]')).toHaveAttribute('data-status', 'open')
    // the consumer chip carries its tone key
    const chip = within(screen.getByTestId('live-feed')).getByText('cli')
    expect(chip).toHaveAttribute('data-consumer', 'cli')
  })

  it('shows a "reconnecting" status on a transient drop (TKT-529 D4)', () => {
    const fake = new FakeEventSource()
    render(<LiveListenerTab createEventSource={() => fake} />)
    act(() => {
      fake.open()
      fake.fail(0) // still CONNECTING → the browser is auto-reconnecting
    })
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument()
  })

  it('dedups a re-replayed entry (same queryId) after a reconnect', () => {
    const fake = new FakeEventSource()
    render(<LiveListenerTab createEventSource={() => fake} />)

    act(() => {
      fake.open()
      fake.emit('entry', JSON.stringify(entry({ queryId: 'q-dup' })))
    })
    act(() => {
      fake.emit('entry', JSON.stringify(entry({ queryId: 'q-dup' }))) // reconnect replays it
    })

    const rows = within(screen.getByRole('list', { name: /live query feed/i })).getAllByRole(
      'listitem',
    )
    expect(rows).toHaveLength(1)
  })

  it('shows an unavailable state (and NO feed) when the stream closes with no entries', () => {
    const fake = new FakeEventSource()
    render(<LiveListenerTab createEventSource={() => fake} />)

    act(() => {
      fake.fail(2) // EventSource.CLOSED — e.g. a 404 on a backend without /ledger/stream
    })

    expect(screen.getByText(/unavailable/i)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /live query feed/i })).not.toBeInTheDocument()
  })
})
