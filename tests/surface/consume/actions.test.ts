import { describe, expect, it, vi } from 'vitest'
import { ask, buildEngine, resolveEngineConfig } from '../../../src/consume/actions.js'
import type { Engine } from '../../../src/contracts/engine.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'
import { makeRefuseProjection } from '../fixtures/projections.js'

describe('resolveEngineConfig — TKT-409', () => {
  it('explicit arg takes precedence over env', () => {
    const cfg = resolveEngineConfig(
      { corpusPath: '/arg', apiKey: 'arg-key' },
      { CORPUS_PATH: '/env', ANTHROPIC_API_KEY: 'env-key' },
    )
    expect(cfg).toEqual({ corpusPath: '/arg', apiKey: 'arg-key' })
  })

  it('falls back to env when the arg is absent', () => {
    const cfg = resolveEngineConfig({}, { CORPUS_PATH: '/env', ANTHROPIC_API_KEY: 'env-key' })
    expect(cfg).toEqual({ corpusPath: '/env', apiKey: 'env-key' })
  })

  it('NEGATIVE: omits undefined keys when neither arg nor env is set (exactOptionalPropertyTypes)', () => {
    const cfg = resolveEngineConfig({}, {})
    expect('corpusPath' in cfg).toBe(false)
    expect('apiKey' in cfg).toBe(false)
    expect(cfg).toEqual({})
  })
})

describe('buildEngine — TKT-409', () => {
  it('returns a usable Engine (query/answer/on/ingest)', () => {
    const engine = buildEngine({ corpusPath: '.' })
    expect(typeof engine.query).toBe('function')
    expect(typeof engine.answer).toBe('function')
    expect(typeof engine.on).toBe('function')
    expect(typeof engine.ingest).toBe('function')
  })
})

describe('ask — TKT-409', () => {
  it('dry: answered:false; engine.answer() is NEVER called (no LLM, no cost)', async () => {
    const base = makeMockEngine()
    const answerSpy = vi.fn(base.answer)
    const engine: Engine = { ...base, answer: answerSpy as Engine['answer'] }

    const result = await ask(engine, 'where is foo?', { dry: true })

    expect(result.answered).toBe(false)
    expect(result.projection.queryId).toBeTruthy()
    expect(answerSpy).not.toHaveBeenCalled()
  })

  it('refuse: answered:false; engine.answer() is NEVER called', async () => {
    const base = makeMockEngine({ projection: makeRefuseProjection() })
    const answerSpy = vi.fn(base.answer)
    const engine: Engine = { ...base, answer: answerSpy as Engine['answer'] }

    const result = await ask(engine, 'unanswerable', {})

    expect(result.answered).toBe(false)
    expect(result.projection.decision.band).toBe('refuse')
    expect(answerSpy).not.toHaveBeenCalled()
  })

  it('answer: streams tokens, fires onToken per token in order, returns the joined answer', async () => {
    const tokens = ['foo ', 'is ', 'here']
    const engine = makeMockEngine({ tokens })
    const seen: string[] = []

    const result = await ask(engine, 'where is foo?', { onToken: (t) => seen.push(t) })

    expect(result.answered).toBe(true)
    if (result.answered) expect(result.answer).toBe('foo is here')
    expect(seen).toEqual(tokens)
  })

  it('answer without onToken still accumulates the answer', async () => {
    const engine = makeMockEngine({ tokens: ['a', 'b'] })
    const result = await ask(engine, 'q', {})
    expect(result.answered).toBe(true)
    if (result.answered) expect(result.answer).toBe('ab')
  })

  it('EDGE: an empty token stream -> answered:true with answer=""', async () => {
    const engine = makeMockEngine({ tokens: [] })
    const result = await ask(engine, 'q', {})
    expect(result.answered).toBe(true)
    if (result.answered) expect(result.answer).toBe('')
  })

  it('onProjection fires with the Projection BEFORE the first token (header-first)', async () => {
    const engine = makeMockEngine({ tokens: ['x', 'y'] })
    const order: string[] = []
    await ask(engine, 'q', {
      onProjection: () => order.push('projection'),
      onToken: () => order.push('token'),
    })
    expect(order).toEqual(['projection', 'token', 'token'])
  })

  it('onProjection fires on the dry path too (right after query)', async () => {
    const engine = makeMockEngine()
    const seen: unknown[] = []
    const result = await ask(engine, 'q', { dry: true, onProjection: (p) => seen.push(p) })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(result.projection)
  })
})
