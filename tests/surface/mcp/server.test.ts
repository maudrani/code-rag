import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import type { Engine } from '../../../src/contracts/engine.js'
import type { Observable } from '../../../src/contracts/telemetry.js'
import { buildMcpServer } from '../../../src/mcp/server.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'

async function connect(engine: Engine & Observable = makeMockEngine()) {
  const server = buildMcpServer(engine)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, server }
}

describe('buildMcpServer — real client round-trip (TKT-413)', () => {
  it('registers the retrieval (ask, search) + read-surface (stats, health, log, symbols) tools', async () => {
    const { client, server } = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'ask',
      'health',
      'log',
      'search',
      'stats',
      'symbols',
    ])
    await server.close()
  })

  it('the symbols tool description is HONEST about its index cost — NOT "no cost" (TKT-443)', async () => {
    const { client, server } = await connect()
    const { tools } = await client.listTools()
    // symbols is the ONE read-surface that ensureIndexed()s → the first call cold-indexes, so the
    // description must NOT claim 'no cost' and must say it indexes.
    const symbols = tools.find((t) => t.name === 'symbols')
    expect(symbols?.description?.toLowerCase()).not.toContain('no cost')
    expect(symbols?.description?.toLowerCase()).toMatch(/index/)
    // the genuinely-free read-surfaces KEEP their honest 'no cost' (the reword is targeted, not blanket)
    expect(tools.find((t) => t.name === 'stats')?.description?.toLowerCase()).toContain('no cost')
    await server.close()
  })

  it('callTool search -> structuredContent = the projection DTO (no context.assembled)', async () => {
    const { client, server } = await connect()
    const res = await client.callTool({ name: 'search', arguments: { query: 'where is foo?' } })
    const sc = res.structuredContent as Record<string, unknown>
    expect(sc.queryId).toBeDefined()
    expect(sc.decision).toBeDefined()
    expect('context' in sc).toBe(false)
    await server.close()
  })

  it('callTool ask (dry) -> structuredContent + a text content block', async () => {
    const { client, server } = await connect()
    const res = await client.callTool({ name: 'ask', arguments: { query: 'q', dry: true } })
    expect(res.structuredContent).toBeDefined()
    const content = res.content as Array<{ type: string }>
    expect(content.some((c) => c.type === 'text')).toBe(true)
    await server.close()
  })

  it('NEGATIVE: calling an unknown tool returns an isError result (not a crash)', async () => {
    const { client, server } = await connect()
    const res = await client.callTool({ name: 'does-not-exist', arguments: {} })
    expect(res.isError).toBe(true)
    await server.close()
  })
})
