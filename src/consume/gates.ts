import { type Gate, registerGate } from '../registry.js'

/**
 * SURFACE_GATES — the anti-vacuity registry entries for the surface row (observability
 * design §6 / RULE-PROD-001). Mirrors the master's MEMBRANE_GATES pattern: every
 * DECLARED surface boundary maps to a STANDING test that fails when the boundary
 * breaks, so "declared but not gated" is a build failure by construction.
 *
 * Each `gateTest` is `<file>::<case>` where <case> is a real substring of a real test
 * title — tests/surface/gates.test.ts PHANTOM-GUARDS this (resolves every reference to
 * a real file + case), so a typo can't pass vacuously under the step-1 exercised model.
 *
 * registry.ts is master-owned: surface CONTRIBUTES this array; the master folds it into
 * the default singleton for a single global CI boolean (escalated).
 */
export const SURFACE_GATES: Gate[] = [
  {
    id: 'surface.telemetry-parity',
    claim: 'stats/health/log are byte-identical across CLI, MCP, and HTTP',
    layer: 'surface',
    gateTest: 'tests/surface/parity.test.ts::the three transports emit identical bytes',
  },
  {
    id: 'surface.stats',
    claim: 'the stats read-surface returns the per-layer telemetry snapshot',
    layer: 'surface',
    gateTest:
      'tests/surface/cli/telemetry.test.ts::stats --json emits the full snapshot via getStats (the SSOT)',
  },
  {
    id: 'surface.health',
    claim: 'health maps status to exit code / HTTP status (down => 503 / exit 1)',
    layer: 'surface',
    gateTest: 'tests/surface/http/telemetry.test.ts::503 when status is',
  },
  {
    id: 'surface.log',
    claim: 'the log ledger surface returns { entries } (the cross-consumer record)',
    layer: 'surface',
    gateTest: 'tests/surface/http/telemetry.test.ts::200 + { entries }',
  },
  {
    id: 'surface.trace-replay',
    claim: 'a late /ws/trace subscriber receives the full trace via replay (the race fix)',
    layer: 'surface',
    gateTest: 'tests/surface/http/ws-trace.test.ts::a LATE subscriber receives the buffered',
  },
  {
    id: 'surface.cors',
    claim: 'the API answers cross-origin (Access-Control-Allow-Origin) for the browser',
    layer: 'surface',
    gateTest: 'tests/surface/http/cors.test.ts::a bare app WITHOUT cors()',
  },
  {
    id: 'surface.http-shutdown',
    claim: 'the HTTP server shuts down gracefully (close then exit 0, idempotent)',
    layer: 'surface',
    gateTest:
      'tests/surface/http/lifecycle.test.ts::the shutdown handler closes the server, then exits 0',
  },
  {
    id: 'surface.ws-lifecycle',
    claim: 'closing a ws client releases the server-side subscription (no leak)',
    layer: 'surface',
    gateTest: 'tests/surface/http/lifecycle.test.ts::releases the server-side engine subscription',
  },
  {
    id: 'surface.mcp-shutdown',
    claim: 'the MCP stdio server shuts down gracefully (close then exit 0, idempotent)',
    layer: 'surface',
    gateTest: 'tests/surface/mcp/serve.test.ts::graceful shutdown: closes the server then exits 0',
  },
  {
    id: 'surface.error-envelope',
    claim: 'unexpected errors render a consistent JSON 500 envelope (no stack leak)',
    layer: 'surface',
    gateTest: 'tests/surface/http/server.test.ts::consistent JSON 500 envelope',
  },
]

/**
 * registerSurfaceGates — fold the surface gates into a registry. Defaults to the
 * module-level default singleton (registry.ts), but accepts an injected register fn
 * (used by the gate-audit test to avoid mutating global state).
 */
export function registerSurfaceGates(register: (gate: Gate) => void = registerGate): void {
  for (const gate of SURFACE_GATES) register(gate)
}
