import type { AnswerTelemetry, GateDecision } from '../contracts/index.js'
import type { Gate } from '../registry.js'
import { estimateCost, type TokenUsage } from './cost.js'

/**
 * L5 AnswerTelemetry (FTR-32 / TKT-307; design observability-and-telemetry.md §5.1).
 *
 * The pure builder that turns a gate decision + the SDK's measured token usage into the
 * contract `AnswerTelemetry` struct (band/tier/model/tokens/estCost). RULE-019: each layer
 * fills its OWN telemetry struct — so this lives here, not inline in the membrane, alongside
 * `scoreGate` (the decision) and `estimateCost` (the price). The membrane imports + calls it
 * (the seam), exactly as it imports those two.
 *
 * No I/O, no Date/random — deterministic. `estCost` delegates to `estimateCost`, so pricing
 * has a single source of truth (cost.ts) and the cost stays REAL (usage is SDK-measured),
 * never re-derived or fabricated here.
 */

/**
 * Build the L5 telemetry for one query.
 *
 * - With `usage` and `band: 'answer'` -> the real per-query record (tokens = in+out, estCost
 *   priced by tier).
 * - With no `usage` (a refuse, or a query that never reached the provider) -> the zero-cost
 *   record. This is the FINDING this ticket acts on (GAP-2): a refuse must be OBSERVABLE — the
 *   explicit "the gate refused, $0 spent" signal — not silent. The contract's
 *   `AnswerTelemetry.band` allows 'refuse' precisely so a refused query still records itself.
 *
 * Refuse invariant: a refused query never reaches the provider, so it can never cost anything.
 * We therefore force tokens/estCost to 0 for `band: 'refuse'` EVEN IF a caller mistakenly passes
 * a `usage` — the telemetry can never claim a refuse spent tokens.
 */
export function buildAnswerTelemetry(decision: GateDecision, usage?: TokenUsage): AnswerTelemetry {
  const { band, tier, model } = decision

  if (band === 'refuse' || usage === undefined) {
    return { band, tier, model, tokens: 0, estCost: 0 }
  }

  const tokens = usage.inputTokens + usage.outputTokens
  return { band, tier, model, tokens, estCost: estimateCost(usage, tier) }
}

/**
 * The answer layer's gates for the anti-vacuity registry (src/registry.ts; rule
 * demonstrate-deterministically P4). Mirrors `MEMBRANE_GATES`: every DECLARED answer behavior
 * maps to a STANDING, exercised test, so "declared but not gated" is a build failure by
 * construction. Each gate is added HERE only once its backing test is real (no phantom gates):
 * `answer.telemetry` lands with TKT-307; `answer.tier-calibration` with TKT-308; etc.
 *
 * Master composes this array into the default registry / CI harness (registry.ts is
 * master-owned, RULE-019); this file owns the declarations + the tests that back them.
 */
export const ANSWER_GATES: Gate[] = [
  {
    id: 'answer.telemetry',
    claim:
      'buildAnswerTelemetry produces the L5 AnswerTelemetry (band/tier/model/tokens/estCost); a refuse is observable as a zero-cost record',
    layer: 'answer',
    gateTest:
      'tests/answer/telemetry.test.ts::buildAnswerTelemetry — field mapping + refuse observability + invariants',
  },
  {
    id: 'answer.tier-calibration',
    claim:
      'scoreGate routes lookups cheap and reasoning/breadth strong (cheap is LIVE, not vestigial) per ADR-005',
    layer: 'answer',
    gateTest:
      'tests/answer/tier-calibration.test.ts::tier-calibration — the committed fixture (cheap-recall > 0, strong-recall > 0)',
  },
  {
    id: 'answer.did-you-mean',
    claim:
      'suggestSymbol returns a near-miss retrieved symbol for an absent identifier (and null on exact/far/prose)',
    layer: 'answer',
    gateTest: 'tests/answer/did-you-mean.test.ts::suggestSymbol — near-miss detection (SC-8)',
  },
]
