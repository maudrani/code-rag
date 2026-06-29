import { describe, expect, it, vi } from 'vitest'
import { createBus } from '../../../src/bus/index.js'
import type { Event } from '../../../src/contracts/events.js'

function sample(overrides: Partial<Omit<Event, 'ts'>> = {}): Omit<Event, 'ts'> {
  return { queryId: 'q1', layer: 'membrane', type: 'x', payload: {}, ...overrides }
}

describe('createBus', () => {
  it('stamps ts (from the injected clock) and delivers in order', () => {
    let t = 0
    const bus = createBus({ now: () => ++t })
    const received: Event[] = []
    bus.on((e) => received.push(e))

    bus.emit(sample({ type: 'a' }))
    bus.emit(sample({ type: 'b' }))

    expect(received.map((e) => e.type)).toEqual(['a', 'b'])
    expect(received.map((e) => e.ts)).toEqual([1, 2])
  })

  it('delivers each event to every subscriber', () => {
    const bus = createBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.on(a)
    bus.on(b)

    bus.emit(sample())

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe stops delivery to that handler only', () => {
    const bus = createBus()
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = bus.on(a)
    bus.on(b)

    unsubA()
    bus.emit(sample())

    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('emit with zero subscribers is a no-op (edge)', () => {
    const bus = createBus()
    expect(() => bus.emit(sample())).not.toThrow()
  })

  it('double unsubscribe is idempotent (edge)', () => {
    const bus = createBus()
    const a = vi.fn()
    const unsub = bus.on(a)
    unsub()
    expect(() => unsub()).not.toThrow()
    bus.emit(sample())
    expect(a).not.toHaveBeenCalled()
  })

  it('a handler unsubscribing during emit does not break delivery to others (re-entrancy edge)', () => {
    const bus = createBus()
    const order: string[] = []
    let unsubA: () => void = () => undefined
    const a = vi.fn(() => {
      order.push('a')
      unsubA() // unsubscribe self mid-emit
    })
    const b = vi.fn(() => order.push('b'))
    unsubA = bus.on(a)
    bus.on(b)

    bus.emit(sample()) // snapshot: both fire this round
    bus.emit(sample()) // only b fires (a unsubscribed)

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
    expect(order).toEqual(['a', 'b', 'b'])
  })

  it('does not mutate the caller payload — stamps ts onto a new Event (negative)', () => {
    const bus = createBus({ now: () => 42 })
    const received: Event[] = []
    bus.on((e) => received.push(e))
    const input = sample({ type: 'orig' })

    bus.emit(input)

    expect('ts' in input).toBe(false)
    expect(received[0]?.ts).toBe(42)
  })
})
