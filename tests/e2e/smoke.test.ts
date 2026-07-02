import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type RunDeps, run } from '../../src/cli/run.js'
import type { AnswerChunk, Provider, QueryLogEntry } from '../../src/contracts/index.js'
import { buildApp } from '../../src/http/app.js'
import { searchTool } from '../../src/mcp/tools.js'
import { createEngine } from '../../src/membrane/index.js'

/**
 * E2E-REAL SMOKE (TKT-602 / FTR-4) — the missing top of the test pyramid, and the systemic hole the
 * operator's 9 bugs proved: every layer was green against mocks, but nothing ran the REAL stack over a
 * REAL corpus end-to-end. This asserts the full user journey as OUTCOMES (not internals):
 *
 *   1. search finds a REAL symbol in real code (grounded retrieval),
 *   2. ask returns a grounded answer with citations + a deterministic tokens/estCost,
 *   3. an off-corpus question REFUSES (no grounding -> no hallucination, zero cost),
 *   4. the SAME query via package + HTTP + CLI + MCP lands ONE connected retrieval in ONE ledger,
 *      each entry carrying the full per-query record.
 *
 * Determinism (runs in CI, no network, no ONNX): the TKT-003 provider seam (a fake L5), the TKT-004
 * clock seam (a fixed now), a small-but-real fixture corpus, and dense OFF. The smoke IS the E2E
 * acceptance of those seams. A RUN_SLOW variant (bottom) proves the REAL thing (real ONNX + real Claude).
 */

const here = fileURLToPath(new URL('.', import.meta.url))
const CORPUS = join(here, 'fixtures', 'corpus')

/** A fixed clock (TKT-004 seam) -> deterministic ts/latencyMs in the ledger. */
const FIXED_NOW = 1_700_000_000_000

const GROUNDED = 'how does scoreGate work'
const OFF_CORPUS = 'how does postgres streaming replication failover work'

/** A deterministic fake LLM (TKT-003 seam): fixed answer + fixed usage -> tokens 20, no network/key. */
function fakeProvider(text: string): Provider {
  return {
    async *answer(): AsyncIterable<AnswerChunk> {
      yield { type: 'token', text }
      yield { type: 'usage', inputTokens: 12, outputTokens: 8 } // 12 + 8 = 20 tokens, deterministic
    },
    async rewrite(q: string): Promise<string> {
      return q // identity: no anaphora residue in the smoke
    },
  }
}

/** The engine under test: REAL corpus + REAL retrieval, fake L5 + fixed clock, dense OFF (no ONNX, no key). */
function makeEngine(
  answer = 'scoreGate refuses below the grounding floor, else routes by complexity.',
) {
  return createEngine({
    corpusPath: CORPUS,
    provider: fakeProvider(answer),
    now: () => FIXED_NOW,
    dense: false,
  })
}

function silentRunDeps(engine: ReturnType<typeof makeEngine>): RunDeps {
  return {
    buildEngine: () => engine,
    stdout: { write: () => true },
    stderr: { write: () => true },
    env: { NO_COLOR: '1' },
  }
}

/** The retrieval fingerprint of a ledger entry — identical across consumers iff they share one engine. */
function fingerprint(e: QueryLogEntry) {
  return { query: e.query, resultCount: e.resultCount, band: e.band, scoresByLeg: e.scoresByLeg }
}

describe('E2E-real smoke — deterministic full-stack journey (TKT-602)', () => {
  it('search finds a REAL symbol in the corpus (grounded, dense OFF)', async () => {
    const engine = makeEngine()
    const p = await engine.query(GROUNDED, [], 'package')

    expect(p.decision.band).toBe('answer') // grounded -> the gate answers, not refuses
    expect(p.results.length).toBeGreaterThan(0) // real retrieval happened (non-vacuous)
    expect(p.results.some((r) => r.chunk.symbol === 'scoreGate')).toBe(true) // the queried REAL symbol
    expect(p.citations.some((c) => c.path.endsWith('scoreGate.ts'))).toBe(true) // clickable citation -> real file
  })

  it('ask returns a grounded answer with citations + deterministic tokens/estCost (fake L5, fixed clock)', async () => {
    const engine = makeEngine()
    const p = await engine.query(GROUNDED, [], 'package')
    expect(p.decision.band).toBe('answer')
    expect(p.citations.length).toBeGreaterThan(0)

    let streamed = ''
    for await (const chunk of engine.answer(p, [])) {
      if (chunk.type === 'token') streamed += chunk.text
    }
    expect(streamed.length).toBeGreaterThan(0) // the answer streamed via the fake, deterministically

    const entry = engine.queryLog()[0]
    if (!entry) throw new Error('expected a ledger entry')
    // the FULL per-query record (the ticket's core ask): answered + tokens + estCost + tier + model
    expect(entry.answered).toBe(true)
    expect(entry.tokens).toBe(20) // 12 + 8 from the fake usage -> deterministic
    expect(entry.estCost).toBeGreaterThan(0)
    expect(entry.tier === 'cheap' || entry.tier === 'strong').toBe(true)
    expect(typeof entry.model).toBe('string')
    expect((entry.model ?? '').length).toBeGreaterThan(0)
    // the fixed clock seam (TKT-004) makes observability deterministic, end-to-end
    expect(entry.ts).toBe(FIXED_NOW)
    expect(entry.latencyMs).toBe(0) // constant now() -> zero elapsed, deterministically
  })

  it('refuses an OFF-corpus question (no grounding -> no hallucination, zero cost)', async () => {
    const engine = makeEngine()
    await engine.query(OFF_CORPUS, [], 'package')

    const entry = engine.queryLog()[0]
    if (!entry) throw new Error('expected a ledger entry')
    expect(entry.band).toBe('refuse') // below the grounding floor
    // a refused query records the refusal HONESTLY as a zero-cost L5 outcome (answered:false, 0/0) —
    // distinct from a search-only query, whose L5 fields stay UNDEFINED (proven in the consumer test below).
    expect(entry.answered).toBe(false)
    expect(entry.tokens).toBe(0)
    expect(entry.estCost).toBe(0)
  })

  it('one connected retrieval across package + HTTP + CLI + MCP, in ONE ledger, tagged per consumer', async () => {
    const engine = makeEngine()

    await engine.query(GROUNDED, [], 'package') // package (in-process)
    const { app } = buildApp(engine)
    await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: GROUNDED }),
    }) // HTTP
    await run(['ask', GROUNDED, '--dry'], silentRunDeps(engine)) // CLI (--dry: deterministic, no L5)
    await searchTool(engine, { query: GROUNDED }) // MCP

    const log = engine.queryLog()
    expect(log).toHaveLength(4)
    expect(new Set(log.map((e) => e.consumer))).toEqual(new Set(['package', 'http', 'cli', 'mcp']))

    // the SAME query yields the SAME retrieval on every consumer (one membrane, not four engines)
    const pkg = log.find((e) => e.consumer === 'package')
    if (!pkg) throw new Error('no package ledger entry')
    expect(pkg.resultCount).toBeGreaterThan(0) // non-vacuous
    for (const consumer of ['http', 'cli', 'mcp'] as const) {
      const e = log.find((x) => x.consumer === consumer)
      if (!e) throw new Error(`no ${consumer} ledger entry`)
      expect(fingerprint(e)).toEqual(fingerprint(pkg))
    }

    // FTR-3 P2 invariant, E2E: a search-only journey records NO answered/tokens (answer() never ran).
    for (const e of log) {
      expect(e.answered).toBeUndefined()
      expect(e.tokens).toBeUndefined()
    }
  })

  it('NON-VACUITY: a second engine has its OWN ledger (per-engine wiring, not a global singleton)', async () => {
    const a = makeEngine()
    const b = makeEngine()
    await a.query(GROUNDED, [], 'package')
    expect(a.queryLog()).toHaveLength(1)
    expect(b.queryLog()).toHaveLength(0) // isolated -> the connectivity above is real wiring, not a global
  })
})

/**
 * LIVE variant (RUN_SLOW) — the REAL thing: real ONNX dense + real Claude. Off CI (heat + cost + flake),
 * ONE onnx process (coordinate the slot per the heat rule). Run locally/operator with an ANTHROPIC_API_KEY.
 */
describe.skipIf(!process.env.RUN_SLOW)(
  'E2E-real smoke — LIVE variant (RUN_SLOW: real ONNX + real Claude)',
  () => {
    it('a real grounded answer over a real corpus, dense ON, real provider', async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('RUN_SLOW live variant needs ANTHROPIC_API_KEY')
      const engine = createEngine({ corpusPath: CORPUS, dense: true, apiKey })

      const p = await engine.query(GROUNDED, [], 'package')
      expect(p.decision.band).toBe('answer')
      expect(p.results.some((r) => r.chunk.symbol === 'scoreGate')).toBe(true)

      let streamed = ''
      for await (const chunk of engine.answer(p, [])) {
        if (chunk.type === 'token') streamed += chunk.text
      }
      expect(streamed.length).toBeGreaterThan(0) // a REAL grounded answer streamed from Claude

      const entry = engine.queryLog()[0]
      if (!entry) throw new Error('expected a ledger entry')
      expect(entry.answered).toBe(true)
      expect(entry.tokens).toBeGreaterThan(0)
      expect(entry.estCost).toBeGreaterThan(0)
    }, 120_000)
  },
)
