import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * loadEnvFile — a tiny zero-dependency `.env` loader for the CLI/server/MCP ENTRYPOINTS, so a stranger
 * fills ANTHROPIC_API_KEY + CORPUS_PATH ONCE in a file instead of exporting them on every command.
 *
 * Deliberately NOT the `dotenv` package (a runtime dep, cwd-only) nor Node's `process.loadEnvFile`
 * (v20.12+, throws on a missing file, no upward search). This gives exactly the three semantics we need:
 *   1. Walk UP from `startDir` to the filesystem root for the nearest `.env` — found whether you run
 *      from the repo root or a subdir; cross-OS (terminates when `dirname(dir) === dir` at `/` or a
 *      Windows drive root).
 *   2. NEVER override an already-set var — real shell exports and Docker/compose env always win.
 *   3. A missing `.env` (or any read error) is a silent no-op — clone-and-run with only real exports,
 *      or inside the Docker image (which ships no `.env`), still works.
 *
 * Import it ONLY from the entrypoints (inside their `isDirectRun` block), never from `src/consume/**`
 * or the membrane — those stay pure + env-injected + unit-testable. A no-op under VITEST so a spawned
 * CLI subprocess in a test never picks up the repo's real (secret-bearing) `.env`.
 */
export function loadEnvFile(
  opts: { startDir?: string; env?: NodeJS.ProcessEnv } = {},
): string | undefined {
  const env = opts.env ?? process.env
  if (env.VITEST !== undefined) return undefined // never auto-load during a test run

  const file = findEnvFile(opts.startDir ?? process.cwd())
  if (file === undefined) return undefined

  try {
    for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
      const line = rawLine.trim()
      if (line === '' || line.startsWith('#')) continue
      const body = line.startsWith('export ') ? line.slice('export '.length) : line
      const eq = body.indexOf('=')
      if (eq === -1) continue
      const key = body.slice(0, eq).trim()
      if (key === '') continue
      // Non-destructive: a value already in the env (real export / compose) is authoritative.
      if (env[key] !== undefined) continue
      env[key] = stripQuotes(body.slice(eq + 1).trim())
    }
    return file
  } catch {
    return undefined // unreadable / racing — degrade to no-op, never crash an entrypoint
  }
}

/**
 * The nearest `.env` walking up from `start`, or undefined. Bounded to the repo: the search STOPS at the
 * repo root (a dir containing `.git`) so a globally-linked `code-rag` run from an unrelated directory can
 * never escape upward and silently load a stray `$HOME/.env` (foreign CORPUS_PATH/key). The `.env` is
 * checked BEFORE the `.git` ceiling at each level, so a repo-root `.env` is still found; running from a
 * subdir (e.g. `web/`, which has its own package.json but no `.git`) still reaches the root `.env`.
 * Cross-OS: terminates at `/` (POSIX) or a drive root (Windows) when there is no `.git` anywhere above.
 */
function findEnvFile(start: string): string | undefined {
  let dir = start
  for (;;) {
    const candidate = join(dir, '.env')
    if (existsSync(candidate)) return candidate
    if (existsSync(join(dir, '.git'))) return undefined // repo root, no .env here — don't escape it
    const parent = dirname(dir)
    if (parent === dir) return undefined // reached `/` (POSIX) or a drive root (Windows)
    dir = parent
  }
}

/** Strip ONE matching pair of surrounding single/double quotes (dotenv convention). */
function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    if ((first === '"' || first === "'") && value[value.length - 1] === first) {
      return value.slice(1, -1)
    }
  }
  return value
}
