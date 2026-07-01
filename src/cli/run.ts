import type { AskOptions } from '../consume/index.js'
import {
  ask,
  buildEngine,
  getHealth,
  getLog,
  getStats,
  getSymbolsPayload,
  readLedger,
  resolveLedgerPath,
} from '../consume/index.js'
import type { Engine, EngineConfig } from '../contracts/engine.js'
import type { Consumer, Observable } from '../contracts/telemetry.js'
import { CliError, EXIT } from './errors.js'
import { parseCli } from './parse.js'
import {
  citationsHeader,
  humanDry,
  humanHealth,
  humanLog,
  humanStats,
  humanSymbols,
  jsonOut,
  telemetryJson,
} from './render.js'

const VERSION = '0.1.0'
const HELP = `code-rag — conversational RAG over a codebase

usage:
  code-rag ask <query> [--dry] [--json]      ask a question (grounded answer; --dry = retrieval only)
  code-rag stats [--layer L] [--json]        per-layer telemetry (L: ingest|chunk|index|retrieve|answer)
  code-rag health [--json]                   aggregate health (exit 1 if status is 'down')
  code-rag log [--consumer C] [--tail N] [--json]   the cross-consumer query ledger
  code-rag symbols [--json]                  the indexed code symbols (path, symbol, kind, span)

flags:
  --dry          deterministic retrieval only — no LLM, no cost, no API key
  --json         emit as JSON (pipeable) — the same shape the MCP tools return; the
                 stats/health/log surfaces are byte-identical across CLI, MCP, and HTTP
  -h, --help     show this help
  -V, --version  show the version
`

export interface OutStream {
  write(s: string): boolean
}

export interface RunDeps {
  /** injected so the entry passes the real factory and tests pass a fake/fixture engine.
   *  Returns Engine & Observable — the telemetry commands need the read-surface. */
  buildEngine?: (config?: EngineConfig) => Engine & Observable
  stdout: OutStream
  stderr: OutStream
  env: NodeJS.ProcessEnv
  /** stdout.isTTY — gates color along with NO_COLOR. */
  isTTY?: boolean
}

/**
 * run — the CLI orchestration: parse → build engine → ask → render. Returns the
 * process exit code (never throws; CliError carries its own code, anything else
 * is EXIT.ERROR). stdout is the data channel; all errors go to stderr.
 */
export async function run(argv: string[], deps: RunDeps): Promise<number> {
  const makeEngine = deps.buildEngine ?? buildEngine
  let json = false
  try {
    const cmd = parseCli(argv)
    if (cmd.command === 'help') {
      deps.stdout.write(HELP)
      return EXIT.OK
    }
    if (cmd.command === 'version') {
      deps.stdout.write(`${VERSION}\n`)
      return EXIT.OK
    }

    json = cmd.json
    const useColor = !deps.env.NO_COLOR && (deps.isTTY ?? false)

    // ─── telemetry read-surfaces (no LLM, no key) ───────────────────────────────
    if (cmd.command === 'stats') {
      const engine = makeEngine()
      const payload = cmd.layer === undefined ? getStats(engine) : getStats(engine, cmd.layer)
      deps.stdout.write(cmd.json ? `${telemetryJson(payload)}\n` : humanStats(payload))
      return EXIT.OK
    }
    if (cmd.command === 'health') {
      const report = getHealth(makeEngine())
      deps.stdout.write(cmd.json ? `${telemetryJson(report)}\n` : humanHealth(report, useColor))
      // 'down' is the only non-zero exit (per the telemetry.ts contract); 'degraded' warns, exits 0.
      return report.status === 'down' ? EXIT.ERROR : EXIT.OK
    }
    if (cmd.command === 'log') {
      const opts: { consumer?: Consumer; limit?: number } = {}
      if (cmd.consumer !== undefined) opts.consumer = cmd.consumer
      if (cmd.tail !== undefined) opts.limit = cmd.tail
      // Cross-process: read the SHARED ledger when CODE_RAG_LEDGER is set (so a standalone
      // `code-rag log` sees queries from other consumers — the isolated-ledger finding); else
      // this process's in-memory ledger. Both render as { entries } (the parity wire shape).
      const ledgerPath = resolveLedgerPath(deps.env)
      const entries =
        ledgerPath !== undefined ? readLedger(ledgerPath, opts) : getLog(makeEngine(), opts)
      deps.stdout.write(cmd.json ? `${telemetryJson({ entries })}\n` : humanLog(entries, useColor))
      return EXIT.OK
    }
    if (cmd.command === 'symbols') {
      // Read-only, no LLM, no key. Async: the engine ensures the index then projects its chunks.
      const payload = await getSymbolsPayload(makeEngine())
      deps.stdout.write(
        cmd.json ? `${telemetryJson(payload)}\n` : humanSymbols(payload.symbols, useColor),
      )
      return EXIT.OK
    }

    const streaming = !cmd.dry && !cmd.json // the only path that streams tokens

    const opts: AskOptions = { dry: cmd.dry }
    if (streaming) {
      opts.onProjection = (p) => deps.stdout.write(citationsHeader(p, useColor))
      opts.onToken = (t) => deps.stdout.write(t)
    }

    const result = await ask(makeEngine(), cmd.query, 'cli', opts)

    if (cmd.json) {
      deps.stdout.write(`${jsonOut(result.projection)}\n`)
    } else if (!result.answered) {
      // dry, or a refusal — show the deterministic projection.
      deps.stdout.write(humanDry(result.projection, useColor))
    } else {
      deps.stdout.write('\n') // terminate the streamed answer line
    }
    return EXIT.OK
  } catch (err) {
    const code = err instanceof CliError ? err.code : EXIT.ERROR
    const message = err instanceof Error ? err.message : String(err)
    deps.stderr.write(json ? `${JSON.stringify({ error: message })}\n` : `error: ${message}\n`)
    return code
  }
}
