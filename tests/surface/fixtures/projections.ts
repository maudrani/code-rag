import type { Chunk } from '../../../src/contracts/chunk.js'
import type { Citation, GateDecision, Projection } from '../../../src/contracts/projection.js'
import type { RankedChunk } from '../../../src/contracts/retrieval.js'

export function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    id: 'src/foo.ts#foo@1-3',
    path: 'src/foo.ts',
    lang: 'typescript',
    symbol: 'foo',
    kind: 'function',
    span: { startLine: 1, endLine: 3 },
    code: 'export function foo() {\n  return 1\n}',
    structuralRefs: { calls: [], imports: [] },
    ...overrides,
  }
}

export function makeRankedChunk(overrides: Partial<RankedChunk> = {}): RankedChunk {
  return {
    chunk: makeChunk(),
    scores: { bm25: 0.9, dense: 0.8, structural: 0.5 },
    fused: 0.85,
    ...overrides,
  }
}

export function makeCitation(overrides: Partial<Citation> = {}): Citation {
  return {
    chunkId: 'src/foo.ts#foo@1-3',
    path: 'src/foo.ts',
    span: { startLine: 1, endLine: 3 },
    label: 'foo (src/foo.ts:1-3)',
    ...overrides,
  }
}

// Neutral model strings — the real ids are answer-specialist territory; fixtures
// only need a string to satisfy GateDecision.model.
const ANSWER_DECISION: GateDecision = {
  groundingScore: 0.85,
  band: 'answer',
  tier: 'cheap',
  model: 'mock-cheap',
}

const REFUSE_DECISION: GateDecision = {
  groundingScore: 0.05,
  band: 'refuse',
  tier: 'cheap',
  model: 'mock-cheap',
}

export function makeProjection(overrides: Partial<Projection> = {}): Projection {
  return {
    queryId: 'q-test',
    question: 'where is foo defined?',
    resolvedQuery: 'where is foo defined?',
    results: [makeRankedChunk()],
    citations: [makeCitation()],
    context: { assembled: 'foo is defined in src/foo.ts', tokensEst: 12 },
    decision: ANSWER_DECISION,
    ...overrides,
  }
}

/** band='answer' — the happy path the /query SSE streams over. */
export function makeAnswerProjection(overrides: Partial<Projection> = {}): Projection {
  return makeProjection({ decision: ANSWER_DECISION, ...overrides })
}

/** band='refuse' — low grounding; /query emits meta+done, NO tokens (ADR-008). */
export function makeRefuseProjection(overrides: Partial<Projection> = {}): Projection {
  return makeProjection({
    results: [],
    citations: [],
    context: { assembled: '', tokensEst: 0 },
    decision: REFUSE_DECISION,
    ...overrides,
  })
}
