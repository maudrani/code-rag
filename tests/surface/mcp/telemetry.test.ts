import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import {
  getHealth,
  getLogPayload,
  getStats,
  getSymbolsPayload,
} from '../../../src/consume/index.js'
import { buildMcpServer } from '../../../src/mcp/server.js'
import { healthTool, logTool, statsTool, symbolsTool } from '../../../src/mcp/tools.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'

async function connect() {
  const server = buildMcpServer(makeMockEngine())
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, server }
}

// The reference values — the SAME SSOT the CLI + HTTP call. A fresh mock is deterministic.
const ref = makeMockEngine()

describe('MCP telemetry tools — unit (TKT-419)', () => {
  it('statsTool full snapshot → structuredContent = getStats(engine)', () => {
    const res = statsTool(makeMockEngine())
    expect(res.structuredContent).toEqual(getStats(ref))
    expect(res.content[0]?.type).toBe('text')
  })
  it('statsTool layered → structuredContent = getStats(engine, layer)', () => {
    expect(statsTool(makeMockEngine(), { layer: 'retrieve' }).structuredContent).toEqual(
      getStats(ref, 'retrieve'),
    )
  })
  it('healthTool → structuredContent = getHealth(engine)', () => {
    expect(healthTool(makeMockEngine()).structuredContent).toEqual(getHealth(ref))
  })
  it('logTool → structuredContent = getLogPayload(engine, args)', () => {
    expect(logTool(makeMockEngine(), { consumer: 'mcp' }).structuredContent).toEqual(
      getLogPayload(ref, { consumer: 'mcp' }),
    )
  })
  it('symbolsTool → structuredContent = await getSymbolsPayload(engine)', async () => {
    const res = await symbolsTool(makeMockEngine())
    expect(res.structuredContent).toEqual(await getSymbolsPayload(ref))
    expect(res.content[0]?.type).toBe('text')
  })
})

describe('MCP telemetry tools — real client round-trip (TKT-419)', () => {
  it('registers ask + search + stats + health + log + symbols', async () => {
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

  it('callTool symbols → structuredContent identical to getSymbolsPayload(engine)', async () => {
    const { client, server } = await connect()
    const res = await client.callTool({ name: 'symbols', arguments: {} })
    expect(res.structuredContent).toEqual(await getSymbolsPayload(ref))
    await server.close()
  })

  it('callTool stats { layer:index } → structuredContent identical to getStats(engine,"index")', async () => {
    const { client, server } = await connect()
    const res = await client.callTool({ name: 'stats', arguments: { layer: 'index' } })
    expect(res.structuredContent).toEqual(getStats(ref, 'index'))
    await server.close()
  })

  it('callTool health → structuredContent identical to getHealth(engine)', async () => {
    const { client, server } = await connect()
    const res = await client.callTool({ name: 'health', arguments: {} })
    expect(res.structuredContent).toEqual(getHealth(ref))
    await server.close()
  })

  it('callTool log { consumer:mcp } → { entries } identical to getLogPayload(engine,...)', async () => {
    const { client, server } = await connect()
    const res = await client.callTool({ name: 'log', arguments: { consumer: 'mcp' } })
    expect(res.structuredContent).toEqual(getLogPayload(ref, { consumer: 'mcp' }))
    await server.close()
  })

  it('NEGATIVE: stats with an invalid layer is rejected (zod enum) → isError', async () => {
    const { client, server } = await connect()
    const res = await client.callTool({ name: 'stats', arguments: { layer: 'membrane' } })
    expect(res.isError).toBe(true)
    await server.close()
  })
})
