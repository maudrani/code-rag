import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AnswerChunk, Projection } from '../../src/contracts/index.js'
import { createEngine } from '../../src/membrane/index.js'

// No network / API key in tests: mock the Claude provider. The deterministic path
// (ingest → retrieve → project) stays REAL; only the L5 answer/rewrite are faked.
// Mirrors tests/membrane/engine.test.ts so the telemetry seam is exercised over the
// SAME real L0–L4 pipeline the observability layer wraps.
vi.mock('../../src/provider/claude.js', () => ({
  createClaudeProvider: () => ({
    answer: async function* () {
      yield { type: 'token', text: 'getUserById ' }
      yield { type: 'token', text: 'looks up a user.' }
      yield { type: 'usage', inputTokens: 120, outputTokens: 18 }
    },
    rewrite: async (q: string) => `${q} :: resolved`,
  }),
}))

let corpus: string

beforeAll(() => {
  corpus = mkdtempSync(join(tmpdir(), 'membrane-telemetry-'))
  writeFileSync(
    join(corpus, 'users.ts'),
    'export function getUserById(id: string): string {\n  return "user:" + id\n}\n',
  )
  writeFileSync(
    join(corpus, 'search.ts'),
    'export function parseQuery(raw: string): string {\n  return raw.trim().toLowerCase()\n}\n',
  )
})

afterAll(() => {
  rmSync(corpus, { recursive: true, force: true })
})

// A fresh, real engine with a clean ledger/buffer over the tiny fixture corpus.
async function freshEngine(): Promise<ReturnType<typeof createEngine>> {
  const engine = createEngine({})
  await engine.ingest(corpus)
  return engine
}

describe('replay() — the late-subscriber race fix (ring buffer)', () => {
  it('returns the buffered L0–L4 events for a query even with NO prior on() subscription', async () => {
    const engine = await freshEngine()
    // We NEVER call engine.on() before the query: the membrane's own internal subscription
    // is what fills the buffer. This is precisely the race a late on() subscriber loses to.
    const p = await engine.query('where is getUserById defined?', [], 'package')
    const events = engine.replay(p.queryId)
    const layers = new Set(events.map((e) => e.layer))
    // NON-VACUOUS: every deterministic L0–L4 layer must be present (this PROVES the fix —
    // a drained/empty buffer would be missing them).
    for (const layer of ['L0', 'L1', 'L2', 'L3', 'L4'] as const) {
      expect(layers.has(layer)).toBe(true)
    }
    expect(events.length).toBeGreaterThanOrEqual(5)
    expect(events.every((e) => e.queryId === p.queryId)).toBe(true)
  })

  it('FAILURE TWIN: returns [] for a queryId that was never buffered', async () => {
    const engine = await freshEngine()
    expect(engine.replay('q-never-existed')).toEqual([])
  })

  it('evicts the oldest queryId beyond the buffer cap (~50)', async () => {
    const engine = await freshEngine()
    const first = await engine.query('first getUserById lookup', [], 'package')
    expect(engine.replay(first.queryId).length).toBeGreaterThan(0) // buffered now
    // Run > cap more queries to force eviction of the oldest (`first`).
    let recent = first
    for (let i = 0; i < 55; i++) recent = await engine.query(`parseQuery ${i}`, [], 'package')
    expect(engine.replay(first.queryId)).toEqual([]) // evicted (oldest beyond cap)
    expect(engine.replay(recent.queryId).length).toBeGreaterThan(0) // recent retained (non-vacuous)
  })
})

describe('ledger — consumer tagging (ConsumerIntent === Consumer)', () => {
  it('tags each query with its transport identity, unchanged', async () => {
    const engine = await freshEngine()
    await engine.query('getUserById', [], 'cli')
    await engine.query('parseQuery', [], 'http')
    await engine.query('getUserById', [], 'mcp')
    await engine.query('parseQuery', [], 'package')
    const consumers = engine.queryLog().map((e) => e.consumer)
    expect(consumers).toContain('cli')
    expect(consumers).toContain('http')
    expect(consumers).toContain('mcp')
    expect(consumers).toContain('package')
  })

  it('FAILURE TWIN: the ledger consumer is EXACTLY the intent — never invented or dropped', async () => {
    const engine = await freshEngine()
    await engine.query('getUserById', [], 'cli')
    const consumers = engine.queryLog().map((e) => e.consumer)
    expect(consumers).toEqual(['cli'])
  })
})

describe('queryLog() — newest-first, filter, limit', () => {
  it('returns entries newest-first', async () => {
    const engine = await freshEngine()
    const a = await engine.query('getUserById', [], 'package')
    const b = await engine.query('parseQuery', [], 'package')
    const log = engine.queryLog()
    expect(log[0]?.queryId).toBe(b.queryId) // newest first
    expect(log[1]?.queryId).toBe(a.queryId)
  })

  it('filters by consumer and limits', async () => {
    const engine = await freshEngine()
    await engine.query('getUserById', [], 'mcp')
    await engine.query('parseQuery', [], 'http')
    await engine.query('getUserById', [], 'mcp')
    expect(engine.queryLog({ consumer: 'mcp' })).toHaveLength(2)
    expect(engine.queryLog({ consumer: 'http' })).toHaveLength(1)
    expect(engine.queryLog({ limit: 1 })).toHaveLength(1)
  })

  it('FAILURE TWIN: a consumer with no queries yields an empty log', async () => {
    const engine = await freshEngine()
    await engine.query('getUserById', [], 'package')
    expect(engine.queryLog({ consumer: 'web' })).toEqual([])
  })

  it('records resultCount, band, latency, and the top result per-leg scores', async () => {
    const engine = await freshEngine()
    const p = await engine.query('where is getUserById defined?', [], 'package')
    const entry = engine.queryLog()[0]
    expect(entry?.queryId).toBe(p.queryId)
    expect(entry?.resultCount).toBe(p.results.length)
    expect(['answer', 'refuse']).toContain(entry?.band)
    expect(typeof entry?.scoresByLeg.bm25).toBe('number')
    expect(typeof entry?.scoresByLeg.dense).toBe('number')
    expect(typeof entry?.scoresByLeg.structural).toBe('number')
    expect(entry?.scoresByLeg).toEqual(p.results[0]?.scores) // mirrors the TOP result
    expect(entry?.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('FAILURE TWIN: defaults scoresByLeg to zeros when a query retrieves nothing', async () => {
    const engine = await freshEngine()
    // alien tokens match no symbol/code in the fixture -> 0 results on every leg.
    const p = await engine.query('zzzqqq wxyz vvbbnn', [], 'package')
    expect(p.results).toHaveLength(0) // the path is real, not branched-around
    const entry = engine.queryLog()[0]
    expect(entry?.resultCount).toBe(0)
    expect(entry?.scoresByLeg).toEqual({ bm25: 0, dense: 0, structural: 0 })
    expect(entry?.band).toBe('refuse')
  })
})

describe('telemetry() — the holding snapshot + honest invariants', () => {
  it('reports ingest/index after ingest; lastQuery only after a query', async () => {
    const engine = await freshEngine()
    const t0 = engine.telemetry()
    expect(t0.lastQuery).toBeNull() // no query yet

    const ing = t0.ingest
    expect(ing).not.toBeNull()
    if (ing) {
      expect(ing.filesIndexed).toBe(2)
      expect(ing.chunks).toBeGreaterThan(0)
      expect(ing.skipped).toBe(0)
      expect(ing.errors).toEqual([])
      // the IngestTelemetry invariant — honest with skipped=0, errors=[]:
      expect(ing.filesWalked).toBe(ing.filesIndexed + ing.skipped + ing.errors.length)
      expect(ing.byLang.typescript).toBeGreaterThan(0)
      // ingest IS the collectIngestTelemetry output: its FILE-level byLang obeys that collector's
      // Σ byLang === filesIndexed invariant (on a multi-chunk-per-file corpus this also separates it
      // from a chunk-level count). The genuine non-vacuous twin for ingest is the un-ingested null below.
      expect(Object.values(ing.byLang).reduce((a, b) => a + b, 0)).toBe(ing.filesIndexed)
      expect(ing.durationMs).toBeGreaterThanOrEqual(0)
    }

    const idx = t0.index
    expect(idx).not.toBeNull()
    if (idx) {
      expect(idx.docs).toBe(ing?.chunks) // docs === chunk count
      expect(idx.sizeBytes).toBeNull() // live index is :memory:
      expect(idx.builtAt).toBeGreaterThan(0)
      expect(idx.staleMs).toBeGreaterThanOrEqual(0)
    }

    // chunk IS the collectChunkTelemetry output — NON-NULL after ingest (replaces `chunk: null`).
    const chk = t0.chunk
    expect(chk).not.toBeNull()
    if (chk) {
      expect(chk.count).toBe(ing?.chunks) // L2 count agrees with the ingest chunk total
      expect(chk.count).toBeGreaterThan(0)
      expect(typeof chk.glueFallbacks).toBe('number') // a richer, chunk-derived field
      expect(chk.byLang.typescript).toBeGreaterThan(0)
    }

    const p = await engine.query('where is getUserById?', [], 'package')
    const t1 = engine.telemetry()
    expect(t1.lastQuery?.retrieve.queryId).toBe(p.queryId)
    expect(t1.lastQuery?.answer).toBeNull() // answer() was not called
  })

  it('FAILURE TWIN: a fresh un-ingested engine reports null ingest/chunk/index/lastQuery', () => {
    const engine = createEngine({})
    const t = engine.telemetry()
    expect(t.ingest).toBeNull()
    expect(t.chunk).toBeNull() // non-vacuous pair: chunk is null BEFORE ingest, non-null after
    expect(t.index).toBeNull()
    expect(t.lastQuery).toBeNull()
  })

  it('captures AnswerTelemetry on lastQuery.answer after answer() streams its usage', async () => {
    const engine = await freshEngine()
    const base = await engine.query('where is getUserById?', [], 'package')
    const projection: Projection = {
      ...base,
      decision: { ...base.decision, band: 'answer', tier: 'cheap' },
    }
    const chunks: AnswerChunk[] = []
    for await (const c of engine.answer(projection, [])) chunks.push(c)
    expect(chunks.length).toBeGreaterThan(0)

    const lq = engine.telemetry().lastQuery
    expect(lq?.answer).not.toBeNull()
    expect(lq?.answer?.band).toBe('answer')
    expect(lq?.answer?.tier).toBe('cheap')
    expect(lq?.answer?.tokens).toBe(138) // 120 + 18 (mock usage)
    expect(lq?.answer?.estCost).toBeGreaterThan(0)
    expect(typeof lq?.answer?.model).toBe('string')
  })

  it('FAILURE TWIN: lastQuery.answer stays null for a query that never ran answer()', async () => {
    const engine = await freshEngine()
    // run a query WITH a prior answered query to prove answer is not stale-attached:
    const answered = await engine.query('where is getUserById?', [], 'package')
    const proj: Projection = {
      ...answered,
      decision: { ...answered.decision, band: 'answer', tier: 'cheap' },
    }
    for await (const _c of engine.answer(proj, [])) {
      /* drain */
    }
    expect(engine.telemetry().lastQuery?.answer).not.toBeNull()
    // a NEWER query (no answer()) must reset lastQuery.answer to null (honest association)
    await engine.query('parseQuery', [], 'package')
    expect(engine.telemetry().lastQuery?.answer).toBeNull()
  })

  it('REFUSE path: a refused query records a ZERO-COST AnswerTelemetry (the "$0 spent" story)', async () => {
    const engine = await freshEngine()
    // alien tokens ground nothing -> band 'refuse', 0 results; answer() never runs (provider throws).
    const refused = await engine.query('zzzqqq wxyz vvbbnn', [], 'package')
    const lq = engine.telemetry().lastQuery
    expect(lq?.retrieve.queryId).toBe(refused.queryId)
    expect(lq?.retrieve.band).toBe('refuse')
    // OBSERVABLE now: the refuse attaches a real, zero-cost L5 record instead of null. NON-VACUOUS
    // vs the sibling test where a NON-refused query with no answer() leaves lastQuery.answer null:
    // the only difference is the band, which proves the refuse path is what records this.
    expect(lq?.answer).not.toBeNull()
    expect(lq?.answer?.band).toBe('refuse')
    expect(lq?.answer?.tokens).toBe(0)
    expect(lq?.answer?.estCost).toBe(0) // a refuse can never have spent anything
  })
})

describe('health()', () => {
  it('is ok with indexed + provider checks after ingest', async () => {
    const engine = await freshEngine()
    const h = engine.health()
    expect(h.status).toBe('ok')
    expect(h.checks.indexed?.ok).toBe(true)
    expect(typeof h.checks.provider?.ok).toBe('boolean')
    expect(h.ts).toBeGreaterThan(0)
  })

  it('FAILURE TWIN: degraded before indexing', () => {
    const engine = createEngine({})
    const h = engine.health()
    expect(h.status).toBe('degraded')
    expect(h.checks.indexed?.ok).toBe(false)
  })
})
