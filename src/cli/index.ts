#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildEngine } from '../consume/index.js'
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

// Import-safe: auto-run only when executed directly (`node dist/src/cli/index.js`,
// `tsx src/cli/index.ts`, OR the `code-rag` bin via `npm link`), never on import (keeps
// tests side-effect free). `npm link` invokes through a symlink, so process.argv[1] is the
// symlink while import.meta.url is its REALPATH — realpathSync(argv[1]) reconciles them so the
// guard fires for the shipped binary too (regression: it silently no-op'd through the link).
const invokedPath = process.argv[1]
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(invokedPath)).href
) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(EXIT.ERROR)
    })
}
