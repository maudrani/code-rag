import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

/**
 * mcp-dogfood — spawns the REAL MCP serve shim as a subprocess over stdio and drives it as an
 * agent client would (listTools + callTool). The end-to-end test the InMemoryTransport unit can't
 * give: the actual stdio transport, the serve entry, the env config, the self-index on first call.
 *   npx tsx scripts/mcp-dogfood.ts
 */
interface ProjectionDto {
  results?: Array<{ path: string; span: { startLine: number; endLine: number }; symbol: string }>
  decision?: { band: string; tier: string; groundingScore: number }
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({ command: 'npx', args: ['tsx', 'src/mcp/serve.ts'] })
  const client = new Client({ name: 'mcp-dogfood', version: '0.0.0' })
  await client.connect(transport)

  const { tools } = await client.listTools()
  process.stdout.write(`tools: ${tools.map((t) => t.name).join(', ')}\n\n`)

  const search = await client.callTool({
    name: 'search',
    arguments: { query: 'how does retrieval fuse the legs' },
  })
  const dto = search.structuredContent as ProjectionDto
  process.stdout.write(
    `search -> ${dto.results?.length ?? 0} results, band=${dto.decision?.band}, grounding=${dto.decision?.groundingScore?.toFixed(3)}\n`,
  )
  for (const r of dto.results?.slice(0, 3) ?? []) {
    process.stdout.write(`  ${r.path}:${r.span.startLine}-${r.span.endLine} ${r.symbol}\n`)
  }

  const ask = await client.callTool({
    name: 'ask',
    arguments: { query: 'where is the score gate decided', dry: true },
  })
  const content = ask.content as Array<{ type: string; text: string }>
  process.stdout.write(`\nask(dry) -> ${content[0]?.text?.split('\n')[0] ?? '(no text)'}\n`)

  await client.close()
  process.stdout.write('\nMCP dogfood OK — real stdio client round-trip end to end.\n')
}

main().catch((e: unknown) => {
  process.stderr.write(`mcp-dogfood failed: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
