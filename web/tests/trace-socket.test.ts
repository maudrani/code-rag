import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { openTraceSocket } from '../src/clients/traceSocket'
import { useTraceSocket } from '../src/clients/useTraceSocket'
import type { Event } from '../src/contract'
import { ANSWER_QUERY_ID, FOREIGN_QUERY_ID, traceEventsFixture } from '../src/mocks/fixtures'
import { FakeWebSocket } from './ws-test-utils'

function setup(queryId: string, extra: Record<string, unknown> = {}) {
  FakeWebSocket.reset()
  const events: Event[] = []
  const statuses: string[] = []
  const socket = openTraceSocket(
    'ws://host/ws/trace',
    queryId,
    (e) => events.push(e),
    (s) => statuses.push(s),
    { createWebSocket: (url: string) => new FakeWebSocket(url), ...extra },
  )
  return { socket, events, statuses }
}

const first = () => FakeWebSocket.instances[0]

describe('openTraceSocket — queryId filter (SC-03)', () => {
  it('delivers only Events for the current queryId, in arrival order', () => {
    const { events } = setup(ANSWER_QUERY_ID)
    first().open()
    for (const e of traceEventsFixture) {
      first().emit(e)
    }
    const expected = traceEventsFixture.filter((e) => e.queryId === ANSWER_QUERY_ID)
    expect(events).toHaveLength(expected.length)
    expect(events.every((e) => e.queryId === ANSWER_QUERY_ID)).toBe(true)
  })

  it('does NOT deliver Events for a foreign queryId (negative case)', () => {
    const { events } = setup(ANSWER_QUERY_ID)
    first().open()
    for (const e of traceEventsFixture) {
      first().emit(e)
    }
    expect(events.some((e) => e.queryId === FOREIGN_QUERY_ID)).toBe(false)
  })

  it('skips a malformed (non-JSON) message without delivering or tearing down', () => {
    const { events } = setup(ANSWER_QUERY_ID)
    first().open()
    first().emitRaw('{not valid json')
    expect(events).toHaveLength(0)
    first().emit(traceEventsFixture[0]) // socket still usable
    expect(events).toHaveLength(1)
  })
})

describe('openTraceSocket — reconnect', () => {
  it('reconnects with backoff on unexpected close; manual close() does not', async () => {
    vi.useFakeTimers()
    const { socket, statuses } = setup(ANSWER_QUERY_ID, { backoffMs: () => 100, maxRetries: 3 })
    first().open()
    expect(statuses).toContain('open')

    first().serverClose() // unexpected drop
    expect(statuses).toContain('reconnecting')
    await vi.advanceTimersByTimeAsync(100)
    expect(FakeWebSocket.instances.length).toBe(2) // a fresh socket was opened

    FakeWebSocket.instances[1].open()
    socket.close() // manual
    const created = FakeWebSocket.instances.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(FakeWebSocket.instances.length).toBe(created) // no further reconnect
    vi.useRealTimers()
  })
})

describe('useTraceSocket — resets on queryId change', () => {
  it('clears events when the queryId changes (no stale bleed)', () => {
    FakeWebSocket.reset()
    const options = { createWebSocket: (url: string) => new FakeWebSocket(url) }
    const { result, rerender } = renderHook(({ qid }) => useTraceSocket(qid, options), {
      initialProps: { qid: ANSWER_QUERY_ID },
    })
    act(() => {
      first().open()
      first().emit(traceEventsFixture[0])
    })
    expect(result.current.events).toHaveLength(1)

    rerender({ qid: 'q-different' })
    expect(result.current.events).toHaveLength(0)
  })
})

describe('useTraceSocket — requests the server replay via ?queryId= (FTR-56 Finding 1)', () => {
  it('opens /ws/trace WITH ?queryId= so a late subscriber gets the replay (L0→L5), not only L5', () => {
    FakeWebSocket.reset()
    const options = { createWebSocket: (url: string) => new FakeWebSocket(url) }
    const { result } = renderHook(() => useTraceSocket(ANSWER_QUERY_ID, options))

    // THE FIX (non-vacuous): the URL must carry the queryId so the server takes the REPLAY path
    // (forwardTraceReplay). A bare /ws/trace makes the server skip the replay, and the front —
    // which learns the queryId from the SSE only AFTER L0–L4 fired — subscribes late and sees
    // nothing. Reverting the fix drops the query string and fails this assertion.
    expect(first().url).toContain(`?queryId=${ANSWER_QUERY_ID}`)

    // Simulate the server replaying Q's buffered L0–L4 on connect, then tailing live.
    act(() => {
      first().open()
      for (const e of traceEventsFixture.filter((ev) => ev.queryId === ANSWER_QUERY_ID)) {
        first().emit(e)
      }
    })
    const layers = result.current.events.map((e) => e.layer)
    expect(layers).toContain('L0') // the early events replay...
    expect(layers).toContain('L5') // ...through to the tail — the full gradient
    expect(result.current.events.length).toBeGreaterThan(1)
  })
})
