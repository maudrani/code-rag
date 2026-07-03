import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CliError } from '../../../src/cli/errors.js'
import { parseCli } from '../../../src/cli/parse.js'
import {
  humanHealth,
  humanLog,
  humanStats,
  humanSymbols,
  telemetryJson,
} from '../../../src/cli/render.js'
import { type RunDeps, run } from '../../../src/cli/run.js'
import {
  getHealth,
  getLogPayload,
  getStats,
  getSymbolsPayload,
  JsonlLedgerSink,
  readLedger,
} from '../../../src/consume/index.js'
import type { Consumer, QueryLogEntry } from '../../../src/contracts/telemetry.js'
import { MOCK_HEALTH, MOCK_TELEMETRY, makeMockEngine } from '../fixtures/mock-engine.js'

// ─── parse ────────────────────────────────────────────────────────────────────
describe('parseCli — telemetry commands (TKT-418)', () => {
  it('stats with no layer', () => {
    expect(parseCli(['stats'])).toEqual({ command: 'stats', json: false })
  })
  it('stats --layer index --json', () => {
    expect(parseCli(['stats', '--layer', 'index', '--json'])).toEqual({
      command: 'stats',
      layer: 'index',
      json: true,
    })
  })
  it('health --json', () => {
    expect(parseCli(['health', '--json'])).toEqual({ command: 'health', json: true })
  })
  it('log --consumer mcp --tail 5', () => {
    expect(parseCli(['log', '--consumer', 'mcp', '--tail', '5'])).toEqual({
      command: 'log',
      consumer: 'mcp',
      tail: 5,
      json: false,
    })
  })
  it('log with no filters omits optional keys', () => {
    expect(parseCli(['log'])).toEqual({ command: 'log', json: false })
  })
  it('symbols with no flags', () => {
    expect(parseCli(['symbols'])).toEqual({ command: 'symbols', json: false })
  })
  it('symbols --json', () => {
    expect(parseCli(['symbols', '--json'])).toEqual({ command: 'symbols', json: true })
  })

  // failure twins — every misuse is EXIT.USAGE (code 2), never a raw throw
  it('FAIL: invalid --layer → CliError(USAGE)', () => {
    expect(() => parseCli(['stats', '--layer', 'membrane'])).toThrow(CliError)
    try {
      parseCli(['stats', '--layer', 'bogus'])
    } catch (e) {
      expect((e as CliError).code).toBe(2)
    }
  })
  it('FAIL: invalid --consumer → CliError(USAGE)', () => {
    expect(() => parseCli(['log', '--consumer', 'agent'])).toThrow(CliError)
  })
  it('FAIL: non-positive / non-integer --tail → CliError(USAGE)', () => {
    expect(() => parseCli(['log', '--tail', '0'])).toThrow(CliError)
    expect(() => parseCli(['log', '--tail', 'abc'])).toThrow(CliError)
    expect(() => parseCli(['log', '--tail', '-3'])).toThrow(CliError)
  })
})

// ─── render ─────────────────────────────────────────────────────────────────
describe('render — telemetry views (TKT-418)', () => {
  it('humanStats pretty-prints the payload', () => {
    expect(humanStats({ layer: 'index', data: MOCK_TELEMETRY.index })).toContain('"layer": "index"')
  })
  it('humanStats hints when a layer is cold (data:null) — human view only, JSON body kept — TKT-433', () => {
    const out = humanStats({ layer: 'retrieve', data: null })
    expect(out).toContain('"layer": "retrieve"') // the JSON payload is still shown
    expect(out).toContain('"data": null')
    expect(out.toLowerCase()).toContain('hint') // + a hint on how to populate it
    expect(out).toContain('ask')
    expect(out).toContain('/stats?layer=retrieve')
  })
  it('the --json path (telemetryJson) has NO hint for a cold layer — machines parse it (TKT-437)', () => {
    const out = telemetryJson({ layer: 'answer', data: null })
    expect(out).toBe('{"layer":"answer","data":null}') // machine-stable, unchanged
    expect(out.toLowerCase()).not.toContain('hint')
  })
  it('humanHealth shows the status and each check', () => {
    const out = humanHealth(MOCK_HEALTH, false)
    expect(out).toContain('ok')
    expect(out).toContain('indexed')
    expect(out).toContain('provider')
  })
  it('humanLog shows one line per entry, and a placeholder when empty', () => {
    expect(humanLog([], false)).toContain('no queries')
    const entry = MOCK_TELEMETRY.lastQuery?.retrieve
    if (entry) expect(humanLog([entry], false)).toContain(entry.queryId)
  })
  it('humanSymbols shows one line per symbol, and a placeholder when empty', () => {
    expect(humanSymbols([], false)).toContain('no symbols')
    const out = humanSymbols(
      [
        {
          path: 'a.ts',
          symbol: 'foo',
          kind: 'function',
          lang: 'typescript',
          span: { startLine: 1, endLine: 9 },
        },
      ],
      false,
    )
    expect(out).toContain('a.ts')
    expect(out).toContain('foo')
  })
})

// ─── run (DI mock engine) ─────────────────────────────────────────────────────
function capture(): { deps: RunDeps; out: () => string; err: () => string } {
  let outBuf = ''
  let errBuf = ''
  const deps: RunDeps = {
    buildEngine: () => makeMockEngine(),
    stdout: {
      write: (s) => {
        outBuf += s
        return true
      },
    },
    stderr: {
      write: (s) => {
        errBuf += s
        return true
      },
    },
    env: { NO_COLOR: '1' },
  }
  return { deps, out: () => outBuf, err: () => errBuf }
}

describe('run — telemetry commands (TKT-418)', () => {
  it('stats --json emits the full snapshot via getStats (the SSOT)', async () => {
    const { deps, out } = capture()
    const code = await run(['stats', '--json'], deps)
    expect(code).toBe(0)
    expect(JSON.parse(out().trim())).toEqual(getStats(makeMockEngine()))
  })
  it('stats --layer retrieve --json emits { layer, data }', async () => {
    const { deps, out } = capture()
    await run(['stats', '--layer', 'retrieve', '--json'], deps)
    expect(JSON.parse(out().trim())).toEqual(getStats(makeMockEngine(), 'retrieve'))
  })
  it('health --json emits the report; exit 0 when status is ok', async () => {
    const { deps, out } = capture()
    const code = await run(['health', '--json'], deps)
    expect(code).toBe(0)
    expect(JSON.parse(out().trim())).toEqual(getHealth(makeMockEngine()))
  })
  it('FAIL TWIN: health exits 1 when status is "down"', async () => {
    let outBuf = ''
    const deps: RunDeps = {
      buildEngine: () =>
        makeMockEngine({ health: { status: 'down', checks: { indexed: { ok: false } }, ts: 1 } }),
      stdout: {
        write: (s) => {
          outBuf += s
          return true
        },
      },
      stderr: { write: () => true },
      env: { NO_COLOR: '1' },
    }
    const code = await run(['health', '--json'], deps)
    expect(code).toBe(1)
    expect(JSON.parse(outBuf.trim()).status).toBe('down')
  })
  it('log --consumer mcp --json emits the filtered ledger as { entries } (parity shape)', async () => {
    const { deps, out } = capture()
    await run(['log', '--consumer', 'mcp', '--json'], deps)
    expect(JSON.parse(out().trim())).toEqual(getLogPayload(makeMockEngine(), { consumer: 'mcp' }))
  })
  it('symbols --json emits { symbols } via getSymbolsPayload (the SSOT)', async () => {
    const { deps, out } = capture()
    const code = await run(['symbols', '--json'], deps)
    expect(code).toBe(0)
    expect(JSON.parse(out().trim())).toEqual(await getSymbolsPayload(makeMockEngine()))
  })
  it('non-json stats writes a human view', async () => {
    const { deps, out } = capture()
    await run(['stats', '--layer', 'index'], deps)
    expect(out()).toContain('"layer": "index"')
  })
})

// ─── stats retrieve/answer — SHARED-ledger fallback (the Observability-tab command) ───────────────
describe('run — stats --layer retrieve/answer reads the shared ledger cross-process', () => {
  let dir = ''
  let file = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stats-ledger-'))
    file = join(dir, 'ledger.jsonl')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  // A fresh `code-rag stats` process ran no query of its own, so retrieve/answer are null in-memory —
  // even though the web promotes the SAME command and shows them (its long-running server HAS queried).
  // These lock the fix: the CLI falls back to CODE_RAG_LEDGER so the printed command actually works.
  const noQueryEngine = () => makeMockEngine({ telemetry: { ...MOCK_TELEMETRY, lastQuery: null } })
  const statsDeps = (env: NodeJS.ProcessEnv): { deps: RunDeps; out: () => string } => {
    let outBuf = ''
    return {
      deps: {
        buildEngine: noQueryEngine,
        stdout: {
          write: (s) => {
            outBuf += s
            return true
          },
        },
        stderr: { write: () => true },
        env,
      },
      out: () => outBuf,
    }
  }

  it('retrieve: with no in-process query, surfaces the shared ledger newest entry (ANY consumer)', async () => {
    new JsonlLedgerSink(file).append({
      ts: 1,
      queryId: 'q1',
      consumer: 'web', // a query issued by the WEB — the CLI stats must still see it
      query: 'how does ky retry',
      resultCount: 3,
      scoresByLeg: { bm25: 0.4, dense: 0, structural: 0.1 },
      band: 'answer',
      latencyMs: 12,
    })
    const { deps, out } = statsDeps({ NO_COLOR: '1', CODE_RAG_LEDGER: file })

    const code = await run(['stats', '--layer', 'retrieve', '--json'], deps)

    expect(code).toBe(0)
    const payload = JSON.parse(out().trim())
    expect(payload.data).not.toBeNull() // NOT null — the fallback filled it from the shared file
    expect(payload.data.query).toBe('how does ky retry') // the cross-consumer entry
    expect(payload.data.consumer).toBe('web')
  })

  it('answer: surfaces the newest ANSWERED entry’s L5 telemetry (real tier/model/tokens/cost)', async () => {
    const sink = new JsonlLedgerSink(file)
    sink.append({
      ts: 1,
      queryId: 'q1',
      consumer: 'web',
      query: 'how does ky retry',
      resultCount: 3,
      scoresByLeg: { bm25: 0.4, dense: 0, structural: 0.1 },
      band: 'answer',
      tier: 'cheap', // populated at L4 from the gate decision — the answer layer must echo it, not guess
      model: 'claude-haiku',
      latencyMs: 12,
    })
    sink.appendOutcome({ queryId: 'q1', answered: true, tokens: 42, estCost: 0.001 })
    const { deps, out } = statsDeps({ NO_COLOR: '1', CODE_RAG_LEDGER: file })

    await run(['stats', '--layer', 'answer', '--json'], deps)

    const payload = JSON.parse(out().trim())
    expect(payload.data).toEqual({
      band: 'answer',
      tier: 'cheap',
      model: 'claude-haiku',
      tokens: 42,
      estCost: 0.001,
    })
  })

  it('NON-VACUITY: retrieve stays honestly null when CODE_RAG_LEDGER is unset (no in-process query either)', async () => {
    const { deps, out } = statsDeps({ NO_COLOR: '1' }) // no ledger configured

    await run(['stats', '--layer', 'retrieve', '--json'], deps)

    expect(JSON.parse(out().trim()).data).toBeNull() // no fabrication — null is the honest answer
  })
})

// ─── e2e (real subprocess via tsx, NO API key) ────────────────────────────────
const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const cliEntry = join(repoRoot, 'src', 'cli', 'index.ts')
const tsxBin = join(repoRoot, 'node_modules', '.bin', 'tsx')
const fixtureCorpus = join(here, 'fixtures', 'corpus')

function runCli(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, ANTHROPIC_API_KEY: undefined }
  return spawnSync(tsxBin, [cliEntry, ...args], { cwd: repoRoot, encoding: 'utf8', env })
}

describe('CLI telemetry e2e (real engine, no key) — TKT-418', () => {
  it('health --json: exit 0 + a real HealthReport from the live engine', () => {
    const res = runCli(['health', '--json'])
    expect(res.status).toBe(0)
    const report = JSON.parse(res.stdout.trim()) as {
      status: string
      checks: Record<string, unknown>
    }
    expect(['ok', 'degraded', 'down']).toContain(report.status)
    expect(report.checks).toBeDefined()
  }, 30000)

  it('stats --layer index --json: exit 0 + a { layer, data } shape (no key)', () => {
    const res = runCli(['stats', '--layer', 'index', '--json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout.trim()) as { layer: string }
    expect(parsed.layer).toBe('index')
  }, 30000)

  it('log --json: exit 0 + { entries: [...] } (the parity wire shape)', () => {
    const res = runCli(['log', '--json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout.trim()) as { entries: unknown }
    expect(Array.isArray(parsed.entries)).toBe(true)
  }, 30000)

  it('symbols --json: exit 0 + { symbols:[...] } from the real engine over the fixture corpus (no key)', () => {
    // symbols() forces a real index build; point at the tiny fixture corpus so it's fast.
    // Dense is opt-in (default OFF), so the subprocess runs BM25 + structural — no ONNX, no model download.
    const res = spawnSync(tsxBin, [cliEntry, 'symbols', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, ANTHROPIC_API_KEY: undefined, CORPUS_PATH: fixtureCorpus },
    })
    expect(res.status, res.stderr).toBe(0)
    const parsed = JSON.parse(res.stdout.trim()) as {
      symbols: Array<{ path: string; span: unknown }>
    }
    expect(Array.isArray(parsed.symbols)).toBe(true)
    expect(parsed.symbols.length).toBeGreaterThan(0) // sample.ts yields at least one symbol
    expect(parsed.symbols[0]).toHaveProperty('path')
    expect(parsed.symbols[0]).toHaveProperty('span')
  }, 30000)
})

// ─── run log — the SHARED cross-process ledger (CODE_RAG_LEDGER) — TKT-440 ─────
describe('run log — shared cross-process ledger (CODE_RAG_LEDGER) — TKT-440', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cli-log-'))
    file = join(dir, 'ledger.jsonl')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const ledgerEntry = (queryId: string, consumer: Consumer = 'cli'): QueryLogEntry => ({
    ts: 1,
    queryId,
    consumer,
    query: queryId,
    resultCount: 0,
    scoresByLeg: { bm25: 0, dense: 0, structural: 0 },
    band: 'answer',
    latencyMs: 1,
  })
  const seed = (...entries: QueryLogEntry[]): void => {
    const sink = new JsonlLedgerSink(file)
    for (const e of entries) sink.append(e)
  }
  const logDeps = (env: NodeJS.ProcessEnv): { deps: RunDeps; out: () => string } => {
    let buf = ''
    return {
      deps: {
        buildEngine: () => makeMockEngine(),
        stdout: {
          write: (s) => {
            buf += s
            return true
          },
        },
        stderr: { write: () => true },
        env,
      },
      out: () => buf,
    }
  }

  it('CODE_RAG_LEDGER set → `log --json` reads the SHARED file (newest-first), not the in-memory ledger', async () => {
    seed(ledgerEntry('q1', 'cli'), ledgerEntry('q2', 'mcp'))
    const { deps, out } = logDeps({ NO_COLOR: '1', CODE_RAG_LEDGER: file })
    const code = await run(['log', '--json'], deps)
    expect(code).toBe(0)
    expect(JSON.parse(out().trim())).toEqual({ entries: readLedger(file) })
    // the sink namespaces queryId per process (globally unique in the shared file); assert order via
    // the unchanged `query` field. The CLI output still equals readLedger(file) (line above).
    expect(
      (JSON.parse(out().trim()) as { entries: QueryLogEntry[] }).entries.map((e) => e.query),
    ).toEqual(['q2', 'q1'])
  })

  it('--consumer filters the SHARED file (not the in-memory ledger)', async () => {
    seed(ledgerEntry('q1', 'cli'), ledgerEntry('q2', 'mcp'))
    const { deps, out } = logDeps({ NO_COLOR: '1', CODE_RAG_LEDGER: file })
    await run(['log', '--consumer', 'mcp', '--json'], deps)
    expect(
      (JSON.parse(out().trim()) as { entries: QueryLogEntry[] }).entries.map((e) => e.query),
    ).toEqual(['q2'])
  })

  it('EDGE: CODE_RAG_LEDGER set but the file is absent → { entries: [] } (graceful)', async () => {
    const { deps, out } = logDeps({ NO_COLOR: '1', CODE_RAG_LEDGER: join(dir, 'nope.jsonl') })
    const code = await run(['log', '--json'], deps)
    expect(code).toBe(0)
    expect(JSON.parse(out().trim())).toEqual({ entries: [] })
  })

  it('NEGATIVE: without CODE_RAG_LEDGER, log reads the in-memory ledger (getLog), NOT the shared file', async () => {
    seed(ledgerEntry('shared-only', 'mcp')) // in the file, but the env is unset
    const { deps, out } = logDeps({ NO_COLOR: '1' })
    await run(['log', '--json'], deps)
    const entries = (JSON.parse(out().trim()) as { entries: QueryLogEntry[] }).entries
    expect(entries.some((e) => e.queryId === 'shared-only')).toBe(false)
  })
})
