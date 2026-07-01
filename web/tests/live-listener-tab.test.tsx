import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MinimalEventSource } from '../src/clients/ledgerStream'
import { LiveListenerTab } from '../src/components/LiveListenerTab'
import type { QueryLogEntry } from '../src/contract'

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
