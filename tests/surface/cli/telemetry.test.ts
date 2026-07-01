import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CliError } from '../../../src/cli/errors.js'
import { parseCli } from '../../../src/cli/parse.js'
import { humanHealth, humanLog, humanStats, humanSymbols } from '../../../src/cli/render.js'
import { type RunDeps, run } from '../../../src/cli/run.js'
import {
  getHealth,
  getLogPayload,
  getStats,
  getSymbolsPayload,
} from '../../../src/consume/index.js'
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
    // VITEST is inherited by the subprocess → the dense/ONNX leg stays off (membrane denseOn gate).
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
