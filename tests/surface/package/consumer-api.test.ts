import { describe, expect, it } from 'vitest'
import type { AnswerChunk, ConsumerIntent, Engine, Projection } from '../../../src/package/index.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'

// A consumer wires an Engine purely through the PACKAGE's public type surface
// (importing from src/package, NOT src/contracts). This proves the barrel
// re-exports the Consumer API + the streaming/trace types (tsc resolves them).
async function runQuery(engine: Engine, q: string, intent: ConsumerIntent): Promise<Projection> {
  return engine.query(q, [], intent)
}

describe('package: Node Consumer API surface', () => {
  it('exposes the Engine type; a consumer queries through it -> Projection', async () => {
    const engine: Engine = makeMockEngine()
    const projection = await runQuery(engine, 'where is foo?', 'http')

    expect(projection.queryId).toBeDefined()
    expect(projection.resolvedQuery).toBe('where is foo?')
    expect(projection.decision.band).toBe('answer')
  })

  it('exposes AnswerChunk for streaming consumers; answer() yields chunks', async () => {
    const engine: Engine = makeMockEngine()
    const projection = await runQuery(engine, 'q', 'http')
    const chunks: AnswerChunk[] = []
    for await (const chunk of engine.answer(projection, [])) chunks.push(chunk)

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.at(-1)?.type).toBe('usage')
  })
})
