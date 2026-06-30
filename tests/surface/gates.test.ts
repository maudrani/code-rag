import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registerSurfaceGates, SURFACE_GATES } from '../../src/consume/gates.js'
import { createGateRegistry, type Gate, MEMBRANE_GATES } from '../../src/registry.js'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

describe('SURFACE_GATES — anti-vacuity registry (TKT-423 / SC-07)', () => {
  it('declares a gate for every surface boundary, each with a backing test', () => {
    // every gate is backed (has a gateTest) and unique
    expect(SURFACE_GATES.length).toBeGreaterThanOrEqual(8)
    expect(SURFACE_GATES.every((g) => (g.gateTest ?? '').length > 0)).toBe(true)
    expect(new Set(SURFACE_GATES.map((g) => g.id)).size).toBe(SURFACE_GATES.length)
  })

  it('every surface gate PASSES the audit in an isolated registry (backed + exercised)', () => {
    const reg = createGateRegistry(SURFACE_GATES)
    expect(reg.auditRegistry().every((v) => v.status === 'pass')).toBe(true)
    expect(reg.registryHasGap()).toBe(false)
  })

  it('PHANTOM-GUARD: every gateTest reference resolves to a REAL file AND a REAL case', () => {
    for (const gate of SURFACE_GATES) {
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
    const content = readFileSync(join(repoRoot, 'tests/surface/parity.test.ts'), 'utf8')
    expect(content.includes('this case does not exist anywhere in the file')).toBe(false)
  })

  it('composes gap-free with the membrane gates (registerSurfaceGates path)', () => {
    const reg = createGateRegistry([...MEMBRANE_GATES])
    registerSurfaceGates((g) => reg.registerGate(g))
    expect(reg.registryHasGap()).toBe(false)
    expect(reg.gates().length).toBe(MEMBRANE_GATES.length + SURFACE_GATES.length)
  })

  it('FAILURE-TWIN: an unbacked surface gate makes the registry gapped (declared, not gated)', () => {
    const unbacked: Gate = { id: 'surface.bogus', claim: 'something un-tested', layer: 'surface' }
    const reg = createGateRegistry([...SURFACE_GATES, unbacked])
    expect(reg.registryHasGap()).toBe(true)
    expect(reg.auditRegistry().find((v) => v.id === 'surface.bogus')?.status).toBe('unbacked')
  })
})
