/**
 * L4 retrieve telemetry (FTR-22, TKT-209) — the layer's slice of the observability seam.
 *
 * The PULL-half contract (`QueryLogEntry`) + the cross-consumer ledger + the read surface
 * (`Observable.queryLog()`) are master-owned (src/contracts/telemetry.ts, src/membrane). This file
 * owns the two things that are L4-semantic:
 *   1. `topScoresByLeg` — the SSOT derivation of `QueryLogEntry.scoresByLeg` (the per-leg fused
 *      contributions of the top result). The membrane appends it per query; keeping the derivation
 *      here makes its invariant (DD-1: the legs sum to the top result's fused score) unit-assertable.
 *   2. `RETRIEVE_GATES` — this layer's anti-vacuity gates (registry.ts / demonstrate-deterministically
 *      P4). The central registry CI test imports every layer's gates, registers them, and asserts
 *      `registryHasGap() === false`: a declared L4 behaviour with no exercised gate fails the build.
 */
import type { RetrievalResult } from '../contracts/retrieval.js'
import type { Leg } from '../contracts/telemetry.js'
import type { Gate } from '../registry.js'

/**
 * The per-leg fused contributions of the TOP-ranked result — `QueryLogEntry.scoresByLeg`. A fresh
 * copy (telemetry never aliases the live result), all-zero when the result set is empty. Byte-for-byte
 * the membrane's inlined derivation, so it swaps in as a no-op SSOT.
 */
export function topScoresByLeg(results: RetrievalResult): Record<Leg, number> {
  const top = results[0]
  return top ? { ...top.scores } : { bm25: 0, dense: 0, structural: 0 }
}

/**
 * L4's registered gates. Each maps a declared retrieve behaviour to the standing test that fails if
 * the behaviour breaks (the `gateTest` ref is non-empty ⇒ backed + exercised, per the step-1 model).
 */
export const RETRIEVE_GATES: Gate[] = [
  {
    id: 'L4.definitionBoost',
    claim:
      'retrieve() guarantees the queried symbol’s defining chunk reaches top-k (the distance-0 pin + the guaranteed-slot safety net), non-vacuously',
    layer: 'L4',
    gateTest:
      'tests/retrieve/definition-boost.eval.test.ts::GUARANTEE: recall@10 === 1 for every gold query WITH the pin; meets the committed baseline',
  },
  {
    id: 'L4.scoresByLeg',
    claim:
      'retrieve reports the per-leg fused contributions (QueryLogEntry.scoresByLeg) of the top result, summing to its fused score (DD-1)',
    layer: 'L4',
    gateTest:
      'tests/retrieve/telemetry.test.ts::mirrors the top result per-leg scores (DD-1 sum invariant)',
  },
]
