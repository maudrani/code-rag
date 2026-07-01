import { describe, expect, it } from 'vitest'
import { buildApp } from '../../../src/http/app.js'
import { toWireProjection } from '../../../src/http/wire.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'
import { makeProjection, makeRankedChunk } from '../fixtures/projections.js'

/**
 * LOCK (TKT-425 / SC-01): the raw per-hit cosine (RankedChunk.cosine — FTR-55 / TKT-337,
 * the ABSOLUTE relevance signal) already flows to the frontend because toWireProjection
 * passes each RankedChunk WHOLE. This guards that boundary: present -> on the wire per hit;
 * undefined -> OMITTED (never serialized as 0, which the contract forbids). A future flatten
 * of `results` would turn these red.
 */
describe('cosine on the HTTP wire (TKT-425 / SC-01)', () => {
  it('toWireProjection carries per-hit cosine when present', () => {
    const wire = toWireProjection(makeProjection({ results: [makeRankedChunk({ cosine: 0.42 })] }))
    expect(wire.results[0]?.cosine).toBe(0.42)
  })

  it('OMISSION: a hit with cosine undefined -> the key is ABSENT from the JSON (never 0)', () => {
    const wire = toWireProjection(makeProjection({ results: [makeRankedChunk()] }))
    expect(wire.results[0]?.cosine).toBeUndefined()
    expect(JSON.stringify(wire)).not.toContain('cosine') // omitted, not 0/null
  })

  it('mixed hits: cosine present on some, absent on others (per-hit, independent)', () => {
    const wire = toWireProjection(
      makeProjection({ results: [makeRankedChunk({ cosine: 0.7 }), makeRankedChunk()] }),
    )
    expect(wire.results[0]?.cosine).toBe(0.7)
    expect(wire.results[1]?.cosine).toBeUndefined()
  })

  it('INTEGRATION: POST /search carries cosine per hit end-to-end', async () => {
    const engine = makeMockEngine({
      projection: makeProjection({ results: [makeRankedChunk({ cosine: 0.55 })] }),
    })
    const { app } = buildApp(engine)
    const res = await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'q' }),
    })
    const body = (await res.json()) as { results: Array<{ cosine?: number }> }
    expect(body.results[0]?.cosine).toBe(0.55)
  })
})
