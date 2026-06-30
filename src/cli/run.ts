import type { AskOptions } from '../consume/index.js'
import { ask, buildEngine } from '../consume/index.js'
import type { Engine, EngineConfig } from '../contracts/engine.js'
import { CliError, EXIT } from './errors.js'
import { parseCli } from './parse.js'
import { citationsHeader, humanDry, jsonOut } from './render.js'

const VERSION = '0.1.0'
const HELP = `code-rag — conversational RAG over a codebase

usage:
  code-rag ask <query> [--dry] [--json]

flags:
  --dry          deterministic retrieval only — no LLM, no cost, no API key
  --json         emit the projection as JSON (pipeable)
  -h, --help     show this help
  -V, --version  show the version
`

export interface OutStream {
  write(s: string): boolean
}

export interface RunDeps {
  /** injected so the entry passes the real factory and tests pass a fake/fixture engine. */
  buildEngine?: (config?: EngineConfig) => Engine
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
    const streaming = !cmd.dry && !cmd.json // the only path that streams tokens

    const opts: AskOptions = { dry: cmd.dry }
    if (streaming) {
      opts.onProjection = (p) => deps.stdout.write(citationsHeader(p, useColor))
      opts.onToken = (t) => deps.stdout.write(t)
    }

    const result = await ask(makeEngine(), cmd.query, opts)

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
