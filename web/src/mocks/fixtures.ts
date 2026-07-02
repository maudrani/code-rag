/**
 * Wire-mock fixtures (ADR-008 / ADR-002 shapes). Realistic enough to exercise the
 * citation/source viewer + decision badge: an `answer` projection (strong tier,
 * multi-file citations) and a `refuse` projection (low groundingScore). Trace events
 * deliberately include a FOREIGN queryId so the SC-03 filter has a negative case.
 */
import type {
  Citation,
  Consumer,
  EngineTelemetry,
  Event,
  HealthReport,
  QueryLogEntry,
  RankedChunk,
  SymbolEntry,
  WireProjection,
} from '../contract'
import { makeTraceEvents } from './wireMock'

export const ANSWER_QUERY_ID = 'q-answer-001'
export const REFUSE_QUERY_ID = 'q-refuse-002'
export const FOREIGN_QUERY_ID = 'q-other-999'

function rankedChunk(
  path: string,
  symbol: string,
  startLine: number,
  endLine: number,
  code: string,
  fused: number,
  calls: string[] = [],
  imports: string[] = [],
): RankedChunk {
  const id = `${path}#${symbol}@${startLine}-${endLine}`
  return {
    chunk: {
      id,
      path,
      lang: 'ts',
      symbol,
      kind: 'function',
      span: { startLine, endLine },
      code,
      structuralRefs: { calls, imports },
    },
    scores: {
      bm25: Number((fused * 0.6).toFixed(4)),
      dense: Number((fused * 0.4).toFixed(4)),
      structural: Number((fused * 0.2).toFixed(4)),
    },
    fused,
  }
}

const membraneChunk = rankedChunk(
  'src/membrane/index.ts',
  'query',
  20,
  44,
  [
    'export async function query(question: string, history: Turn[]) {',
    '  const resolvedQuery = await l0.resolve(question, history)',
    '  const ranked = await l4.retrieve(resolvedQuery)',
    '  return project(ranked)',
    '}',
  ].join('\n'),
  0.0312,
  ['l0.resolve', 'l4.retrieve', 'project'],
  ['../contracts'],
)

const wireChunk = rankedChunk(
  'src/contracts/wire.ts',
  'WireProjection',
  9,
  16,
  [
    'export interface WireProjection {',
    '  queryId: string',
    '  results: RankedChunk[]',
    '  citations: Citation[]',
    '  decision: GateDecision',
    '}',
  ].join('\n'),
  0.0205,
)

const citationOf = (c: RankedChunk, label: string): Citation => ({
  chunkId: c.chunk.id,
  path: c.chunk.path,
  span: c.chunk.span,
  label,
})

export const answerProjection: WireProjection = {
  queryId: ANSWER_QUERY_ID,
  question: 'how does the membrane orchestrate a query?',
  resolvedQuery: 'how does the membrane orchestrate a query?',
  results: [membraneChunk, wireChunk],
  citations: [
    citationOf(membraneChunk, 'membrane/index.ts:20'),
    citationOf(wireChunk, 'contracts/wire.ts:9'),
  ],
  decision: { groundingScore: 0.0312, band: 'answer', tier: 'strong', model: 'mock-strong' },
}

export const ANSWER_TEXT =
  'The membrane resolves the turn via L0, retrieves with L4, projects the SSOT, then streams the answer. See membrane/index.ts:20.'

/**
 * A markdown-rich answer for the dev-server demo (TKT-510) — exercises GFM (heading, list,
 * inline code) + a fenced ts block so `npm run dev` shows the real markdown + Shiki rendering.
 * Built as a line array so the ``` fence isn't a nested template-literal backtick.
 */
export const ANSWER_MARKDOWN = [
  '## How the membrane orchestrates a query',
  '',
  'The **membrane** is the master-owned seam. For each turn it runs three deterministic',
  'steps before the LLM is ever called:',
  '',
  '1. **L0** resolves anaphora into a standalone query.',
  '2. **L4** retrieves candidates (hybrid BM25 + dense + structural, fused by RRF).',
  '3. `project()` assembles the `Projection` — the SSOT every consumer reads.',
  '',
  '```ts',
  'export async function query(question: string, history: Turn[]) {',
  '  const resolvedQuery = await l0.resolve(question, history)',
  '  const ranked = await l4.retrieve(resolvedQuery)',
  '  return project(ranked)',
  '}',
  '```',
  '',
  'Only then does the score-gate decide `band` (answer vs refuse) and `tier`',
  '(cheap vs strong). See `membrane/index.ts:20`.',
].join('\n')

export const refuseProjection: WireProjection = {
  queryId: REFUSE_QUERY_ID,
  question: 'what is the capital of france?',
  resolvedQuery: 'what is the capital of france?',
  results: [],
  citations: [],
  decision: { groundingScore: 0.006, band: 'refuse', tier: 'cheap', model: 'mock-cheap' },
}

const foreignEvent: Event = {
  queryId: FOREIGN_QUERY_ID,
  layer: 'L4',
  type: 'l4.done',
  payload: { retrieved: 3 },
  ts: 999,
}

/** Trace stream for the current (answer) query PLUS one foreign-queryId event (filter negative). */
export const traceEventsFixture: Event[] = [...makeTraceEvents(ANSWER_QUERY_ID), foreignEvent]

/**
 * Telemetry fixtures for the Observability tab (FTR-56) — the /stats + /health payloads. Realistic,
 * internally consistent numbers so `npm run dev` shows a live-looking dashboard and the tests assert
 * concrete values. Wired to the same ANSWER query as the chat fixture (one coherent demo story).
 * The retrieve leg scores make the point of FTR-53 visible: `dense` is NON-ZERO (the embedder is live).
 */
export const statsFixture: EngineTelemetry = {
  ingest: {
    filesWalked: 214,
    filesIndexed: 198,
    skipped: 16,
    chunks: 642,
    byLang: { ts: 520, tsx: 88, json: 34 },
    errors: [],
    durationMs: 1840,
  },
  chunk: {
    count: 642,
    byKind: { function: 410, interface: 96, module: 60, class: 44, type: 32 },
    byLang: { ts: 520, tsx: 88, json: 34 },
    glueFallbacks: 7,
  },
  index: { docs: 642, sizeBytes: null, builtAt: 1_719_792_000_000, staleMs: 42_000 },
  lastQuery: {
    retrieve: {
      ts: 1_719_792_042_000,
      queryId: ANSWER_QUERY_ID,
      consumer: 'web',
      query: 'how does the membrane orchestrate a query?',
      resultCount: 5,
      scoresByLeg: { bm25: 0.0187, dense: 0.0231, structural: 0.0094 },
      band: 'answer',
      latencyMs: 38,
    },
    answer: {
      band: 'answer',
      // the cheap tier IS live (answer-specialist FTR-32) — a coherent L5 snapshot: haiku, low cost.
      tier: 'cheap',
      model: 'claude-haiku-4-5',
      tokens: 128,
      estCost: 0.00007,
    },
  },
}

/** A healthy readiness snapshot (status ok; both checks pass) — the /health payload. */
export const healthFixture: HealthReport = {
  status: 'ok',
  checks: {
    indexed: { ok: true, detail: '642 docs' },
    provider: { ok: true, detail: 'anthropic reachable' },
  },
  ts: 1_719_792_042_000,
}

const sym = (
  path: string,
  symbol: string,
  kind: SymbolEntry['kind'],
  startLine: number,
  endLine: number,
  lang = 'ts',
): SymbolEntry => ({ path, symbol, kind, lang, span: { startLine, endLine } })

/**
 * Corpus symbol index (GET /symbols, TKT-517) — a representative slice of the REAL code-rag corpus so
 * `npm run dev` shows a believable filesystem tree + symbol autocomplete. Shared path prefixes
 * (src/contracts/*, src/http/routes/*, src/retrieve/*) exercise the tree-collapse; multiple symbols
 * per file (wire.ts, membrane/index.ts) exercise the file -> symbols drill-down. Deterministic.
 */
export const symbolsFixture: SymbolEntry[] = [
  sym('src/membrane/index.ts', 'query', 'function', 20, 44),
  sym('src/membrane/index.ts', 'project', 'function', 46, 71),
  sym('src/contracts/wire.ts', 'WireProjection', 'other', 9, 16),
  sym('src/contracts/wire.ts', 'SearchRequest', 'other', 18, 21),
  sym('src/contracts/wire.ts', 'SearchResponse', 'other', 23, 27),
  sym('src/contracts/projection.ts', 'Projection', 'other', 11, 24),
  sym('src/contracts/projection.ts', 'GateDecision', 'other', 26, 33),
  sym('src/contracts/retrieval.ts', 'RankedChunk', 'other', 8, 15),
  sym('src/contracts/telemetry.ts', 'EngineTelemetry', 'other', 30, 47),
  sym('src/contracts/chunk.ts', 'Chunk', 'other', 6, 19),
  sym('src/retrieve/retrieve.ts', 'retrieve', 'function', 28, 79),
  sym('src/retrieve/structural.ts', 'structuralScore', 'function', 24, 58),
  sym('src/retrieve/symbols.ts', 'extractQuerySymbols', 'function', 12, 39),
  sym('src/retrieve/rrf.ts', 'reciprocalRankFusion', 'function', 9, 33),
  sym('src/ingest/walk.ts', 'walkCorpus', 'function', 15, 62),
  sym('src/chunk/chunker.ts', 'chunkFile', 'function', 22, 88),
  sym('src/chunk/chunker.ts', 'glueFallback', 'function', 90, 121),
  sym('src/index/store.ts', 'IndexStore', 'class', 18, 140),
  sym('src/index/embedder.ts', 'embed', 'function', 30, 66),
  sym('src/answer/answer.ts', 'answer', 'function', 26, 92),
  sym('src/answer/scoreGate.ts', 'scoreGate', 'function', 14, 48),
  sym('src/http/routes/search.ts', 'registerSearch', 'function', 16, 41),
  sym('src/http/routes/query.ts', 'registerQuery', 'function', 19, 73),
  sym('src/http/routes/telemetry.ts', 'registerTelemetry', 'function', 18, 55),
  sym('src/cli/run.ts', 'run', 'function', 24, 118),
  sym('src/mcp/server.ts', 'createMcpServer', 'function', 20, 84),
]

/** The five consumers of the one read-surface — cycled by the mock ledger so the Live feed shows
 * queries arriving from EVERY transport (the cross-consumer thesis made visible). */
const LEDGER_CONSUMERS: Consumer[] = ['cli', 'mcp', 'http', 'web', 'package']
const LEDGER_QUERIES = [
  'where is the score gate?',
  'how does dense retrieval embed a query?',
  'what does the membrane orchestrate?',
  'list the http routes',
  'how are oversized symbols glued into a module chunk?',
]

/**
 * makeLedgerEntry — a deterministic-by-index QueryLogEntry for the mock GET /ledger/stream. Cycles the
 * consumer + query and varies the L5 OUTCOME so the Live feed shows the full richness the enriched
 * ledger carries (FTR-3): an LLM answer (model + tier + tokens + cost), a DETERMINISTIC search (band
 * answer, no LLM → no model/cost), and a REFUSED query (band refuse, $0). Node-side (dev) only; `ts`
 * uses Date.now() at call time.
 */
export function makeLedgerEntry(i: number): QueryLogEntry {
  const consumer = LEDGER_CONSUMERS[i % LEDGER_CONSUMERS.length]
  const query = LEDGER_QUERIES[i % LEDGER_QUERIES.length]
  const band: QueryLogEntry['band'] = i % 4 === 3 ? 'refuse' : 'answer'
  const base = 0.012 + (i % 5) * 0.004
  const entry: QueryLogEntry = {
    ts: Date.now(),
    queryId: `q-live-${i}`,
    consumer,
    query,
    resultCount: band === 'answer' ? 5 : 0,
    scoresByLeg: {
      bm25: Number((base * 0.6).toFixed(4)),
      dense: Number((base * 0.4).toFixed(4)),
      structural: Number((base * 0.2).toFixed(4)),
    },
    band,
    latencyMs: 24 + (i % 7) * 6,
  }
  if (band === 'refuse') {
    // gate withheld the LLM entirely — zero cost.
    entry.answered = false
    entry.tokens = 0
    entry.estCost = 0
  } else if (i % 3 === 0) {
    // a deterministic /search — band answer but the LLM never ran (answered stays undefined).
  } else {
    // an LLM answer — the gate routed a tier + model, tokens + cost recorded.
    const tier: 'cheap' | 'strong' = i % 2 === 0 ? 'strong' : 'cheap'
    entry.answered = true
    entry.tier = tier
    entry.model = tier === 'strong' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5'
    entry.tokens = 90 + (i % 6) * 20
    entry.estCost = Number((entry.tokens * (tier === 'strong' ? 0.000015 : 0.000004)).toFixed(6))
  }
  return entry
}
