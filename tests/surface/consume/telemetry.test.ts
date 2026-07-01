import { describe, expect, it, vi } from 'vitest'
import {
  CONSUMERS,
  getHealth,
  getLog,
  getLogPayload,
  getStats,
  getSymbols,
  getSymbolsPayload,
  isConsumer,
  isStatsLayer,
  STATS_LAYERS,
  selectLayer,
} from '../../../src/consume/telemetry.js'
import type {
  AnswerTelemetry,
  Consumer,
  EngineTelemetry,
  Event,
  HealthReport,
  Observable,
  QueryLogEntry,
  SymbolEntry,
} from '../../../src/contracts/index.js'

// ─── fixtures — a fully-populated holding snapshot + an empty one ──────────────
const RETRIEVE: QueryLogEntry = {
  ts: 2000,
  queryId: 'q1',
  consumer: 'cli',
  query: 'how does retrieve work',
  resultCount: 3,
  scoresByLeg: { bm25: 0.5, dense: 0, structural: 0.2 },
  band: 'answer',
  latencyMs: 12,
}
const ANSWER: AnswerTelemetry = {
  band: 'answer',
  tier: 'cheap',
  model: 'claude-haiku-4-5',
  tokens: 120,
  estCost: 0.0012,
}
const FULL: EngineTelemetry = {
  ingest: {
    filesWalked: 10,
    filesIndexed: 10,
    skipped: 0,
    chunks: 42,
    byLang: { ts: 42 },
    errors: [],
    durationMs: 5,
  },
  chunk: { count: 42, byKind: { function: 30, class: 12 }, byLang: { ts: 42 }, glueFallbacks: 1 },
  index: { docs: 42, sizeBytes: null, builtAt: 1000, staleMs: 50 },
  lastQuery: { retrieve: RETRIEVE, answer: ANSWER },
}
const EMPTY: EngineTelemetry = { ingest: null, chunk: null, index: null, lastQuery: null }
const REFUSED: EngineTelemetry = {
  ingest: FULL.ingest,
  chunk: FULL.chunk,
  index: FULL.index,
  lastQuery: { retrieve: { ...RETRIEVE, band: 'refuse' }, answer: null },
}

const HEALTH: HealthReport = {
  status: 'ok',
  checks: { indexed: { ok: true }, provider: { ok: false, detail: 'no key' } },
  ts: 3000,
}
const LEDGER: QueryLogEntry[] = [RETRIEVE, { ...RETRIEVE, queryId: 'q2', consumer: 'mcp' }]
const SYMBOLS: SymbolEntry[] = [
  {
    path: 'a.ts',
    symbol: 'foo',
    kind: 'function',
    lang: 'typescript',
    span: { startLine: 1, endLine: 9 },
  },
  {
    path: 'b.ts',
    symbol: 'Bar',
    kind: 'class',
    lang: 'typescript',
    span: { startLine: 3, endLine: 40 },
  },
]

/** A minimal Observable stub — fixed output, spy-able. */
function stubObservable(over: Partial<Observable> = {}): Observable {
  return {
    telemetry: vi.fn(() => FULL),
    health: vi.fn(() => HEALTH),
    replay: vi.fn((_: string): Event[] => []),
    queryLog: vi.fn((_?: { consumer?: Consumer; limit?: number }) => LEDGER),
    symbols: vi.fn(async () => []),
    ...over,
  }
}

describe('consume/telemetry — the read-surface SSOT (TKT-417)', () => {
  describe('STATS_LAYERS / isStatsLayer', () => {
    it('exposes exactly the layers EngineTelemetry holds', () => {
      expect([...STATS_LAYERS]).toEqual(['ingest', 'chunk', 'index', 'retrieve', 'answer'])
    })
    it('isStatsLayer accepts a valid layer and rejects anything else', () => {
      expect(isStatsLayer('retrieve')).toBe(true)
      expect(isStatsLayer('chunk')).toBe(true)
      expect(isStatsLayer('membrane')).toBe(false) // NOT in the holding snapshot
      expect(isStatsLayer('L5')).toBe(false)
      expect(isStatsLayer('')).toBe(false)
    })
    it('CONSUMERS / isConsumer guards the ledger filter', () => {
      expect([...CONSUMERS]).toEqual(['web', 'http', 'cli', 'mcp', 'package'])
      expect(isConsumer('mcp')).toBe(true)
      expect(isConsumer('cli')).toBe(true)
      expect(isConsumer('agent')).toBe(false)
      expect(isConsumer('')).toBe(false)
    })
  })

  describe('selectLayer — project the snapshot to one layer', () => {
    it('maps each layer to its struct on a full snapshot', () => {
      expect(selectLayer(FULL, 'ingest')).toBe(FULL.ingest)
      expect(selectLayer(FULL, 'chunk')).toBe(FULL.chunk)
      expect(selectLayer(FULL, 'index')).toBe(FULL.index)
      expect(selectLayer(FULL, 'retrieve')).toBe(RETRIEVE)
      expect(selectLayer(FULL, 'answer')).toBe(ANSWER)
    })
    it('returns null (not undefined, not throw) when a layer has no data', () => {
      expect(selectLayer(EMPTY, 'ingest')).toBeNull()
      expect(selectLayer(EMPTY, 'chunk')).toBeNull()
      expect(selectLayer(EMPTY, 'index')).toBeNull()
      expect(selectLayer(EMPTY, 'retrieve')).toBeNull()
      expect(selectLayer(EMPTY, 'answer')).toBeNull()
    })
    it('returns null for answer on a refused query (no L5 telemetry)', () => {
      expect(selectLayer(REFUSED, 'answer')).toBeNull()
      expect(selectLayer(REFUSED, 'retrieve')).toEqual({ ...RETRIEVE, band: 'refuse' })
    })
  })

  describe('getStats — full snapshot or one projected layer', () => {
    it('returns the full EngineTelemetry when no layer is given', () => {
      const engine = stubObservable()
      expect(getStats(engine)).toBe(FULL)
      expect(engine.telemetry).toHaveBeenCalledTimes(1)
    })
    it('returns { layer, data } when a layer is given', () => {
      const engine = stubObservable()
      expect(getStats(engine, 'index')).toEqual({ layer: 'index', data: FULL.index })
    })
    it('carries null data through for an empty layer', () => {
      const engine = stubObservable({ telemetry: vi.fn(() => EMPTY) })
      expect(getStats(engine, 'retrieve')).toEqual({ layer: 'retrieve', data: null })
    })
    it('is wire-safe: JSON round-trips unchanged', () => {
      const engine = stubObservable()
      const payload = getStats(engine, 'retrieve')
      expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)
    })
  })

  describe('getHealth / getLog — thin delegations over Observable', () => {
    it('getHealth returns the HealthReport verbatim', () => {
      const engine = stubObservable()
      expect(getHealth(engine)).toBe(HEALTH)
      expect(engine.health).toHaveBeenCalledTimes(1)
    })
    it('getLog forwards { consumer, limit } to the engine and returns its entries', () => {
      const queryLog = vi.fn(() => LEDGER)
      const engine = stubObservable({ queryLog })
      expect(getLog(engine, { consumer: 'mcp', limit: 5 })).toBe(LEDGER)
      expect(queryLog).toHaveBeenCalledWith({ consumer: 'mcp', limit: 5 })
    })
    it('getLog with no opts calls the engine with no filter', () => {
      const queryLog = vi.fn(() => LEDGER)
      const engine = stubObservable({ queryLog })
      expect(getLog(engine)).toBe(LEDGER)
      expect(queryLog).toHaveBeenCalledWith(undefined)
    })
    it('getLogPayload wraps the ledger in { entries } (the MCP-safe parity shape)', () => {
      const engine = stubObservable()
      expect(getLogPayload(engine)).toEqual({ entries: LEDGER })
    })
  })

  describe('getSymbols / getSymbolsPayload — the symbol read-surface (TKT-431)', () => {
    it('getSymbols awaits engine.symbols() and returns the entries', async () => {
      const symbols = vi.fn(async () => SYMBOLS)
      const engine = stubObservable({ symbols })
      await expect(getSymbols(engine)).resolves.toBe(SYMBOLS)
      expect(symbols).toHaveBeenCalledTimes(1)
    })
    it('getSymbolsPayload wraps the entries in { symbols } (the MCP-safe parity shape)', async () => {
      const engine = stubObservable({ symbols: vi.fn(async () => SYMBOLS) })
      await expect(getSymbolsPayload(engine)).resolves.toEqual({ symbols: SYMBOLS })
    })
    it('is wire-safe: JSON round-trips unchanged', async () => {
      const engine = stubObservable({ symbols: vi.fn(async () => SYMBOLS) })
      const payload = await getSymbolsPayload(engine)
      expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)
    })
    it('empty index → { symbols: [] } (not undefined, not a throw)', async () => {
      const engine = stubObservable() // default symbols → []
      await expect(getSymbolsPayload(engine)).resolves.toEqual({ symbols: [] })
    })
  })
})
