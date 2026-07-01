/**
 * Wire-mock fixtures (ADR-008 / ADR-002 shapes). Realistic enough to exercise the
 * citation/source viewer + decision badge: an `answer` projection (strong tier,
 * multi-file citations) and a `refuse` projection (low groundingScore). Trace events
 * deliberately include a FOREIGN queryId so the SC-03 filter has a negative case.
 */
import type { Citation, Event, RankedChunk, WireProjection } from '../contract'
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
