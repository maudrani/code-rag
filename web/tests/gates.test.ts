import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// FRONTEND_GATES — the frontend row's anti-vacuity registry entries, WEB-SIDE ONLY (FTR-52 + FTR-56).
// Per the observability design (frontend-observability-dashboard.md §5): these live in the web's own
// test, NOT the Node registry — web ⊥ Node (the browser imports no Node code, and the master does not
// fold web gates into src/registry.ts). Every DECLARED rendering/observability behavior maps to a
// STANDING, resolvable, exercised test; a typo'd/fabricated reference is caught by the phantom-guard.
interface Gate {
  id: string
  claim: string
  layer: string
  gateTest?: string
  exercised?: boolean
}

const FRONTEND_GATES: Gate[] = [
  {
    id: 'frontend.markdown-render',
    claim: 'the assistant answer renders GFM markdown as real DOM elements, not raw source text',
    layer: 'frontend',
    gateTest: 'web/tests/answer-markdown.test.tsx::renders GFM markdown as real DOM elements',
  },
  {
    id: 'frontend.answer-xss-safe',
    claim:
      'raw HTML in the LLM answer stays escaped (no rehype-raw) and dangerous URL schemes are neutralized',
    layer: 'frontend',
    gateTest: 'web/tests/answer-markdown.test.tsx::escapes raw HTML in the answer',
  },
  {
    id: 'frontend.code-highlight',
    claim: 'code is tokenized with Shiki into colored token spans (non-vacuous)',
    layer: 'frontend',
    gateTest: 'web/tests/highlighter.test.ts::tokenizes known code into colored token spans',
  },
  {
    id: 'frontend.highlight-fallback',
    claim: 'an unknown language degrades to escaped plaintext without throwing',
    layer: 'frontend',
    gateTest:
      'web/tests/highlighter.test.ts::falls back to escaped plaintext for an unknown language',
  },
  {
    id: 'frontend.stream-safe',
    claim: 'a partial answer with an unterminated ``` fence renders contained (closeUnterminated)',
    layer: 'frontend',
    gateTest: 'web/tests/markdown-stream.test.ts::closes an odd (unterminated)',
  },
  {
    id: 'frontend.cited-span',
    claim: 'the source viewer bands ONLY the cited line-span, not every line (non-vacuous)',
    layer: 'frontend',
    gateTest: 'web/tests/source-viewer.test.tsx::bands ONLY the cited sub-range',
  },
  {
    id: 'frontend.trace-replay',
    claim:
      'the trace client subscribes /ws/trace?queryId= so a late subscriber gets the full L0→L5 replay, not only L5',
    layer: 'frontend',
    gateTest: 'web/tests/trace-socket.test.ts::opens /ws/trace WITH ?queryId=',
  },
]

// gateTest files are repo-root-relative (e.g. 'web/tests/x'); web's vitest cwd is web/, so strip
// the leading 'web/' and resolve against cwd.
function resolveRef(file: string): string {
  return join(process.cwd(), file.replace(/^web\//, ''))
}

// Mirror of the registry's audit rule (declared => backed + exercised).
function isBacked(gate: Gate): boolean {
  return (gate.gateTest ?? '').trim().length > 0 && gate.exercised !== false
}

describe('FRONTEND_GATES — anti-vacuity registry (web-side)', () => {
  it('declares a backed, unique gate per rendering/observability boundary', () => {
    expect(FRONTEND_GATES.length).toBeGreaterThanOrEqual(7)
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
