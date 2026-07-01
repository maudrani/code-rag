import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type RunDeps, run } from '../../src/cli/run.js'
import { buildEngine } from '../../src/consume/index.js'
import type { QueryLogEntry } from '../../src/contracts/index.js'
import { buildApp } from '../../src/http/app.js'
import { searchTool } from '../../src/mcp/tools.js'

/**
 * CONSUMER CONNECTIVITY — the "5 consumers, one Projection" thesis, deterministically proven (master).
 *
 * parity.test proves the observability surfaces serialize identically over a MOCK engine. This proves
 * the REAL retrieval path is one connected graph: the SAME query through package + HTTP + CLI + MCP
 * hits ONE real engine, so every consumer's entry in the ONE shared ledger carries the SAME retrieval
 * (resultCount / band / scoresByLeg) under a DIFFERENT consumer tag. The ledger is the witness — a
 * consumer that bypassed the membrane (its own engine / its own retrieval) would DIVERGE here.
 *
 * Deterministic + reproducible: dense OFF under vitest, no API key, a fixed fixture corpus -> the same
 * retrieval every run. --dry / search only (no LLM).
 */
const here = fileURLToPath(new URL('.', import.meta.url))
const FIXTURE_CORPUS = join(here, 'cli', 'fixtures', 'corpus')
const QUERY = 'how does greet work'

function silentRunDeps(engine: ReturnType<typeof buildEngine>): RunDeps {
  return {
    buildEngine: () => engine,
    stdout: { write: () => true },
    stderr: { write: () => true },
    env: { NO_COLOR: '1' },
  }
}

/** The retrieval fingerprint of a consumer's ledger entry — identical across consumers iff they share the engine. */
function core(log: QueryLogEntry[], consumer: string) {
  const e = log.find((x) => x.consumer === consumer)
  if (!e) throw new Error(`no ledger entry for consumer '${consumer}'`)
  return { query: e.query, resultCount: e.resultCount, band: e.band, scoresByLeg: e.scoresByLeg }
}

describe('consumer connectivity — 5 consumers, one Projection, one ledger (deterministic)', () => {
  it('the SAME query via package + HTTP + CLI + MCP hits ONE engine with ONE retrieval', async () => {
    const engine = buildEngine({ corpusPath: FIXTURE_CORPUS })

    await engine.query(QUERY, [], 'package') // package (in-process)
    const { app } = buildApp(engine)
    await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY }),
    }) // HTTP
    await run(['ask', QUERY, '--dry'], silentRunDeps(engine)) // CLI
    await searchTool(engine, { query: QUERY }) // MCP

    const log = engine.queryLog()

    // (1) CONNECTIVITY — ONE ledger holds all four; every consumer wrote to the SAME engine.
    expect(log).toHaveLength(4)
    expect(new Set(log.map((e) => e.consumer))).toEqual(new Set(['package', 'http', 'cli', 'mcp']))

    // (2) CONSISTENCY — the SAME query yielded the SAME retrieval on every consumer (one membrane).
    const pkg = core(log, 'package')
    expect(pkg.resultCount).toBeGreaterThan(0) // non-vacuous: real retrieval happened
    expect(core(log, 'http')).toEqual(pkg)
    expect(core(log, 'cli')).toEqual(pkg)
    expect(core(log, 'mcp')).toEqual(pkg)
  }, 30000)

  it('NON-VACUITY: a second engine has its OWN ledger — it never sees the first engine queries', async () => {
    const a = buildEngine({ corpusPath: FIXTURE_CORPUS })
    const b = buildEngine({ corpusPath: FIXTURE_CORPUS })
    await a.query(QUERY, [], 'package')
    expect(a.queryLog()).toHaveLength(1)
    // isolated — so the connectivity proven above is real per-engine wiring, not a global singleton.
    expect(b.queryLog()).toHaveLength(0)
  }, 30000)
})
