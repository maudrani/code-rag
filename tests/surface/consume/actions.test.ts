import { describe, expect, it, vi } from 'vitest'
import { ask, buildEngine, resolveEngineConfig } from '../../../src/consume/actions.js'
import type { Engine } from '../../../src/contracts/engine.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'
import { makeRefuseProjection } from '../fixtures/projections.js'

describe('resolveEngineConfig — TKT-409', () => {
  it('explicit arg takes precedence over env', () => {
    const cfg = resolveEngineConfig(
      { corpusPath: '/arg', apiKey: 'arg-key', indexPath: '/arg-idx' },
      { CORPUS_PATH: '/env', ANTHROPIC_API_KEY: 'env-key', CODE_RAG_INDEX: '/env-idx' },
    )
    expect(cfg).toEqual({ corpusPath: '/arg', apiKey: 'arg-key', indexPath: '/arg-idx' })
  })

  it('falls back to env when the arg is absent', () => {
    const cfg = resolveEngineConfig(
      {},
      { CORPUS_PATH: '/env', ANTHROPIC_API_KEY: 'env-key', CODE_RAG_INDEX: '/env-idx' },
    )
    expect(cfg).toEqual({ corpusPath: '/env', apiKey: 'env-key', indexPath: '/env-idx' })
  })

  it('threads CODE_RAG_INDEX → indexPath alone (warm-restart opt-in, mirrors CORPUS_PATH)', () => {
    expect(resolveEngineConfig({}, { CODE_RAG_INDEX: '/data/code-rag.db' })).toEqual({
      indexPath: '/data/code-rag.db',
    })
  })

  it('NEGATIVE: omits undefined keys when neither arg nor env is set (exactOptionalPropertyTypes)', () => {
    const cfg = resolveEngineConfig({}, {})
    expect('corpusPath' in cfg).toBe(false)
    expect('apiKey' in cfg).toBe(false)
    expect('indexPath' in cfg).toBe(false)
    expect('dense' in cfg).toBe(false)
    expect(cfg).toEqual({})
  })

  it('threads CODE_RAG_DENSE=false → dense:false (offline / heat-safe switch, TKT-448)', () => {
    expect(resolveEngineConfig({}, { CODE_RAG_DENSE: 'false' })).toEqual({ dense: false })
    expect(resolveEngineConfig({}, { CODE_RAG_DENSE: '0' })).toEqual({ dense: false })
    expect(resolveEngineConfig({}, { CODE_RAG_DENSE: 'OFF' })).toEqual({ dense: false })
  })

  it('threads CODE_RAG_DENSE=true → dense:true', () => {
    expect(resolveEngineConfig({}, { CODE_RAG_DENSE: 'true' })).toEqual({ dense: true })
    expect(resolveEngineConfig({}, { CODE_RAG_DENSE: '1' })).toEqual({ dense: true })
  })

  it('explicit config.dense beats CODE_RAG_DENSE', () => {
    expect(resolveEngineConfig({ dense: true }, { CODE_RAG_DENSE: 'false' })).toEqual({
      dense: true,
    })
  })

  it('NEGATIVE: CODE_RAG_DENSE empty or garbage omits dense (membrane default wins, no crash)', () => {
    expect('dense' in resolveEngineConfig({}, { CODE_RAG_DENSE: '' })).toBe(false)
    expect('dense' in resolveEngineConfig({}, { CODE_RAG_DENSE: 'maybe' })).toBe(false)
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

    const result = await ask(engine, 'where is foo?', 'package', { dry: true })

    expect(result.answered).toBe(false)
    expect(result.projection.queryId).toBeTruthy()
    expect(answerSpy).not.toHaveBeenCalled()
  })

  it('refuse: answered:false; engine.answer() is NEVER called', async () => {
    const base = makeMockEngine({ projection: makeRefuseProjection() })
    const answerSpy = vi.fn(base.answer)
    const engine: Engine = { ...base, answer: answerSpy as Engine['answer'] }

    const result = await ask(engine, 'unanswerable', 'package', {})

    expect(result.answered).toBe(false)
    expect(result.projection.decision.band).toBe('refuse')
    expect(answerSpy).not.toHaveBeenCalled()
  })

  it('answer: streams tokens, fires onToken per token in order, returns the joined answer', async () => {
    const tokens = ['foo ', 'is ', 'here']
    const engine = makeMockEngine({ tokens })
    const seen: string[] = []

    const result = await ask(engine, 'where is foo?', 'package', { onToken: (t) => seen.push(t) })

    expect(result.answered).toBe(true)
    if (result.answered) expect(result.answer).toBe('foo is here')
    expect(seen).toEqual(tokens)
  })

  it('answer without onToken still accumulates the answer', async () => {
    const engine = makeMockEngine({ tokens: ['a', 'b'] })
    const result = await ask(engine, 'q', 'package', {})
    expect(result.answered).toBe(true)
    if (result.answered) expect(result.answer).toBe('ab')
  })

  it('EDGE: an empty token stream -> answered:true with answer=""', async () => {
    const engine = makeMockEngine({ tokens: [] })
    const result = await ask(engine, 'q', 'package', {})
    expect(result.answered).toBe(true)
    if (result.answered) expect(result.answer).toBe('')
  })

  it('onProjection fires with the Projection BEFORE the first token (header-first)', async () => {
    const engine = makeMockEngine({ tokens: ['x', 'y'] })
    const order: string[] = []
    await ask(engine, 'q', 'package', {
      onProjection: () => order.push('projection'),
      onToken: () => order.push('token'),
    })
    expect(order).toEqual(['projection', 'token', 'token'])
  })

  it('onProjection fires on the dry path too (right after query)', async () => {
    const engine = makeMockEngine()
    const seen: unknown[] = []
    const result = await ask(engine, 'q', 'package', {
      dry: true,
      onProjection: (p) => seen.push(p),
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(result.projection)
  })

  it('threads the EXPLICIT consumer to engine.query (not derived from dry) — TKT-424', async () => {
    const base = makeMockEngine()
    const querySpy = vi.fn(base.query)
    const engine: Engine = { ...base, query: querySpy as Engine['query'] }

    await ask(engine, 'q', 'mcp', { dry: true })
    // the 3rd arg is the consumer 'mcp' — NOT 'cli-dry' (the old mode/consumer conflation)
    expect(querySpy).toHaveBeenCalledWith('q', [], 'mcp')

    await ask(engine, 'q2', 'cli', {})
    expect(querySpy).toHaveBeenLastCalledWith('q2', [], 'cli')
  })
})
