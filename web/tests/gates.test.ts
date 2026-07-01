import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FRONTEND_GATES, type Gate } from '../src/gates'

// FTR-52 — the frontend row's anti-vacuity registry entries. Every DECLARED rendering behavior
// maps to a STANDING, resolvable, exercised gate, so once master folds ...FRONTEND_GATES into the
// seed, registryHasGap() covers the web row globally. web ⊥ Node, so this is a SELF-CONTAINED
// guard (a local mirror of the registry's audit rule) — no import of the Node registry.

// gateTest files are repo-root-relative (e.g. 'web/tests/x'); web's vitest cwd is web/, so strip
// the leading 'web/' and resolve against cwd. (import.meta.url is not a file: URL under vite.)
function resolveRef(file: string): string {
  return join(process.cwd(), file.replace(/^web\//, ''))
}

// Mirror of the registry's audit rule (declared => backed + exercised).
function isBacked(gate: Gate): boolean {
  return (gate.gateTest ?? '').trim().length > 0 && gate.exercised !== false
}

describe('FRONTEND_GATES — anti-vacuity registry (FTR-52)', () => {
  it('declares a backed, unique gate per rendering boundary (SC-1..SC-6)', () => {
    expect(FRONTEND_GATES.length).toBeGreaterThanOrEqual(6)
    expect(FRONTEND_GATES.every(isBacked)).toBe(true)
    expect(new Set(FRONTEND_GATES.map((g) => g.id)).size).toBe(FRONTEND_GATES.length)
    expect(new Set(FRONTEND_GATES.map((g) => g.layer))).toEqual(new Set(['frontend']))
  })

  it('PHANTOM-GUARD: every gateTest reference resolves to a REAL file AND a REAL case', () => {
    for (const gate of FRONTEND_GATES) {
      const ref = gate.gateTest
      expect(ref, `${gate.id} must declare a gateTest`).toBeDefined()
      const [file, kase] = (ref ?? '').split('::')
      expect(file, `${gate.id} ref must be <file>::<case>`).toBeTruthy()
      expect(kase, `${gate.id} ref must be <file>::<case>`).toBeTruthy()
      const content = readFileSync(resolveRef(file ?? ''), 'utf8')
      // the case substring must actually appear in the test file — a typo'd reference is caught here.
      expect(content.includes((kase ?? '').trim()), `${gate.id} -> ${file}::${kase}`).toBe(true)
    }
  })

  it('PHANTOM-GUARD bites: a fabricated case reference does NOT resolve (non-vacuous)', () => {
    const content = readFileSync(resolveRef('web/tests/highlighter.test.ts'), 'utf8')
    expect(content.includes('this case does not exist anywhere in the file')).toBe(false)
  })

  it('FAILURE-TWIN: an unbacked frontend gate is NOT backed (declared, not gated)', () => {
    const unbacked: Gate = { id: 'frontend.bogus', claim: 'something un-tested', layer: 'frontend' }
    expect(isBacked(unbacked)).toBe(false)
    expect([...FRONTEND_GATES, unbacked].every(isBacked)).toBe(false)
  })
})
