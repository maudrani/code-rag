import type { GateDecision } from '../contracts/index.js'

/**
 * Cost model (ADR-005/006, seam 2; TKT-302) — the pure layer that turns an
 * AnswerChunk `usage` record into a USD cost. The master-owned membrane calls
 * `estimateCost(usage, decision.tier)` to populate the L5 event's `estCost`
 * (the cost-story centerpiece). REAL numbers: `usage` is measured by the SDK,
 * not estimated. NO LLM, no I/O.
 */

/** Tier discriminant — the seam shared with the gate (GateDecision.tier). */
export type Tier = GateDecision['tier']

/** The two AnswerChunk `usage` fields the cost is computed from (no cache tiers in M1). */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

/**
 * USD price per 1,000,000 tokens, keyed by tier (NOT by model id — `tier` is the
 * seam; model-id strings live only in the gate, TKT-301 D5).
 *
 * Source: claude-api skill, cached snapshot 2026-06-04 —
 *   cheap  = claude-haiku-4-5  ($1 in / $5 out per 1M)
 *   strong = claude-sonnet-4-6 ($3 in / $15 out per 1M)
 * If Anthropic pricing moves, update this single table.
 */
export const PRICING: Record<Tier, { in: number; out: number }> = {
  cheap: { in: 1, out: 5 },
  strong: { in: 3, out: 15 },
}

/** Tokens are priced per million. */
const TOKENS_PER_UNIT = 1_000_000

/**
 * estCost in USD = (inputTokens / 1M) * price.in + (outputTokens / 1M) * price.out.
 * Returns a raw float — formatting (cents, display) is the consumer's job, so we
 * never lose precision on sub-cent per-query costs.
 */
export function estimateCost(usage: TokenUsage, tier: Tier): number {
  const price = PRICING[tier]
  return (
    (usage.inputTokens / TOKENS_PER_UNIT) * price.in +
    (usage.outputTokens / TOKENS_PER_UNIT) * price.out
  )
}
