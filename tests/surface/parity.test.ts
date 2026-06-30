import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { type RunDeps, run } from '../../src/cli/run.js'
import type { Engine } from '../../src/contracts/engine.js'
import type { Observable } from '../../src/contracts/telemetry.js'
import { buildApp } from '../../src/http/app.js'
import { buildMcpServer } from '../../src/mcp/server.js'
import { makeMockEngine } from './fixtures/mock-engine.js'

/**
 * TRANSPORT PARITY (observability design §5.2; peripheral SC-02) — the keystone.
 *
 * For each telemetry surface, the bytes emitted over the CLI (`--json`), the MCP
 * (structuredContent), and the HTTP route MUST be IDENTICAL. They are, by
 * construction, because all three funnel through src/consume — this test guards that
 * no transport ever bypasses the shared serializer (the class of test whose absence
 * let CORS reach the user). Non-vacuity is proven below: a divergent serialization of
 * the SAME data produces different bytes, so this equality is strict, not trivial.
 */

/** The exact bytes the CLI writes for `code-rag <args> --json` (the real run() path). */
async function cliBytes(engine: Engine & Observable, args: string[]): Promise<string> {
  let out = ''
  const deps: RunDeps = {
    buildEngine: () => engine,
    stdout: {
      write: (s) => {
        out += s
        return true
      },
    },
    stderr: { write: () => true },
    env: { NO_COLOR: '1' },
  }
  const code = await run([...args, '--json'], deps)
  expect(code).toBe(0)
  return out.trim()
}

/** The exact bytes the HTTP route writes (the real app.request body). */
async function httpBytes(engine: Engine & Observable, path: string): Promise<string> {
  const { app } = buildApp(engine)
  const res = await app.request(path)
  expect(res.status).toBe(200)
  return (await res.text()).trim()
}

/** The bytes the MCP tool emits = JSON.stringify(structuredContent) (the wire form). */
async function mcpBytes(
  engine: Engine & Observable,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const server = buildMcpServer(engine)
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'parity', version: '0.0.0' })
  await Promise.all([server.connect(st), client.connect(ct)])
  const res = await client.callTool({ name, arguments: args })
  await server.close()
  return JSON.stringify(res.structuredContent)
}

const SURFACES = [
  { name: 'stats (full)', cli: ['stats'], http: '/stats', tool: 'stats', args: {} },
  {
    name: 'stats --layer retrieve',
    cli: ['stats', '--layer', 'retrieve'],
    http: '/stats?layer=retrieve',
    tool: 'stats',
    args: { layer: 'retrieve' },
  },
  { name: 'health', cli: ['health'], http: '/health', tool: 'health', args: {} },
  {
    name: 'log --consumer mcp',
    cli: ['log', '--consumer', 'mcp'],
    http: '/log?consumer=mcp',
    tool: 'log',
    args: { consumer: 'mcp' },
  },
] as const

describe('transport parity — CLI ≡ MCP ≡ HTTP, byte-identical (TKT-421 / SC-05)', () => {
  for (const s of SURFACES) {
    it(`${s.name}: the three transports emit identical bytes`, async () => {
      const engine = makeMockEngine() // deterministic, fixed telemetry
      const [cli, http, mcp] = await Promise.all([
        cliBytes(engine, [...s.cli]),
        httpBytes(engine, s.http),
        mcpBytes(engine, s.tool, { ...s.args }),
      ])
      expect(cli).toBe(http)
      expect(http).toBe(mcp)
      // not vacuous: the payload is real, non-empty JSON
      expect(cli.length).toBeGreaterThan(2)
      expect(() => JSON.parse(cli)).not.toThrow()
    })
  }

  it('NON-VACUITY: a divergent serialization of the SAME data produces different bytes', async () => {
    const engine = makeMockEngine()
    const canonical = await httpBytes(engine, '/health')
    const report = engine.health()
    // a transport that built the object with a different key ORDER would diverge —
    // byte-identity catches that. (JSON.stringify is order-sensitive.)
    const reordered = JSON.stringify({
      ts: report.ts,
      checks: report.checks,
      status: report.status,
    })
    expect(reordered).not.toBe(canonical)
    // and a wrapped/renamed shape diverges too — so passing the equality is meaningful.
    expect(JSON.stringify({ health: report })).not.toBe(canonical)
  })
})
