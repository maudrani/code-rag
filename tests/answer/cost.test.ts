import { describe, expect, it } from 'vitest'
import { estimateCost, PRICING } from '../../src/answer/cost.js'

// 1e6 tokens = the pricing unit, so estCost at 1M tokens equals the per-1M rate.
const ONE_M = 1_000_000

describe('cost — PRICING table (claude-api skill, dated snapshot)', () => {
  it('cheap = haiku $1 in / $5 out per 1M; strong = sonnet $3 in / $15 out per 1M', () => {
    expect(PRICING.cheap).toEqual({ in: 1, out: 5 })
    expect(PRICING.strong).toEqual({ in: 3, out: 15 })
  })
})

describe('estimateCost — exact per-tier USD', () => {
  it('cheap: 1M in + 1M out -> $1 + $5 = $6', () => {
    expect(estimateCost({ inputTokens: ONE_M, outputTokens: ONE_M }, 'cheap')).toBe(6)
  })

  it('strong: 1M in + 1M out -> $3 + $15 = $18', () => {
    expect(estimateCost({ inputTokens: ONE_M, outputTokens: ONE_M }, 'strong')).toBe(18)
  })

  it('partial tokens scale linearly: 500k in on cheap -> $0.5', () => {
    expect(estimateCost({ inputTokens: ONE_M / 2, outputTokens: 0 }, 'cheap')).toBe(0.5)
  })
})

describe('estimateCost — invariants', () => {
  it('zero tokens -> $0 for both tiers', () => {
    expect(estimateCost({ inputTokens: 0, outputTokens: 0 }, 'cheap')).toBe(0)
    expect(estimateCost({ inputTokens: 0, outputTokens: 0 }, 'strong')).toBe(0)
  })

  it('output is 5x input at the same token count (both tiers)', () => {
    const inOnly = { inputTokens: ONE_M, outputTokens: 0 }
    const outOnly = { inputTokens: 0, outputTokens: ONE_M }
    expect(estimateCost(outOnly, 'cheap')).toBe(5 * estimateCost(inOnly, 'cheap'))
    expect(estimateCost(outOnly, 'strong')).toBe(5 * estimateCost(inOnly, 'strong'))
  })

  it('strong is 3x cheap for identical usage (strong rates are 3x cheap rates)', () => {
    const u = { inputTokens: 1234, outputTokens: 5678 }
    expect(estimateCost(u, 'strong')).toBeCloseTo(3 * estimateCost(u, 'cheap'), 10)
  })
})

describe('estimateCost — negatives', () => {
  it('never returns NaN/Infinity for finite non-negative usage', () => {
    const c = estimateCost({ inputTokens: 999_999, outputTokens: 1 }, 'cheap')
    expect(Number.isFinite(c)).toBe(true)
  })

  it('does NOT mutate its input usage object (pure)', () => {
    const u = { inputTokens: 100, outputTokens: 200 }
    const snapshot = { ...u }
    estimateCost(u, 'strong')
    expect(u).toEqual(snapshot)
  })

  it('swapping tier changes the result (the table is actually consulted)', () => {
    const u = { inputTokens: 1000, outputTokens: 1000 }
    expect(estimateCost(u, 'cheap')).not.toBe(estimateCost(u, 'strong'))
  })
})
