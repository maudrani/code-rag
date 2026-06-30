import { describe, expect, it } from 'vitest'
import { serializeProjection } from '../../../src/consume/serialize.js'
import type { Projection } from '../../../src/contracts/projection.js'
import { makeProjection, makeRankedChunk, makeRefuseProjection } from '../fixtures/projections.js'

describe('serializeProjection — TKT-408', () => {
  it('returns the exact ProjectionDTO key set', () => {
    const dto = serializeProjection(makeProjection())
    expect(Object.keys(dto).sort()).toEqual(
      ['citations', 'decision', 'queryId', 'question', 'resolvedQuery', 'results'].sort(),
    )
  })

  it('NEGATIVE: drops context.assembled even when the Projection carries it', () => {
    const projection = makeProjection() // fixture sets context.assembled
    expect(projection.context.assembled).not.toBe('') // precondition: input has context
    const dto = serializeProjection(projection) as unknown as Record<string, unknown>
    expect('context' in dto).toBe(false)
  })

  it('flattens RankedChunk results to { path, span, symbol, score }', () => {
    const dto = serializeProjection(makeProjection())
    const first = dto.results[0]
    expect(first).toEqual({
      path: 'src/foo.ts',
      span: { startLine: 1, endLine: 3 },
      symbol: 'foo',
      score: 0.85, // = RankedChunk.fused
    })
  })

  it('NEGATIVE: result items leak no RankedChunk internals (scores/fused/chunk)', () => {
    const dto = serializeProjection(makeProjection())
    const first = dto.results[0] as unknown as Record<string, unknown>
    expect(Object.keys(first).sort()).toEqual(['path', 'score', 'span', 'symbol'])
    expect('scores' in first).toBe(false)
    expect('fused' in first).toBe(false)
    expect('chunk' in first).toBe(false)
  })

  it('passes citations and decision through unchanged', () => {
    const projection = makeProjection()
    const dto = serializeProjection(projection)
    expect(dto.queryId).toBe(projection.queryId)
    expect(dto.question).toBe(projection.question)
    expect(dto.resolvedQuery).toBe(projection.resolvedQuery)
    expect(dto.citations).toEqual(projection.citations)
    expect(dto.decision).toEqual(projection.decision)
  })

  it('EDGE: refuse Projection (empty results/citations) -> empty arrays, band=refuse', () => {
    const dto = serializeProjection(makeRefuseProjection())
    expect(dto.results).toEqual([])
    expect(dto.citations).toEqual([])
    expect(dto.decision.band).toBe('refuse')
  })

  it('EDGE: a fused score of 0 is preserved (0 is a valid score, not omitted)', () => {
    const projection: Projection = makeProjection({
      results: [makeRankedChunk({ fused: 0 })],
    })
    const dto = serializeProjection(projection)
    expect(dto.results[0]?.score).toBe(0)
  })
})
