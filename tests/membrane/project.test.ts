import { describe, expect, it } from 'vitest'
import type { Chunk, GateDecision, RankedChunk } from '../../src/contracts/index.js'
import { assembleContext, buildCitation, project } from '../../src/membrane/project.js'

function mkChunk(over: Partial<Chunk> = {}): Chunk {
  return {
    id: 'src/foo.ts#foo@1-3',
    path: 'src/foo.ts',
    lang: 'typescript',
    symbol: 'foo',
    kind: 'function',
    span: { startLine: 1, endLine: 3 },
    code: 'function foo() {\n  return 1\n}',
    structuralRefs: { calls: [], imports: [] },
    ...over,
  }
}
function mkRanked(chunk: Chunk, fused = 0.5): RankedChunk {
  return { chunk, scores: { bm25: 0.6, dense: 0, structural: 0.3 }, fused }
}
const answerGate = (): GateDecision => ({
  groundingScore: 0.5,
  band: 'answer',
  tier: 'cheap',
  model: 'claude-haiku-4-5',
})

describe('buildCitation', () => {
  it('maps a RankedChunk to a clickable Citation', () => {
    expect(buildCitation(mkRanked(mkChunk()))).toEqual({
      chunkId: 'src/foo.ts#foo@1-3',
      path: 'src/foo.ts',
      span: { startLine: 1, endLine: 3 },
      label: 'foo (src/foo.ts:1-3)',
    })
  })
})

describe('assembleContext', () => {
  it('concatenates code blocks with a location header and estimates tokens', () => {
    const { assembled, tokensEst } = assembleContext([mkRanked(mkChunk())])
    expect(assembled).toContain('// src/foo.ts:1-3 — foo')
    expect(assembled).toContain('function foo()')
    expect(tokensEst).toBe(Math.ceil(assembled.length / 4))
    expect(tokensEst).toBeGreaterThan(0)
  })

  it('is empty for no results', () => {
    expect(assembleContext([])).toEqual({ assembled: '', tokensEst: 0 })
  })
})

describe('project', () => {
  it('assembles the SSOT projection from results + gate', () => {
    const results = [mkRanked(mkChunk())]
    const p = project({
      queryId: 'q1',
      question: 'Q',
      resolvedQuery: 'Q',
      results,
      scoreGate: answerGate,
    })
    expect(p.queryId).toBe('q1')
    expect(p.decision.band).toBe('answer')
    expect(p.citations).toHaveLength(1)
    expect(p.context.assembled).toContain('function foo()')
    expect(p.results).toBe(results)
  })

  it('passes BOTH question and resolvedQuery to the gate (intent reads resolvedQuery)', () => {
    let seen: { question: string; resolvedQuery: string } | undefined
    project({
      queryId: 'q',
      question: 'orig',
      resolvedQuery: 'rewritten standalone',
      results: [],
      scoreGate: (_r, q) => {
        seen = q
        return { groundingScore: 0, band: 'refuse', tier: 'cheap', model: 'm' }
      },
    })
    expect(seen).toEqual({ question: 'orig', resolvedQuery: 'rewritten standalone' })
  })
})
