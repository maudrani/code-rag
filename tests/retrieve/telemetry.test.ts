/**
 * L4 retrieve telemetry — the scoresByLeg derivation + the registered gates (FTR-22, TKT-209).
 *
 * `topScoresByLeg` is the SSOT for the `QueryLogEntry.scoresByLeg` field the membrane's query()
 * seam appends per query (master owns the assembly + the Observable.queryLog() read surface; this
 * owns the L4-semantic derivation). `RETRIEVE_GATES` are this layer's anti-vacuity gates — the
 * central registry CI test (master) imports + registers every layer's gates and asserts no gap.
 */
import { describe, expect, it } from 'vitest'
import type { Chunk } from '../../src/contracts/chunk.js'
import type { RankedChunk, RetrievalResult } from '../../src/contracts/retrieval.js'
import { createGateRegistry } from '../../src/registry.js'
import { RETRIEVE_GATES, topScoresByLeg } from '../../src/retrieve/telemetry.js'

const chunk = (id: string): Chunk => ({
  id,
  path: id,
  lang: 'ts',
  symbol: id,
  kind: 'function',
  span: { startLine: 1, endLine: 1 },
  code: '',
  structuralRefs: { calls: [], imports: [] },
})
const rc = (id: string, bm25: number, dense: number, structural: number): RankedChunk => ({
  chunk: chunk(id),
  scores: { bm25, dense, structural },
  fused: bm25 + dense + structural,
})

describe('topScoresByLeg — QueryLogEntry.scoresByLeg derivation (L4)', () => {
  it('mirrors the top result per-leg scores (DD-1 sum invariant)', () => {
    const results: RetrievalResult = [rc('a', 0.1, 0.2, 0.05), rc('b', 0.9, 0, 0)]
    const s = topScoresByLeg(results)
    expect(s).toEqual({ bm25: 0.1, dense: 0.2, structural: 0.05 }) // the TOP result, not the 2nd
    // DD-1: the per-leg contributions sum to the top result's fused score.
    expect(s.bm25 + s.dense + s.structural).toBeCloseTo(results[0]?.fused ?? -1, 12)
  })

  it('returns all-zero legs for an empty result set (never NaN/undefined)', () => {
    expect(topScoresByLeg([])).toEqual({ bm25: 0, dense: 0, structural: 0 })
  })

  it('is byte-identical to the membrane derivation (a fresh copy, not the live scores object)', () => {
    const results: RetrievalResult = [rc('a', 0.3, 0.1, 0.2)]
    const s = topScoresByLeg(results)
    expect(s).toEqual({ ...(results[0]?.scores ?? {}) })
    expect(s).not.toBe(results[0]?.scores) // a copy — mutating telemetry never mutates the result
  })
})

describe('RETRIEVE_GATES — the L4 anti-vacuity gates', () => {
  it('declares the definition-boost guarantee AND the scoresByLeg telemetry', () => {
    expect(RETRIEVE_GATES.length).toBeGreaterThanOrEqual(2)
    const ids = RETRIEVE_GATES.map((g) => g.id)
    expect(ids.some((id) => /definition/i.test(id))).toBe(true)
    expect(ids.some((id) => /scoresByLeg|telemetry|queryLog/i.test(id))).toBe(true)
  })

  it('every gate is fully formed (id, claim, layer, and a NON-EMPTY backing test ref)', () => {
    for (const g of RETRIEVE_GATES) {
      expect(g.id.length).toBeGreaterThan(0)
      expect(g.claim.length).toBeGreaterThan(0)
      expect(g.layer.length).toBeGreaterThan(0)
      expect((g.gateTest ?? '').trim().length).toBeGreaterThan(0) // unbacked => build failure
    }
  })

  it('audits gap-free (every gate backed + exercised) so the central registry stays green', () => {
    const registry = createGateRegistry([...RETRIEVE_GATES])
    expect(registry.auditRegistry().every((v) => v.status === 'pass')).toBe(true)
    expect(registry.registryHasGap()).toBe(false)
  })
})
