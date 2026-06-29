import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AnswerChunk, Projection, Turn } from '../../src/contracts/index.js'
import { createEngine } from '../../src/membrane/index.js'

// No network / API key in tests: mock the Claude provider. The deterministic path
// (ingest → retrieve → project) stays REAL; only the L5 answer/rewrite are faked.
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
let engine: ReturnType<typeof createEngine>

beforeAll(async () => {
  corpus = mkdtempSync(join(tmpdir(), 'membrane-corpus-'))
  writeFileSync(
    join(corpus, 'users.ts'),
    'export function getUserById(id: string): string {\n  return "user:" + id\n}\n',
  )
  writeFileSync(
    join(corpus, 'search.ts'),
    'export function parseQuery(raw: string): string {\n  return raw.trim().toLowerCase()\n}\n',
  )
  engine = createEngine({})
  await engine.ingest(corpus)
})

afterAll(() => {
  rmSync(corpus, { recursive: true, force: true })
})

describe('createEngine — ingest', () => {
  it('indexes the corpus and assembles the IngestReport', async () => {
    const report = await engine.ingest(corpus)
    expect(report.filesIndexed).toBe(2)
    expect(report.chunks).toBeGreaterThan(0)
    expect(report.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('createEngine — query (real deterministic path)', () => {
  it('retrieves, builds citations + context, and gates', async () => {
    const p = await engine.query('where is getUserById defined?', [], 'package')
    expect(p.results.length).toBeGreaterThan(0)
    expect(p.citations).toHaveLength(p.results.length)
    expect(p.context.assembled).toContain('getUserById')
    expect(p.context.tokensEst).toBeGreaterThan(0)
    expect(['answer', 'refuse']).toContain(p.decision.band)
    expect(p.resolvedQuery).toBe('where is getUserById defined?')
  })

  it('emits the L0→membrane layer sequence per query', async () => {
    const seen: { queryId: string; layer: string }[] = []
    const unsub = engine.on((e) => {
      seen.push({ queryId: e.queryId, layer: e.layer })
    })
    const p = await engine.query('list the functions', [], 'http')
    unsub()
    const layers = seen.filter((e) => e.queryId === p.queryId).map((e) => e.layer)
    expect(layers).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'membrane'])
  })

  it('runs the LLM rewrite residue only when the gate flags anaphora', async () => {
    const history: Turn[] = [
      { role: 'user', content: 'tell me about parseQuery' },
      { role: 'assistant', content: 'ok' },
    ]
    const p = await engine.query('how does it work?', history, 'package')
    expect(p.resolvedQuery).toBe('how does it work? :: resolved')
  })
})

describe('createEngine — answer (L5, mocked provider)', () => {
  it('streams tokens and emits the L5 cost event on the usage chunk', async () => {
    const base = await engine.query('where is getUserById?', [], 'package')
    const projection: Projection = {
      ...base,
      decision: { ...base.decision, band: 'answer', tier: 'cheap' },
    }
    const events: { layer: string; payload: unknown }[] = []
    const unsub = engine.on((e) => {
      events.push({ layer: e.layer, payload: e.payload })
    })
    const chunks: AnswerChunk[] = []
    for await (const c of engine.answer(projection, [])) chunks.push(c)
    unsub()
    expect(chunks.some((c) => c.type === 'token')).toBe(true)
    expect(chunks.some((c) => c.type === 'usage')).toBe(true)
    const l5 = events.find((e) => e.layer === 'L5')
    expect(l5).toBeDefined()
    expect((l5?.payload as { estCost: number }).estCost).toBeGreaterThan(0)
  })

  it('yields nothing when the gate refuses (provider never called)', async () => {
    const base = await engine.query('where is getUserById?', [], 'package')
    const projection: Projection = { ...base, decision: { ...base.decision, band: 'refuse' } }
    const chunks: AnswerChunk[] = []
    for await (const c of engine.answer(projection, [])) chunks.push(c)
    expect(chunks).toHaveLength(0)
  })
})
