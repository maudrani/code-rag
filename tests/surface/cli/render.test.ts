import { describe, expect, it } from 'vitest'
import { citationsHeader, humanDry, jsonOut } from '../../../src/cli/render.js'
import { makeProjection, makeRefuseProjection } from '../fixtures/projections.js'

describe('render — TKT-411', () => {
  it('humanDry shows resolvedQuery, decision band/tier, citations file:line, and a result symbol', () => {
    const out = humanDry(makeProjection(), false)
    expect(out).toContain('where is foo defined?') // resolvedQuery
    expect(out).toContain('answer') // band
    expect(out).toContain('cheap') // tier
    expect(out).toContain('src/foo.ts:1-3') // citation as file:line
    expect(out).toContain('foo') // result symbol
  })

  it('humanDry on a refuse Projection shows the refuse band (refusal is valid, not an error)', () => {
    expect(humanDry(makeRefuseProjection(), false)).toContain('refuse')
  })

  it('NO_COLOR: useColor=false emits NO ANSI escape codes', () => {
    expect(humanDry(makeProjection(), false)).not.toContain('[')
  })

  it('useColor=true emits ANSI escape codes', () => {
    expect(humanDry(makeProjection(), true)).toContain('[')
  })

  it('jsonOut emits the serializeProjection DTO (no context)', () => {
    const parsed = JSON.parse(jsonOut(makeProjection())) as Record<string, unknown>
    expect(parsed.queryId).toBeDefined()
    expect('context' in parsed).toBe(false)
    expect(Array.isArray(parsed.results)).toBe(true)
  })

  it('citationsHeader lists citations as file:line', () => {
    expect(citationsHeader(makeProjection(), false)).toContain('src/foo.ts:1-3')
  })
})
