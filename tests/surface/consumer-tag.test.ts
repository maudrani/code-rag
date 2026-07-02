import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type RunDeps, run } from '../../src/cli/run.js'
import { buildEngine } from '../../src/consume/index.js'
import { buildApp } from '../../src/http/app.js'
import { searchTool } from '../../src/mcp/tools.js'

/**
 * The GATE that was missing (TKT-424): assert the ledger consumer tag == the REAL
 * transport, end-to-end through the real membrane. The parity test checked payload
 * shape; nothing checked that a query via MCP is recorded as 'mcp'. It wasn't —
 * ask() conflated dry-mode with the consumer, so every MCP/CLI call was mislabeled.
 *
 * Real engine (createEngine over a fixture corpus, NO API key — search/dry are
 * deterministic). One engine; each transport appends to its queryLog; we assert the
 * tag by the probe query string. RED on the pre-fix code (MCP probe -> 'cli').
 */
const here = fileURLToPath(new URL('.', import.meta.url))
const FIXTURE_CORPUS = join(here, 'cli', 'fixtures', 'corpus')

function silentRunDeps(engine: ReturnType<typeof buildEngine>): RunDeps {
  return {
    buildEngine: () => engine,
    stdout: { write: () => true },
    stderr: { write: () => true },
    env: { NO_COLOR: '1' },
  }
}

describe('consumer tag == real transport (TKT-424 gate)', () => {
  it('MCP search -> mcp, CLI ask -> cli, HTTP search -> http (real ledger)', async () => {
    const engine = buildEngine({ corpusPath: FIXTURE_CORPUS })

    // one deterministic query per transport (all dry/search — no LLM, no key)
    await searchTool(engine, { query: 'mcp-probe-marker' })
    await run(['ask', 'cli-probe-marker', '--dry'], silentRunDeps(engine))
    const { app } = buildApp(engine)
    await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'http-probe-marker' }),
    })

    const log = engine.queryLog()
    const tagFor = (query: string): string | undefined =>
      log.find((e) => e.query === query)?.consumer

    expect(tagFor('mcp-probe-marker')).toBe('mcp') // was 'cli' — the bug
    expect(tagFor('cli-probe-marker')).toBe('cli')
    expect(tagFor('http-probe-marker')).toBe('http')

    // every entry is one of the three REAL transports — no leftover 'package' (the non-dry
    // conflation) and 'cli-dry' is not even a valid Consumer (the mode leak is gone by type).
    expect(
      log.every((e) => e.consumer === 'mcp' || e.consumer === 'cli' || e.consumer === 'http'),
    ).toBe(true)
  }, 30000)

  it('HTTP with X-Consumer: web → the ledger records "web" (the standalone UI tag) — TKT-433', async () => {
    const engine = buildEngine({ corpusPath: FIXTURE_CORPUS })
    const { app } = buildApp(engine)
    await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Consumer': 'web' },
      body: JSON.stringify({ query: 'web-probe-marker' }),
    })
    // and a bare request (no override) stays 'http' — the default is unchanged
    await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'http-default-marker' }),
    })

    const log = engine.queryLog()
    const tagFor = (query: string): string | undefined =>
      log.find((e) => e.query === query)?.consumer
    expect(tagFor('web-probe-marker')).toBe('web')
    expect(tagFor('http-default-marker')).toBe('http')
  }, 30000)
})
