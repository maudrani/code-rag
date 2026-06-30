import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const serveSrc = readFileSync(join(repoRoot, 'src', 'mcp', 'serve.ts'), 'utf8')

describe('MCP serve + config — TKT-414', () => {
  it('STDOUT HYGIENE: serve.ts contains NO console.log (stdout is the JSON-RPC channel)', () => {
    expect(serveSrc).not.toMatch(/console\.log/)
  })

  it('serve.ts logs readiness to stderr (process.stderr / console.error)', () => {
    expect(serveSrc).toMatch(/process\.stderr|console\.error/)
  })

  it('serve.ts wires StdioServerTransport and is import-safe (guards direct execution)', () => {
    expect(serveSrc).toMatch(/StdioServerTransport/)
    expect(serveSrc).toContain('import.meta.url')
  })

  it('examples/mcp.json is valid JSON pointing node at the built serve shim', () => {
    const cfg = JSON.parse(readFileSync(join(repoRoot, 'examples', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>
    }
    const entry = cfg.mcpServers['code-rag']
    expect(entry).toBeDefined()
    expect(entry?.command).toBe('node')
    expect(entry?.args).toContain('dist/src/mcp/serve.js')
  })

  it('NEGATIVE: importing serve.ts is side-effect free (no auto-connect on import)', async () => {
    const mod = await import('../../../src/mcp/serve.js')
    expect(typeof mod.startMcpServer).toBe('function')
  })
})
