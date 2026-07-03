import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonlLedgerSink, withLedger } from '../../src/consume/index.js'
import type { AnswerChunk, Provider, QueryLogEntry, Turn } from '../../src/contracts/index.js'
import { buildApp } from '../../src/http/app.js'
import { createEngine } from '../../src/membrane/index.js'

/**
 * E2E-real BACKEND GATES (re-QA of the "done" claims, deterministic, heat-safe — dense OFF, no key).
 * Codifies three journeys the smoke doesn't cover, each asserted as an OUTCOME against the REAL
 * membrane + REAL retrieval over the fixture corpus:
 *
 *   1. multi-turn / L0 anaphora residue — a follow-up "how does it work" is rewritten to a standalone
 *      query via the provider.rewrite seam, then grounds (and a concrete-subject question is NOT rewritten).
 *   2. /symbols read-surface — the corpus symbols project to wire-safe identities (autocomplete + tree).
 *   3. cross-consumer /ledger — the shared-file funnel the WOW live listener reads: a query from every
 *      consumer lands in ONE file GET /ledger serves, tagged + reconciled. (The live SSE listener +
 *      the browser are the held, operator-coordinated part; this gates the deterministic backend of it.)
 */

const here = fileURLToPath(new URL('.', import.meta.url))
const CORPUS = join(here, 'fixtures', 'corpus')
const FIXED_NOW = 1_700_000_000_000
const GROUNDED = 'how does scoreGate work'

/** A deterministic fake LLM: fixed answer + fixed usage (tokens 20); rewrite is per-test. */
function fakeProvider(rewrite: (q: string) => string): Provider {
  return {
    async *answer(): AsyncIterable<AnswerChunk> {
      yield { type: 'token', text: 'ok' }
      yield { type: 'usage', inputTokens: 12, outputTokens: 8 }
    },
    async rewrite(q: string): Promise<string> {
      return rewrite(q)
    },
  }
}

describe('E2E gate — multi-turn / L0 anaphora residue', () => {
  it('rewrites an anaphoric follow-up via the provider.rewrite seam, then grounds to the real symbol', async () => {
    const provider = fakeProvider(() => 'how does scoreGate work') // resolve "it" -> the standalone query
    const engine = createEngine({
      corpusPath: CORPUS,
      provider,
      now: () => FIXED_NOW,
      dense: false,
    })
    const history: Turn[] = [
      { role: 'user', content: 'what is scoreGate' },
      { role: 'assistant', content: 'a deterministic gate.' },
    ]

    const p = await engine.query('how does it work', history, 'package') // "it" -> anaphora, needs rewrite

    expect(p.question).toBe('how does it work') // raw turn preserved
    expect(p.resolvedQuery).toBe('how does scoreGate work') // L0 rewrite happened (differs from the turn)
    expect(p.decision.band).toBe('answer') // the RESOLVED query grounds
    expect(p.results.some((r) => r.chunk.symbol === 'scoreGate')).toBe(true)
  })

  it('NON-VACUITY: a concrete-subject question is NOT rewritten (the gate suppresses a wasted call)', async () => {
    let rewriteCalls = 0
    const provider = fakeProvider(() => {
      rewriteCalls++
      return 'unused'
    })
    const engine = createEngine({
      corpusPath: CORPUS,
      provider,
      now: () => FIXED_NOW,
      dense: false,
    })
    const history: Turn[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hi' },
    ]

    const p = await engine.query('how does scoreGate work', history, 'package') // concrete subject

    expect(rewriteCalls).toBe(0) // deterministic gate suppressed the residue (no LLM call)
    expect(p.resolvedQuery).toBe('how does scoreGate work') // unchanged
  })
})

describe('E2E gate — /symbols read-surface (autocomplete + corpus tree)', () => {
  it('projects the REAL corpus symbols to wire-safe identities (no code/body)', async () => {
    const engine = createEngine({ corpusPath: CORPUS, dense: false })

    const symbols = await engine.symbols()

    expect(symbols.length).toBeGreaterThan(0)
    const scoreGate = symbols.find((s) => s.symbol === 'scoreGate')
    expect(scoreGate).toBeDefined()
    expect(scoreGate?.kind).toBe('function')
    expect(scoreGate?.lang).toBe('typescript')
    expect(scoreGate?.path.endsWith('scoreGate.ts')).toBe(true)
    expect((scoreGate?.span.startLine ?? 0) > 0).toBe(true)
    // the class is discoverable too (the client folds the corpus tree on `path`)
    expect(symbols.some((s) => s.symbol === 'QueryLedger' && s.kind === 'class')).toBe(true)
    // WIRE-SAFE: the projection strips the body/id/structuralRefs (SymbolEntry is identity only)
    expect(scoreGate).not.toHaveProperty('code')
    expect(scoreGate).not.toHaveProperty('structuralRefs')
    expect(scoreGate).not.toHaveProperty('id')
  })
})

describe('E2E gate — cross-consumer /ledger (the WOW listener backend)', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  function ledgerEngine(file: string) {
    const engine = createEngine({
      corpusPath: CORPUS,
      provider: fakeProvider((q) => q),
      now: () => FIXED_NOW,
      dense: false,
    })
    return withLedger(engine, new JsonlLedgerSink(file))
  }

  it('a query from EVERY consumer lands in ONE shared file that GET /ledger serves, tagged per consumer', async () => {
    dir = mkdtempSync(join(tmpdir(), 'qa-ledger-'))
    const file = join(dir, 'ledger.jsonl')
    const engine = ledgerEngine(file)

    for (const consumer of ['package', 'http', 'cli', 'mcp'] as const) {
      await engine.query(GROUNDED, [], consumer)
    }

    // the HTTP face reads the SHARED FILE (not this process's in-memory log) — the cross-process funnel
    const { app } = buildApp(engine, file)
    const res = await app.request('/ledger')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { entries: QueryLogEntry[] }
    expect(body.entries).toHaveLength(4)
    expect(new Set(body.entries.map((e) => e.consumer))).toEqual(
      new Set(['package', 'http', 'cli', 'mcp']),
    )

    // ?consumer= filter — the listener's per-consumer view
    const mcpRes = await app.request('/ledger?consumer=mcp')
    const mcpBody = (await mcpRes.json()) as { entries: QueryLogEntry[] }
    expect(mcpBody.entries).toHaveLength(1)
    expect(mcpBody.entries[0]?.consumer).toBe('mcp')
  })

  it('an ANSWERED query reconciles retrieve ⊕ L5 outcome across the file (FTR-3 P2)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'qa-ledger-'))
    const file = join(dir, 'ledger.jsonl')
    const engine = ledgerEngine(file)

    const p = await engine.query(GROUNDED, [], 'mcp')
    let streamed = ''
    for await (const chunk of engine.answer(p, [])) {
      if (chunk.type === 'token') streamed += chunk.text
    }
    expect(streamed.length).toBeGreaterThan(0) // the answer streamed -> the outcome line was appended

    const { app } = buildApp(engine, file)
    const body = (await (await app.request('/ledger')).json()) as { entries: QueryLogEntry[] }
    // the shared-file id is the in-process queryId namespaced per process (`<nonce>:<queryId>`), so it
    // ENDS WITH the wire p.queryId — this is what keeps two processes' `q1`s from colliding in the file.
    const entry = body.entries.find((e) => e.queryId.endsWith(`:${p.queryId}`))
    expect(entry).toBeDefined()
    expect(entry?.answered).toBe(true) // the 2nd (outcome) line reconciled onto the retrieve line
    expect(entry?.tokens).toBe(20)
    expect((entry?.estCost ?? 0) > 0).toBe(true)
  })

  it('NON-VACUITY: with no shared-ledger path, GET /ledger is gracefully empty (not the in-memory log)', async () => {
    const engine = createEngine({ corpusPath: CORPUS, dense: false })
    await engine.query(GROUNDED, [], 'package') // the in-memory log now has 1 entry...
    const { app } = buildApp(engine) // ...but NO ledgerPath is configured
    const body = (await (await app.request('/ledger')).json()) as { entries: QueryLogEntry[] }
    expect(body.entries).toHaveLength(0) // /ledger reads the shared FILE, not the in-memory log
  })
})
