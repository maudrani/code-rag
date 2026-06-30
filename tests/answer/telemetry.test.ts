import { describe, expect, it } from 'vitest'
import { PRICING } from '../../src/answer/cost.js'
import { ANSWER_GATES, buildAnswerTelemetry } from '../../src/answer/telemetry.js'
import type { AnswerTelemetry, GateDecision } from '../../src/contracts/index.js'
import { createGateRegistry } from '../../src/registry.js'

// ── fixtures ──────────────────────────────────────────────────────────────────
function decision(overrides: Partial<GateDecision> = {}): GateDecision {
  return {
    groundingScore: 0.5,
    band: 'answer',
    tier: 'cheap',
    model: 'claude-haiku-4-5',
    ...overrides,
  }
}

const STRONG = decision({ groundingScore: 0.9, tier: 'strong', model: 'claude-sonnet-4-6' })
const REFUSE = decision({ groundingScore: 0, band: 'refuse' })

// ── SC-1: the struct maps the decision + computes estCost via the cost model ───
describe('buildAnswerTelemetry — field mapping (SC-1)', () => {
  it('maps band/tier/model from the decision and tokens = input+output', () => {
    const t = buildAnswerTelemetry(decision(), { inputTokens: 120, outputTokens: 80 })
    expect(t).toEqual<AnswerTelemetry>({
      band: 'answer',
      tier: 'cheap',
      model: 'claude-haiku-4-5',
      tokens: 200,
      estCost: (120 / 1_000_000) * PRICING.cheap.in + (80 / 1_000_000) * PRICING.cheap.out,
    })
  })

  it('prices by TIER, not model id — strong uses sonnet pricing', () => {
    const t = buildAnswerTelemetry(STRONG, { inputTokens: 1000, outputTokens: 500 })
    expect(t.model).toBe('claude-sonnet-4-6')
    expect(t.tier).toBe('strong')
    expect(t.estCost).toBeCloseTo(
      (1000 / 1_000_000) * PRICING.strong.in + (500 / 1_000_000) * PRICING.strong.out,
      12,
    )
  })

  it('estCost for the SAME usage is strictly higher on strong than on cheap', () => {
    const usage = { inputTokens: 500, outputTokens: 500 }
    const cheap = buildAnswerTelemetry(decision(), usage)
    const strong = buildAnswerTelemetry(STRONG, usage)
    expect(strong.estCost).toBeGreaterThan(cheap.estCost)
  })
})

// ── SC-2: a REFUSE is observable — zero-cost telemetry, NOT null/throw ──────────
describe('buildAnswerTelemetry — refuse is observable (SC-2)', () => {
  it('a refuse with no usage yields {band:refuse, tokens:0, estCost:0}, model preserved', () => {
    const t = buildAnswerTelemetry(REFUSE)
    expect(t).toEqual<AnswerTelemetry>({
      band: 'refuse',
      tier: 'cheap',
      model: 'claude-haiku-4-5',
      tokens: 0,
      estCost: 0,
    })
  })

  it('MUST NOT throw or return null on a refuse (the boundary stays observable)', () => {
    expect(() => buildAnswerTelemetry(REFUSE)).not.toThrow()
    expect(buildAnswerTelemetry(REFUSE)).not.toBeNull()
  })

  it('refuse invariant holds even if usage is mistakenly passed — cost is ALWAYS 0', () => {
    // A refused query never reaches the provider; it can never cost anything.
    const t = buildAnswerTelemetry(REFUSE, { inputTokens: 999, outputTokens: 999 })
    expect(t.tokens).toBe(0)
    expect(t.estCost).toBe(0)
  })
})

// ── SC-3: invariants ───────────────────────────────────────────────────────────
describe('buildAnswerTelemetry — invariants (SC-3)', () => {
  it('estCost === 0 IFF tokens === 0 (no fabricated cost)', () => {
    const zero = buildAnswerTelemetry(decision(), { inputTokens: 0, outputTokens: 0 })
    expect(zero.tokens).toBe(0)
    expect(zero.estCost).toBe(0)

    const nonzero = buildAnswerTelemetry(decision(), { inputTokens: 1, outputTokens: 0 })
    expect(nonzero.tokens).toBeGreaterThan(0)
    expect(nonzero.estCost).toBeGreaterThan(0)
  })

  it('estCost is monotonic non-decreasing in tokens at a fixed tier', () => {
    const small = buildAnswerTelemetry(decision(), { inputTokens: 10, outputTokens: 10 })
    const large = buildAnswerTelemetry(decision(), { inputTokens: 1000, outputTokens: 1000 })
    expect(large.estCost).toBeGreaterThanOrEqual(small.estCost)
  })

  it('model is consistent with the decision over both tiers', () => {
    expect(buildAnswerTelemetry(decision(), { inputTokens: 1, outputTokens: 1 }).model).toBe(
      'claude-haiku-4-5',
    )
    expect(buildAnswerTelemetry(STRONG, { inputTokens: 1, outputTokens: 1 }).model).toBe(
      'claude-sonnet-4-6',
    )
  })
})

// ── SC-4: ANSWER_GATES register into the anti-vacuity registry, gap-free ────────
describe('ANSWER_GATES — anti-vacuity registry (SC-4)', () => {
  it('every answer gate is layer:answer with a non-empty backing test ref', () => {
    expect(ANSWER_GATES.length).toBeGreaterThan(0)
    for (const gate of ANSWER_GATES) {
      expect(gate.layer).toBe('answer')
      expect(gate.gateTest?.trim().length ?? 0).toBeGreaterThan(0)
      expect(gate.id.startsWith('answer.')).toBe(true)
    }
  })

  it('a registry seeded with ANSWER_GATES has NO gap (every gate is backed + exercised)', () => {
    const reg = createGateRegistry([...ANSWER_GATES])
    expect(reg.registryHasGap()).toBe(false)
    expect(reg.auditRegistry().every((v) => v.status === 'pass')).toBe(true)
  })

  it('NON-VACUITY: an unbacked gate (empty gateTest) makes the registry report a gap', () => {
    // Proves the harness actually catches "declared but not gated" — the gate is real.
    const reg = createGateRegistry([
      ...ANSWER_GATES,
      { id: 'answer.bogus', claim: 'declared but ungated', layer: 'answer', gateTest: '' },
    ])
    expect(reg.registryHasGap()).toBe(true)
    expect(reg.auditRegistry().find((v) => v.id === 'answer.bogus')?.status).toBe('unbacked')
  })

  it('the telemetry behavior is among the declared answer gates', () => {
    expect(ANSWER_GATES.some((g) => g.id === 'answer.telemetry')).toBe(true)
  })
})
