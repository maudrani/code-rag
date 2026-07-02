import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * isDirectRun — true when THIS module is the process entry (`node x.js`, `tsx x.ts`, or the `code-rag`
 * bin whose `npm link` symlink resolves here), false when the module is merely imported. The one guard
 * every CLI/server entrypoint uses to auto-run only when executed directly (never on import, so tests
 * and tooling stay side-effect free).
 *
 * process.argv[1] can be a SYMLINK (npm link puts one on PATH) while import.meta.url is its REALPATH,
 * so a naive `argv1 === import.meta.url` never fired for the linked bin — the command exited 0 with
 * ZERO output (TKT-447). realpathSync(argv1) reconciles the two. A non-existent / virtual argv1 (e.g. a
 * bundled entry that isn't a real file) is treated as not-direct rather than throwing.
 */
export function isDirectRun(argv1: string | undefined, moduleUrl: string): boolean {
  if (argv1 === undefined) return false
  try {
    return moduleUrl === pathToFileURL(realpathSync(argv1)).href
  } catch {
    return false
  }
}
