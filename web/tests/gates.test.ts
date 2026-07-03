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
  {
    id: 'frontend.telemetry-render',
    claim:
      'the Observability tab renders per-layer telemetry (L1→L5) from GET /stats as real values',
    layer: 'frontend',
    gateTest: 'web/tests/observability-tab.test.tsx::renders per-layer telemetry from /stats',
  },
  {
    id: 'frontend.health-surface',
    claim: 'the GET /health status + per-check pass/fail render as an anti-vacuity health card',
    layer: 'frontend',
    gateTest: 'web/tests/observability-tab.test.tsx::renders the health status',
  },
  {
    id: 'frontend.retrieve-legs',
    claim:
      'the L4 retrieve card surfaces the 3-leg fused scores (bm25/dense/structural) — dense non-zero (FTR-53)',
    layer: 'frontend',
    gateTest: 'web/tests/observability-tab.test.tsx::renders the L4 per-leg scores',
  },
  {
    id: 'frontend.telemetry-empty',
    claim:
      'a null lastQuery renders an explicit empty state (no query yet), never a blank/crashed card',
    layer: 'frontend',
    gateTest:
      'web/tests/observability-tab.test.tsx::renders an empty state when there is no last query',
  },
  {
    id: 'frontend.telemetry-error',
    claim:
      'a failed /stats fetch renders an error + Retry and NOT the layer cards (branch, non-vacuous)',
    layer: 'frontend',
    gateTest:
      'web/tests/observability-tab.test.tsx::renders an error state with retry when /stats fails',
  },
  {
    id: 'frontend.health-down',
    claim: 'a 503 down health is surfaced as DATA (the client does not throw on !ok for /health)',
    layer: 'frontend',
    gateTest: 'web/tests/telemetry-client.test.ts::returns the down report on 503',
  },
  {
    id: 'frontend.mock-indicator',
    claim:
      'when the dev MOCK wire is active an unmissable "MOCK DATA" banner renders so a mock is never mistaken for a live backend',
    layer: 'frontend',
    gateTest:
      'web/tests/mock-data-banner.test.tsx::renders an unmissable MOCK DATA warning when active',
  },
  {
    id: 'frontend.cli-parity',
    claim:
      'each per-layer sub-tab shows the exact CLI command an agent would run (code-rag stats --layer X) — the CLI/MCP/HTTP parity thesis made visible',
    layer: 'frontend',
    gateTest: 'web/tests/observability-tab.test.tsx::shows the per-layer CLI command',
  },
  {
    id: 'frontend.corpus-tree',
    claim:
      'the assisted-search browser derives a nested directory tree from the flat GET /symbols paths (shared prefixes collapse, non-vacuous)',
    layer: 'frontend',
    gateTest:
      'web/tests/corpus-tree.test.tsx::buildCorpusTree turns flat paths into a nested dir tree',
  },
  {
    id: 'frontend.symbol-autocomplete',
    claim:
      'the symbol combobox narrows its options as the query prefix gets more specific (assisted search)',
    layer: 'frontend',
    gateTest: 'web/tests/symbol-combobox.test.tsx::prefix filter narrows the option list',
  },
  {
    id: 'frontend.live-listener',
    claim:
      'the Live tab renders a cross-consumer feed from GET /ledger/stream, tagging each arriving query by its consumer (the one-surface/N-consumers thesis, live)',
    layer: 'frontend',
    gateTest:
      'web/tests/live-listener-tab.test.tsx::renders arriving entries as a live feed tagged by consumer',
  },
  {
    id: 'frontend.web-consumer',
    claim:
      'the web stamps its queries with the `web` consumer identity (X-Consumer header) so surface attributes them to web (not raw http) in the cross-consumer ledger',
    layer: 'frontend',
    gateTest: 'web/tests/search-client.test.ts::identifies the browser as the `web` consumer',
  },
  {
    id: 'frontend.chat-telemetry',
    claim:
      'the chat trace rail renders the COMPLETE per-queryId telemetry (L0 rewrite, L3/L4 per-leg+fused+cosine, gate+model, L5 tokens+cost) assembled from the wire data the chat already holds',
    layer: 'frontend',
    gateTest: 'web/tests/trace-panel.test.tsx::renders the COMPLETE per-queryId telemetry',
  },
  {
    id: 'frontend.contrast-aa',
    claim:
      'ledger/outcome band labels use AA-approved design tokens — CI fails at the token level if a label drops below WCAG AA (the RULE-UI-001 deterministic leg; TKT-522/525)',
    layer: 'frontend',
    gateTest: 'web/tests/ui-verify.test.ts::PROVES the approved registry',
  },
  {
    id: 'frontend.live-entry-outcome',
    claim:
      'each Live entry shows its L5 outcome — the model, "deterministic", or "refused · $0" — driven by answered/model/band, never a false LLM claim (TKT-521)',
    layer: 'frontend',
    gateTest: 'web/tests/live-listener-tab.test.tsx::tags each entry with its L5 outcome',
  },
  {
    id: 'frontend.search-preview-inpane',
    claim:
      'the manual-search code preview renders inside a dedicated pane (split-pane), not appended at the page bottom (TKT-524)',
    layer: 'frontend',
    gateTest: 'web/tests/manual-search-tab.test.tsx::renders the code preview IN a dedicated pane',
  },
  {
    id: 'frontend.live-feed-scroll-owner',
    claim:
      'the Live feed owns its scroll (min-h-0 + overflow-y-auto) and cards carry a min-height, so entries never overflow-clip to nothing (TKT-530)',
    layer: 'frontend',
    gateTest: 'web/tests/live-listener-tab.test.tsx::the feed OWNS its scroll',
  },
  {
    id: 'frontend.badge-contrast-coverage',
    claim:
      'every consumer chip + StatusPill state tone meets WCAG AA on the card surface — the contrast gap beyond OUTCOME_TONES is closed (TKT-526)',
    layer: 'frontend',
    gateTest: 'web/tests/ui-verify.test.ts::every consumer + StatusPill tone meets AA',
  },
  {
    id: 'frontend.health-status-path',
    claim:
      'the HealthCard degraded/down + failing-check path renders with the correct Badge variant (never mounted before) (TKT-527)',
    layer: 'frontend',
    gateTest: 'web/tests/health-card.test.tsx::renders DOWN with the destructive variant',
  },
  {
    id: 'frontend.layout-structure',
    claim:
      'the chat transcript + observability section own their content in-pane (not detached at document end) — the TKT-524 structure class extended across views (TKT-528)',
    layer: 'frontend',
    gateTest: 'web/tests/a11y.test.tsx::the chat transcript is the content pane',
  },
  {
    id: 'frontend.untested-helpers',
    claim:
      'the observability pure helpers (coveragePct/freshnessTone) + the card empty branches are unit-tested across all branches (TKT-529)',
    layer: 'frontend',
    gateTest: 'web/tests/layer-cards.test.tsx::coveragePct: full / partial / zero-walked',
  },
  {
    id: 'frontend.token-single-source',
    claim:
      'no design token is defined in more than one CSS file — the cascade-order hole under the TKT-526 AA guarantee is closed by a source-scan guard (TKT-532)',
    layer: 'frontend',
    gateTest: 'web/tests/ui-verify.test.ts::no design token is defined in more than one CSS file',
  },
  {
    id: 'frontend.repo-ingest',
    claim:
      'pasting a git repo URL indexes it in-app (POST /ingest); on a 4xx the error shows and the PRIOR active-corpus chip is left unchanged — no context switch on failure (TKT-533)',
    layer: 'frontend',
    gateTest:
      'web/tests/ingest.test.tsx::a 4xx shows the error AND leaves the PRIOR active-corpus chip unchanged',
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
