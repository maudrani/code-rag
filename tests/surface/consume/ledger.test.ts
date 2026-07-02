import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildEngine } from '../../../src/consume/actions.js'
import {
  JsonlLedgerSink,
  type LedgerOutcome,
  type LedgerSink,
  readLedger,
  readLedgerLines,
  resolveLedgerPath,
  withLedger,
} from '../../../src/consume/ledger.js'
import type { Consumer, QueryLogEntry } from '../../../src/contracts/telemetry.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'
import { makeProjection } from '../fixtures/projections.js'

const FIXTURE_CORPUS = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'cli',
  'fixtures',
  'corpus',
)

function entry(queryId: string, consumer: Consumer = 'cli'): QueryLogEntry {
  return {
    ts: 1,
    queryId,
    consumer,
    query: queryId,
    resultCount: 0,
    scoresByLeg: { bm25: 0, dense: 0, structural: 0 },
    band: 'answer',
    latencyMs: 1,
  }
}

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-'))
  file = join(dir, 'ledger.jsonl')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('JsonlLedgerSink + readLedger — round-trip (TKT-426)', () => {
  it('append then read: newest-first, with consumer + limit filters', () => {
    const sink = new JsonlLedgerSink(file)
    sink.append(entry('q1', 'cli'))
    sink.append(entry('q2', 'mcp'))
    sink.append(entry('q3', 'mcp'))

    expect(readLedger(file).map((e) => e.queryId)).toEqual(['q3', 'q2', 'q1']) // newest-first
    expect(readLedger(file, { consumer: 'mcp' }).map((e) => e.queryId)).toEqual(['q3', 'q2'])
    expect(readLedger(file, { limit: 1 }).map((e) => e.queryId)).toEqual(['q3'])
  })

  it('TOLERANT: skips a blank + malformed trailing line (a mid-flight append never throws)', () => {
    appendFileSync(file, `${JSON.stringify(entry('q1'))}\n`)
    appendFileSync(file, '\n') // blank
    appendFileSync(file, '{ this is not json') // partial/malformed (no newline — mid-write)
    expect(readLedger(file).map((e) => e.queryId)).toEqual(['q1']) // the good line survives
  })

  it('a missing file reads as [] (never throws)', () => {
    expect(readLedger(join(dir, 'nope.jsonl'))).toEqual([])
  })
})

describe('withLedger — the write decorator (TKT-426)', () => {
  it('appends the query’s OWN entry (matched by queryId, not newest), exactly once', async () => {
    const ledger = [entry('q1'), entry('q2')]
    const engine = {
      ...makeMockEngine(),
      query: async () => makeProjection({ queryId: 'q1' }), // resolves to the FIRST entry, not newest
      queryLog: () => ledger,
    }
    const appended: QueryLogEntry[] = []
    const sink: LedgerSink = { append: (e) => appended.push(e), appendOutcome: () => {} }

    await withLedger(engine, sink).query('q', [], 'cli')
    expect(appended).toHaveLength(1) // exactly once, no dup
    expect(appended[0]?.queryId).toBe('q1') // matched by queryId (q1), NOT the newest (q2)
  })

  it('does NOT append when the entry is not in the ledger (nothing to record)', async () => {
    const engine = {
      ...makeMockEngine(),
      query: async () => makeProjection({ queryId: 'q-absent' }),
      queryLog: () => [entry('q1')],
    }
    const appended: QueryLogEntry[] = []
    await withLedger(engine, {
      append: (e) => appended.push(e),
      appendOutcome: () => {},
    }).query('q', [], 'cli')
    expect(appended).toHaveLength(0)
  })
})

describe('L5 outcome — cross-process two-line join (FTR-3 P2, TKT-434)', () => {
  it('appendOutcome writes the 2nd line; readLedger merges it onto the retrieve line by queryId', () => {
    const sink = new JsonlLedgerSink(file)
    sink.append(entry('q1', 'cli')) // retrieve line — written at query-time, no outcome yet
    sink.appendOutcome({ queryId: 'q1', answered: true, tokens: 42, estCost: 0.001 })
    const [e] = readLedger(file)
    expect(e?.queryId).toBe('q1')
    expect(e?.answered).toBe(true)
    expect(e?.tokens).toBe(42)
    expect(e?.estCost).toBe(0.001)
  })

  it('reconciles across many queries, newest-first, outcome only on the matching queryId', () => {
    const sink = new JsonlLedgerSink(file)
    sink.append(entry('q1'))
    sink.append(entry('q2'))
    sink.appendOutcome({ queryId: 'q1', answered: true, tokens: 10, estCost: 0.002 })
    const out = readLedger(file)
    expect(out.map((e) => e.queryId)).toEqual(['q2', 'q1']) // newest-first by retrieve order
    expect(out.find((e) => e.queryId === 'q1')?.answered).toBe(true)
    expect(out.find((e) => e.queryId === 'q2')?.answered).toBeUndefined() // no outcome for q2
  })

  it('ORPHAN outcome (no retrieve line) is dropped — cannot reconstruct a full entry', () => {
    new JsonlLedgerSink(file).appendOutcome({ queryId: 'ghost', answered: true })
    expect(readLedger(file)).toEqual([])
  })

  it('a retrieve line with NO outcome (search/dry) passes through unchanged (answered undefined)', () => {
    new JsonlLedgerSink(file).append(entry('q-search'))
    const [e] = readLedger(file)
    expect(e?.answered).toBeUndefined()
    expect('answered' in (e ?? {})).toBe(false)
  })

  it('readLedgerLines exposes RAW append-order lines, tagged entry|outcome (the stream tail source)', () => {
    const sink = new JsonlLedgerSink(file)
    sink.append(entry('q1'))
    sink.appendOutcome({ queryId: 'q1', answered: true, tokens: 5, estCost: 0.001 })
    expect(readLedgerLines(file).map((l) => l.kind)).toEqual(['entry', 'outcome']) // NOT reconciled
  })

  it('withLedger wraps answer(): after the stream completes, the joined outcome is appended once', async () => {
    // the mock's queryLog() reflects the membrane's read-time join: the outcome only appears AFTER
    // answer() ran (answerByQueryId populated on the usage chunk).
    let ran = false
    const base = makeMockEngine()
    const engine = {
      ...base,
      query: async () => makeProjection({ queryId: 'qA' }),
      answer: async function* () {
        yield { type: 'token' as const, text: 'x' }
        ran = true
      },
      queryLog: () =>
        ran ? [{ ...entry('qA'), answered: true, tokens: 7, estCost: 0.003 }] : [entry('qA')],
    }
    const appended: QueryLogEntry[] = []
    const outcomes: LedgerOutcome[] = []
    const sink: LedgerSink = {
      append: (e) => appended.push(e),
      appendOutcome: (o) => outcomes.push(o),
    }
    const wrapped = withLedger(engine, sink)
    const projection = await wrapped.query('q', [], 'cli') // retrieve line (no outcome at query-time)
    const chunks = []
    for await (const c of wrapped.answer(projection, [])) chunks.push(c)

    expect(appended.map((e) => e.queryId)).toEqual(['qA'])
    expect(appended[0]?.answered).toBeUndefined() // retrieve line predates the outcome
    expect(outcomes).toEqual([{ queryId: 'qA', answered: true, tokens: 7, estCost: 0.003 }]) // once
  })

  it('CROSS-PROCESS: withLedger writes retrieve+outcome lines to a real file; a SEPARATE readLedger reconciles', async () => {
    // process A — the engine writes via a real JSONL sink: the query-time retrieve line, then the
    // answer-time outcome line. The FILE is the cross-process boundary (who wrote it doesn't matter).
    const sink = new JsonlLedgerSink(file)
    let ran = false
    const base = makeMockEngine()
    const engine = {
      ...base,
      query: async () => makeProjection({ queryId: 'qX' }),
      answer: async function* () {
        yield { type: 'token' as const, text: 'x' }
        ran = true
      },
      queryLog: () =>
        ran ? [{ ...entry('qX'), answered: true, tokens: 8, estCost: 0.005 }] : [entry('qX')],
    }
    const wrapped = withLedger(engine, sink)
    const projection = await wrapped.query('q', [], 'cli')
    const chunks = []
    for await (const c of wrapped.answer(projection, [])) chunks.push(c)

    // process B — a SEPARATE reader of the same file reconciles the two lines by queryId (the bug:
    // a retrieve-only ledger showed every query as 'deterministic' with no tokens/cost).
    const [e] = readLedger(file)
    expect(e?.queryId).toBe('qX')
    expect(e?.answered).toBe(true)
    expect(e?.tokens).toBe(8)
    expect(e?.estCost).toBe(0.005)
  })
})

describe('resolveLedgerPath — env gate (TKT-426)', () => {
  it('reads CODE_RAG_LEDGER; undefined when unset or blank', () => {
    expect(resolveLedgerPath({ CODE_RAG_LEDGER: '/tmp/l.jsonl' })).toBe('/tmp/l.jsonl')
    expect(resolveLedgerPath({})).toBeUndefined()
    expect(resolveLedgerPath({ CODE_RAG_LEDGER: '   ' })).toBeUndefined()
  })
})

describe('buildEngine — sink wiring is env-gated (TKT-426 / SC-03)', () => {
  it('with CODE_RAG_LEDGER set, a query appends its entry to the shared file', async () => {
    const engine = buildEngine({ corpusPath: FIXTURE_CORPUS }, { CODE_RAG_LEDGER: file })
    await engine.query('probe-marker', [], 'cli')
    const entries = readLedger(file)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.query).toBe('probe-marker')
    expect(entries[0]?.consumer).toBe('cli')
  }, 30000)

  it('WITHOUT the env, no sink is wired — no file is written', async () => {
    const engine = buildEngine({ corpusPath: FIXTURE_CORPUS }, {})
    await engine.query('probe-marker', [], 'cli')
    expect(existsSync(file)).toBe(false) // env unset -> in-memory only, zero fs writes
  }, 30000)
})
