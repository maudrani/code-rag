/**
 * FRONTEND_GATES — the anti-vacuity registry entries for the frontend (web) row (FTR-52).
 * Mirrors INGEST_GATES / SURFACE_GATES (observability design §6 / demonstrate-deterministically
 * P4): every DECLARED behavior of this layer maps to a STANDING, resolvable test that fails when
 * the behavior breaks, so "declared but not gated" is a build failure by construction.
 *
 * The `Gate` shape is a STRUCTURAL mirror of src/registry.ts (NOT an import): the browser app is
 * decoupled from the Node side (web ⊥ surface — it never imports a Node module), so it cannot
 * import the Node registry. The master folds `...FRONTEND_GATES` into the central seed (one line);
 * structural typing makes this array assignable to the registry's Gate[]. Each `gateTest` is
 * `<file>::<case>` where <case> is a real substring of a real test title — web/tests/gates.test.ts
 * PHANTOM-GUARDS every reference (a typo can't pass vacuously under the step-1 exercised model).
 */
export interface Gate {
  id: string
  claim: string
  layer: string
  gateTest?: string
  exercised?: boolean
}

export const FRONTEND_GATES: Gate[] = [
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
]
