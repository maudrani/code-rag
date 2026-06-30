import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { INGEST_GATES, registerIngestGates } from '../../src/ingest/gates.js'
import { createGateRegistry, type Gate, MEMBRANE_GATES } from '../../src/registry.js'

// FTR-12 — the ingest-chunk row's anti-vacuity registry entries. Mirrors
// tests/surface/gates.test.ts: every DECLARED L1/L2 behavior maps to a STANDING,
// resolvable, exercised gate, so once master folds ...INGEST_GATES into the seed,
// registryHasGap() covers L1/L2 globally (not just my slice's own gate-tests).

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

describe('INGEST_GATES — anti-vacuity registry (FTR-12)', () => {
  it('declares a backed, unique gate for keep-header + each telemetry collector', () => {
    expect(INGEST_GATES.length).toBeGreaterThanOrEqual(4)
    expect(INGEST_GATES.every((g) => (g.gateTest ?? '').length > 0)).toBe(true)
    expect(new Set(INGEST_GATES.map((g) => g.id)).size).toBe(INGEST_GATES.length)
    // both my layers are represented
    expect(new Set(INGEST_GATES.map((g) => g.layer))).toEqual(new Set(['ingest', 'chunk']))
  })

  it('every gate PASSES the audit in an isolated registry (backed + exercised)', () => {
    const reg = createGateRegistry(INGEST_GATES)
    expect(reg.auditRegistry().every((v) => v.status === 'pass')).toBe(true)
    expect(reg.registryHasGap()).toBe(false)
  })

  it('PHANTOM-GUARD: every gateTest reference resolves to a REAL file AND a REAL case', () => {
    for (const gate of INGEST_GATES) {
      const ref = gate.gateTest
      expect(ref, `${gate.id} must declare a gateTest`).toBeDefined()
      const [file, kase] = (ref ?? '').split('::')
      expect(file, `${gate.id} ref must be <file>::<case>`).toBeTruthy()
      expect(kase, `${gate.id} ref must be <file>::<case>`).toBeTruthy()
      const content = readFileSync(join(repoRoot, file ?? ''), 'utf8')
      // the case substring must actually appear in the test file — a typo'd reference
      // (which the step-1 model would pass vacuously) is caught here.
      expect(content.includes((kase ?? '').trim()), `${gate.id} -> ${file}::${kase}`).toBe(true)
    }
  })

  it('PHANTOM-GUARD bites: a fabricated case reference does NOT resolve (the guard is non-vacuous)', () => {
    const content = readFileSync(join(repoRoot, 'tests/chunk/keep-header.test.ts'), 'utf8')
    expect(content.includes('this case does not exist anywhere in the file')).toBe(false)
  })

  it('composes gap-free with the membrane gates (registerIngestGates path)', () => {
    const reg = createGateRegistry([...MEMBRANE_GATES])
    registerIngestGates((g) => reg.registerGate(g))
    expect(reg.registryHasGap()).toBe(false)
    expect(reg.gates().length).toBe(MEMBRANE_GATES.length + INGEST_GATES.length)
  })

  it('FAILURE-TWIN: an unbacked ingest-chunk gate makes the registry gapped (declared, not gated)', () => {
    const unbacked: Gate = { id: 'chunk.bogus', claim: 'something un-tested', layer: 'chunk' }
    const reg = createGateRegistry([...INGEST_GATES, unbacked])
    expect(reg.registryHasGap()).toBe(true)
    expect(reg.auditRegistry().find((v) => v.id === 'chunk.bogus')?.status).toBe('unbacked')
  })
})
