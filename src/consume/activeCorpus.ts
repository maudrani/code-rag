import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * The shared "active corpus" pointer (FTR-5 follow-up). Today every consumer resolves a repo
 * INDEPENDENTLY — the web ingests one repo while the CLI/MCP/server each read their own --repo /
 * CODE_RAG_REPO. This is the shared, cross-PROCESS half: whenever ANY consumer resolves/ingests a
 * repo, it writes the choice to one file (`CODE_RAG_STATE`), and every consumer READS that file on
 * startup — a single, DYNAMIC source of truth. Opt-in via CODE_RAG_STATE (exactly like CODE_RAG_LEDGER):
 * when UNSET, behaviour is EXACTLY today (each consumer independent) — a hard no-regression requirement.
 */

/** The active corpus: `url` = the repo identity; `path` = the local clone dir a consumer indexes. */
export interface ActiveCorpus {
  url: string
  path: string
}

/** The shared-state path from the environment (`CODE_RAG_STATE`); undefined = not configured. */
export function activeCorpusFile(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const file = env.CODE_RAG_STATE
  return file !== undefined && file.trim() !== '' ? file.trim() : undefined
}

/**
 * readActiveCorpus — the current shared pointer, or undefined. undefined when CODE_RAG_STATE is unset,
 * the file is missing, the JSON is invalid, `url`/`path` are not strings, OR the recorded `path` dir no
 * longer exists (a stale pointer must not be followed to a deleted clone). NEVER throws — a broken/racing
 * state file must degrade to "no shared pointer" (i.e. today's independent behaviour), never crash a
 * consumer on startup.
 */
export function readActiveCorpus(env: NodeJS.ProcessEnv = process.env): ActiveCorpus | undefined {
  const file = activeCorpusFile(env)
  if (file === undefined) return undefined
  try {
    if (!existsSync(file)) return undefined
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { url, path } = parsed as { url?: unknown; path?: unknown }
    if (typeof url !== 'string' || typeof path !== 'string') return undefined
    if (!existsSync(path)) return undefined // stale pointer → the clone dir is gone
    return { url, path }
  } catch {
    return undefined // missing / invalid / racing write — degrade to no shared pointer, never throw
  }
}

/**
 * writeActiveCorpus — record the shared pointer. A no-op when CODE_RAG_STATE is unset (opt-in; today's
 * independent behaviour). Otherwise mkdir the parent dir and write ATOMICALLY: write to `<file>.tmp`
 * then rename onto `<file>` (rename is atomic on POSIX), so a concurrent reader never sees a torn/partial
 * JSON — it sees either the old file or the fully-written new one. No Date/Math.random (determinism guard).
 */
export function writeActiveCorpus(
  corpus: ActiveCorpus,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const file = activeCorpusFile(env)
  if (file === undefined) return
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(corpus))
  renameSync(tmp, file)
}
