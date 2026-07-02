#!/usr/bin/env node
import { buildEngine, isDirectRun } from '../consume/index.js'
import { EXIT } from './errors.js'
import { type RunDeps, run } from './run.js'

/** The shipped runtime wiring (real engine, real streams, real env). */
function realDeps(): RunDeps {
  return {
    buildEngine,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    isTTY: process.stdout.isTTY ?? false,
  }
}

/** Entry point — returns the process exit code. Exported for direct testing. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return run(argv, realDeps())
}

// Import-safe: auto-run only when executed directly (`node dist/…`, `tsx src/…`, or the
// `code-rag` bin via `npm link`), never on import — the realpath-safe guard (TKT-447).
if (isDirectRun(process.argv[1], import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(EXIT.ERROR)
    })
}
