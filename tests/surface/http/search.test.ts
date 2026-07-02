import { describe, expect, it, vi } from 'vitest'
import type { Engine } from '../../../src/contracts/engine.js'
import type { SearchResponse } from '../../../src/contracts/wire.js'
import { searchRoutes } from '../../../src/http/routes/search.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'
import { makeRefuseProjection } from '../fixtures/projections.js'

async function postSearch(
  engine: Engine,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const app = searchRoutes(engine)
  const res = await app.request('/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  // 200s are JSON; HTTPException 400s default to a text body (the server-level
  // onError wraps them into a JSON envelope — that's verified in TKT-407).
  let json: unknown
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = text
  }
  return { status: res.status, json }
}

describe('POST /search (deterministic, no LLM) — TKT-405', () => {
  it('returns a WireProjection (results + decision), status 200 JSON', async () => {
    const { status, json } = await postSearch(makeMockEngine(), { query: 'where is foo?' })
    expect(status).toBe(200)
    const wire = json as SearchResponse
    expect(wire.queryId).toBeTruthy()
    expect(wire.resolvedQuery).toBe('where is foo?')
    expect(wire.results.length).toBeGreaterThan(0)
    expect(wire.decision.band).toBe('answer')
  })

  it('NEGATIVE: response must NOT include context.assembled (WireProjection only)', async () => {
    const { json } = await postSearch(makeMockEngine(), { query: 'q' })
    expect('context' in (json as Record<string, unknown>)).toBe(false)
  })

  it('NEGATIVE: never calls engine.answer() (no LLM, no token cost on this path)', async () => {
    const base = makeMockEngine()
    let answerCalled = false
    const engine: Engine = {
      ...base,
      async *answer(p, h) {
        answerCalled = true
        yield* base.answer(p, h)
      },
    }
    const { json } = await postSearch(engine, { query: 'q' })
    expect(answerCalled).toBe(false)
    // response is a plain projection — carries no answer/token fields
    expect(json as Record<string, unknown>).not.toHaveProperty('tokensTotal')
  })

  it('is deterministic: identical input yields identical results ordering', async () => {
    const a = await postSearch(makeMockEngine(), { query: 'where is foo?' })
    const b = await postSearch(makeMockEngine(), { query: 'where is foo?' })
    expect((a.json as SearchResponse).results).toEqual((b.json as SearchResponse).results)
  })

  it('EDGE: low grounding (refuse) still returns a valid WireProjection (results+decision, 200)', async () => {
    const { status, json } = await postSearch(
      makeMockEngine({ projection: makeRefuseProjection() }),
      { query: 'unanswerable' },
    )
    expect(status).toBe(200)
    const wire = json as SearchResponse
    expect(wire.decision.band).toBe('refuse')
    expect(Array.isArray(wire.results)).toBe(true)
  })

  it('EDGE: empty query -> 400 (HTTPException, not a 500)', async () => {
    const { status } = await postSearch(makeMockEngine(), { query: '' })
    expect(status).toBe(400)
  })

  it('EDGE: whitespace-only query -> 400', async () => {
    const { status } = await postSearch(makeMockEngine(), { query: '   ' })
    expect(status).toBe(400)
  })

  it('EDGE: missing query field -> 400', async () => {
    const { status } = await postSearch(makeMockEngine(), {})
    expect(status).toBe(400)
  })

  it('consumer override (X-Consumer / ?consumer=) tags engine.query; absent → http — TKT-433', async () => {
    const base = makeMockEngine()
    const querySpy = vi.fn(base.query)
    const engine: Engine = { ...base, query: querySpy as Engine['query'] }
    const app = searchRoutes(engine)
    const send = (path: string, headers: Record<string, string>) =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ query: 'q' }),
      })

    await send('/search', { 'X-Consumer': 'web' })
    expect(querySpy).toHaveBeenLastCalledWith('q', [], 'web')
    await send('/search?consumer=web', {})
    expect(querySpy).toHaveBeenLastCalledWith('q', [], 'web')
    await send('/search', {}) // no override
    expect(querySpy).toHaveBeenLastCalledWith('q', [], 'http')
  })
})
