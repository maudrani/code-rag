/**
 * registry.ts — the anti-vacuity gate registry (master-owned; ADR-009 / RULE-PROD-001).
 *
 * Adopts peripheral's claim-gate backbone (bench/src/harness/claim-gate.ts:
 * `auditRegistry`/`registryHasGap`). The invariant (peripheral's "I9", here applied to the
 * observability seam): every DECLARED behavior must be backed by a STANDING gate test that
 * fails when the behavior breaks. "Declared but not gated" becomes a build failure BY
 * CONSTRUCTION — reusable for every future claim (telemetry, replay, cost, …).
 *
 *   unbacked       a declared behavior with NO gateTest reference (the I9 violation).
 *   not-exercised  a gateTest is referenced but flagged stale/not-run this cycle
 *                  (a phantom gate manufactures false confidence — worse than none).
 *   pass           a gateTest reference exists and was exercised.
 *
 * `registryHasGap()` is the single boolean a CI step exits non-zero on.
 */

import { ANSWER_GATES } from './answer/telemetry.js'
import { SURFACE_GATES } from './consume/gates.js'
import { RETRIEVE_GATES } from './retrieve/telemetry.js'

/** A single registered gate: a declared behavior + the standing test that backs it. */
export interface Gate {
  /** stable id, e.g. 'membrane.replay'. */
  id: string
  /** the declared behavior being gated (human-readable). */
  claim: string
  /** the layer that owns the behavior (membrane, L4, …). */
  layer: string
  /**
   * a NON-EMPTY reference to the backing test (e.g. 'file.test.ts::case'). Empty /
   * undefined => the claim is unbacked. For step-1, a non-empty reference IS the
   * "exercised" signal (the test exists in the suite).
   */
  gateTest?: string
  /**
   * explicit staleness override: a referenced gate KNOWN not to have run this cycle.
   * Defaults to exercised when a gateTest reference is present (the step-1 model).
   */
  exercised?: boolean
}

/** Per-gate audit verdict. */
export type GateStatus = 'unbacked' | 'not-exercised' | 'pass'

export interface GateVerdict {
  id: string
  claim: string
  layer: string
  status: GateStatus
  reason: string
}

/** Audit one gate against the I9 rule (declared => backed + exercised). */
function auditGate(gate: Gate): GateVerdict {
  const base = { id: gate.id, claim: gate.claim, layer: gate.layer }
  const ref = gate.gateTest?.trim()
  if (ref === undefined || ref.length === 0) {
    return {
      ...base,
      status: 'unbacked',
      reason: `'${gate.id}' declares "${gate.claim}" but no gateTest backs it (declared, not gated)`,
    }
  }
  if (gate.exercised === false) {
    return {
      ...base,
      status: 'not-exercised',
      reason: `'${gate.id}' references '${ref}' but it was not exercised this run (phantom/stale gate)`,
    }
  }
  return {
    ...base,
    status: 'pass',
    reason: `'${gate.id}' is backed by exercised gate '${ref}'`,
  }
}

/** A registry instance — a mutable set of gates + the audit surface over it. */
export interface GateRegistry {
  /** register a gate (the membrane registers its own at module load). */
  registerGate(gate: Gate): void
  /** per-gate verdicts, in registration order. */
  auditRegistry(): GateVerdict[]
  /** true iff ANY gate is non-pass — the value CI exits non-zero on. */
  registryHasGap(): boolean
  /** the registered gates (read-only snapshot). */
  gates(): readonly Gate[]
}

/** Build an isolated registry (used by tests; the module exports a default singleton). */
export function createGateRegistry(seed: Gate[] = []): GateRegistry {
  const registered: Gate[] = [...seed]
  const audit = (): GateVerdict[] => registered.map(auditGate)
  return {
    registerGate(gate) {
      registered.push(gate)
    },
    auditRegistry: audit,
    registryHasGap: () => audit().some((v) => v.status !== 'pass'),
    gates: () => [...registered],
  }
}

/**
 * The membrane's OWN gates — registered as the worked examples (telemetry + replay). Both
 * are backed by tests/membrane/telemetry.test.ts, so the default registry is gap-free.
 */
export const MEMBRANE_GATES: Gate[] = [
  {
    id: 'membrane.telemetry',
    claim: 'telemetry()/health() return the per-layer holding snapshot with honest invariants',
    layer: 'membrane',
    gateTest:
      'tests/membrane/telemetry.test.ts::telemetry() — the holding snapshot + honest invariants',
  },
  {
    id: 'membrane.replay',
    claim: 'replay(queryId) returns the buffered L0–L4 events (the late-subscriber race fix)',
    layer: 'membrane',
    gateTest:
      'tests/membrane/telemetry.test.ts::replay() — the late-subscriber race fix (ring buffer)',
  },
]

/**
 * The module-level default registry — the CI entry point. Folds EVERY layer's gates into one
 * singleton so `registryHasGap()` is a single global boolean across the whole observability seam:
 * MEMBRANE_GATES + ANSWER_GATES (answer) + SURFACE_GATES (surface) + RETRIEVE_GATES (retrieve).
 *
 * NOTE — no ingest/chunk gates yet: the L1/L2 specialists have NOT exported an INGEST_GATES /
 * CHUNK_GATES array, so those layers contribute none here. When ingest-chunk ships one, add it
 * to the seed below so `registryHasGap()` keeps covering every layer.
 *
 * LAZY seeding (not eager) is deliberate: src/consume/gates.ts value-imports `registerGate` from
 * this module, so eagerly spreading SURFACE_GATES in the module body would read it before
 * consume/gates.ts finished initializing under that import cycle (a TDZ crash). Deferring the
 * fold to first use sidesteps the cycle — by call time every layer module is fully evaluated.
 */
let defaultRegistry: GateRegistry | null = null
function getDefaultRegistry(): GateRegistry {
  defaultRegistry ??= createGateRegistry([
    ...MEMBRANE_GATES,
    ...ANSWER_GATES,
    ...SURFACE_GATES,
    ...RETRIEVE_GATES,
  ])
  return defaultRegistry
}

export const registerGate = (gate: Gate): void => {
  getDefaultRegistry().registerGate(gate)
}
export const auditRegistry = (): GateVerdict[] => getDefaultRegistry().auditRegistry()
export const registryHasGap = (): boolean => getDefaultRegistry().registryHasGap()
