import { describe, expect, it } from 'vitest'
import {
  type LedgerStatus,
  type MinimalEventSource,
  openLedgerStream,
} from '../src/clients/ledgerStream'
import type { QueryLogEntry } from '../src/contract'

/** A controllable EventSource stand-in — the test drives open/entry/error/readyState by hand. */
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

  // ── test drivers ──
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

function entryJson(over: Partial<QueryLogEntry> = {}): string {
  return JSON.stringify({
    ts: 1,
    queryId: 'q-1',
    consumer: 'cli',
    query: 'where is the score gate?',
    resultCount: 5,
    scoresByLeg: { bm25: 0.01, dense: 0.02, structural: 0.005 },
    band: 'answer',
    latencyMs: 30,
    ...over,
  } satisfies QueryLogEntry)
}

describe('openLedgerStream', () => {
  it('parses NAMED `entry` events into QueryLogEntry (a plain message event is ignored)', () => {
    const fake = new FakeEventSource()
    const entries: QueryLogEntry[] = []
    openLedgerStream('/ledger/stream', (e) => entries.push(e), undefined, {
      createEventSource: () => fake,
    })

    // a default `message` event must NOT feed the listener (surface emits `entry`)
    fake.emit('message', entryJson({ queryId: 'q-message' }))
    expect(entries).toHaveLength(0)

    fake.emit('entry', entryJson({ queryId: 'q-real', consumer: 'mcp' }))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ queryId: 'q-real', consumer: 'mcp' })
  })

  it('drives status connecting → open, and closed on a fatal error (readyState CLOSED)', () => {
    const fake = new FakeEventSource()
    const seen: LedgerStatus[] = []
    openLedgerStream(
      '/ledger/stream',
      () => {},
      (s) => seen.push(s),
      {
        createEventSource: () => fake,
      },
    )
    expect(seen).toEqual(['connecting'])

    fake.open()
    expect(seen.at(-1)).toBe('open')

    fake.fail(2) // EventSource.CLOSED → fatal (e.g. 404): graceful 'closed', no infinite reconnect
    expect(seen.at(-1)).toBe('closed')
  })

  it('reports reconnecting on a transient drop (still CONNECTING, browser retries)', () => {
    const fake = new FakeEventSource()
    let status: LedgerStatus = 'connecting'
    openLedgerStream(
      '/ledger/stream',
      () => {},
      (s) => {
        status = s
      },
      { createEventSource: () => fake },
    )

    fake.open()
    fake.fail(0) // CONNECTING → the browser is auto-reconnecting
    expect(status).toBe('reconnecting')
  })

  it('skips a malformed frame without closing the stream', () => {
    const fake = new FakeEventSource()
    const entries: QueryLogEntry[] = []
    openLedgerStream('/ledger/stream', (e) => entries.push(e), undefined, {
      createEventSource: () => fake,
    })
    fake.emit('entry', '{ not json')
    fake.emit('entry', entryJson({ queryId: 'q-ok' }))
    expect(entries.map((e) => e.queryId)).toEqual(['q-ok'])
  })

  it('close() closes the source and reports closed', () => {
    const fake = new FakeEventSource()
    let status: LedgerStatus = 'connecting'
    const handle = openLedgerStream(
      '/ledger/stream',
      () => {},
      (s) => {
        status = s
      },
      { createEventSource: () => fake },
    )

    handle.close()
    expect(fake.closed).toBe(true)
    expect(status).toBe('closed')
  })

  it('gives up quietly to closed when the factory throws (no EventSource / bad URL)', () => {
    const seen: LedgerStatus[] = []
    const handle = openLedgerStream(
      '/ledger/stream',
      () => {},
      (s) => seen.push(s),
      {
        createEventSource: () => {
          throw new Error('no EventSource')
        },
      },
    )
    expect(seen.at(-1)).toBe('closed')
    expect(() => handle.close()).not.toThrow()
  })
})
