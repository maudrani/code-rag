import { type Gate, registerGate } from '../registry.js'

/**
 * INGEST_GATES — the anti-vacuity registry entries for the ingest-chunk ROW (L1 ingest +
 * L2 chunk). Mirrors MEMBRANE_GATES / SURFACE_GATES (observability design §6 /
 * RULE-PROD-001): every DECLARED behavior of my layers maps to a STANDING test that fails
 * when the behavior breaks, so "declared but not gated" is a build failure by construction.
 *
 * One array per master's seed convention; the per-gate `layer` ('ingest' | 'chunk')
 * distinguishes L1 from L2. `registry.ts` is master-owned: I CONTRIBUTE this array; the
 * master folds `...INGEST_GATES` into the default singleton so `registryHasGap()` covers
 * L1/L2 globally — not just my slice's own gate-tests.
 *
 * Each `gateTest` is `<file>::<case>` where <case> is a real substring of a real test
 * title — tests/ingest/gates.test.ts PHANTOM-GUARDS this (resolves every reference to a
 * real file + case), so a typo can't pass vacuously under the step-1 exercised model.
 */
export const INGEST_GATES: Gate[] = [
  {
    id: 'chunk.keep-header-decorators',
    claim:
      "a decorated method's chunk keeps its leading decorators (a route `@Get('/users')` IS the endpoint)",
    layer: 'chunk',
    gateTest: 'tests/chunk/keep-header.test.ts::a decorated method keeps its leading decorator',
  },
  {
    id: 'chunk.keep-header-signature',
    claim: 'a symbol chunk keeps its full signature WITH the body (the definition reaches context)',
    layer: 'chunk',
    gateTest: 'tests/chunk/keep-header.test.ts::keep-header holds across kinds',
  },
  {
    id: 'ingest.telemetry',
    claim:
      'collectIngestTelemetry returns the IngestTelemetry snapshot; filesWalked === filesIndexed + skipped + errors.length',
    layer: 'ingest',
    gateTest: 'tests/ingest/telemetry.test.ts::holds the invariant + reports the exact L1 counts',
  },
  {
    id: 'chunk.telemetry',
    claim:
      'collectChunkTelemetry returns the ChunkTelemetry snapshot; count === Σ byKind === Σ byLang; glueFallbacks = module count',
    layer: 'chunk',
    gateTest: 'tests/chunk/telemetry.test.ts::every chunk has exactly one kind + one lang',
  },
]

/**
 * registerIngestGates — fold the ingest-chunk gates into a registry. Defaults to the
 * module-level default singleton (registry.ts), but accepts an injected register fn
 * (used by the gate-audit test to avoid mutating global state).
 */
export function registerIngestGates(register: (gate: Gate) => void = registerGate): void {
  for (const gate of INGEST_GATES) register(gate)
}
