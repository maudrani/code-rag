import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { buildEngine } from '../../../src/consume/index.js'
import { askTool, searchTool } from '../../../src/mcp/tools.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'
import { makeRefuseProjection } from '../fixtures/projections.js'

// reuse the CLI fixture corpus for the real-engine, no-key path
const corpusDir = fileURLToPath(new URL('../cli/fixtures/corpus', import.meta.url))

function textOf(result: Awaited<ReturnType<typeof askTool>>): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('')
}

describe('askTool / searchTool — TKT-413', () => {
  it('askTool dry: structuredContent is a DTO (no context), real engine, NO key, answer() never called', async () => {
    const engine = buildEngine({ corpusPath: corpusDir })
    const spy = vi.spyOn(engine, 'answer')
    const result = await askTool(engine, { query: 'greet', dry: true })

    const sc = result.structuredContent as Record<string, unknown>
    expect(sc).toBeDefined()
    expect(sc.queryId).toBeDefined()
    expect('context' in sc).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  }, 30000)

  it('askTool answer: content text === the accumulated answer; structuredContent present', async () => {
    const engine = makeMockEngine({ tokens: ['foo ', 'bar'] })
    const result = await askTool(engine, { query: 'q', dry: false })

    expect(textOf(result)).toContain('foo bar')
    expect(result.structuredContent).toBeDefined()
  })

  it('askTool refuse: no fabricated answer; structuredContent.decision.band = refuse', async () => {
    const engine = makeMockEngine({ projection: makeRefuseProjection() })
    const result = await askTool(engine, { query: 'q', dry: false })

    const sc = result.structuredContent as { decision: { band: string } }
    expect(sc.decision.band).toBe('refuse')
    expect(result.content.length).toBeGreaterThan(0)
  })

  it('searchTool: structuredContent = DTO (citations + decision), no answer, answer() never called', async () => {
    const engine = makeMockEngine()
    const spy = vi.spyOn(engine, 'answer')
    const result = await searchTool(engine, { query: 'q' })

    const sc = result.structuredContent as {
      citations: unknown[]
      decision: unknown
      results: unknown[]
    }
    expect(sc.decision).toBeDefined()
    expect(Array.isArray(sc.citations)).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('NEGATIVE: searchTool structuredContent must NOT include context.assembled', async () => {
    const result = await searchTool(makeMockEngine(), { query: 'q' })
    expect('context' in (result.structuredContent as Record<string, unknown>)).toBe(false)
  })
})
