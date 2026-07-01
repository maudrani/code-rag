import { describe, expect, it } from 'vitest'
import {
  distributionData,
  formatBytes,
  formatCost,
  formatInt,
  formatMs,
  formatScore,
  formatStale,
  legChartData,
} from '../src/components/observability/formatters'

describe('observability formatters', () => {
  it('formatMs spans sub-ms, ms, and seconds', () => {
    expect(formatMs(0.4)).toBe('<1 ms')
    expect(formatMs(38)).toBe('38 ms')
    expect(formatMs(1840)).toBe('1.84 s')
  })

  it('formatCost keeps sub-cent answers visible', () => {
    expect(formatCost(0)).toBe('$0')
    expect(formatCost(0.00026)).toBe('$0.00026')
    expect(formatCost(0.05)).toBe('$0.0500')
  })

  it('formatBytes marks an in-memory index and scales KB/MB', () => {
    expect(formatBytes(null)).toBe('in-memory')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
  })

  it('formatStale renders relative freshness', () => {
    expect(formatStale(500)).toBe('just now')
    expect(formatStale(42_000)).toBe('42s ago')
    expect(formatStale(120_000)).toBe('2m ago')
  })

  it('formatInt and formatScore are stable', () => {
    expect(formatInt(642)).toBe('642')
    expect(formatScore(0.0231)).toBe('0.0231')
  })

  it('legChartData keeps the bm25/dense/structural order and coerces missing legs to 0', () => {
    const data = legChartData({ bm25: 0.0187, dense: 0.0231, structural: 0.0094 })
    expect(data.map((d) => d.leg)).toEqual(['bm25', 'dense', 'structural'])
    expect(data[1]).toMatchObject({ leg: 'dense', score: 0.0231 })
    // a partial record must not produce undefined scores
    const partial = legChartData({ bm25: 0.02 } as {
      bm25: number
      dense: number
      structural: number
    })
    expect(partial.map((d) => d.score)).toEqual([0.02, 0, 0])
  })

  it('distributionData sorts a record descending by value', () => {
    expect(distributionData({ a: 1, b: 5, c: 3 })).toEqual([
      { name: 'b', value: 5 },
      { name: 'c', value: 3 },
      { name: 'a', value: 1 },
    ])
  })
})
