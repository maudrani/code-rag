import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildEngine } from '../../../src/consume/actions.js'
import {
  JsonlLedgerSink,
  type LedgerSink,
  readLedger,
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
    const sink: LedgerSink = { append: (e) => appended.push(e) }

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
    await withLedger(engine, { append: (e) => appended.push(e) }).query('q', [], 'cli')
    expect(appended).toHaveLength(0)
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
