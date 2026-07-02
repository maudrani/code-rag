import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * resolveCorpus (FTR-5) — the assignment wants "a GitHub repo OR local files". A repo URL resolves to a
 * LOCAL dir (a shallow clone); a local path passes through unchanged, so nothing downstream changes
 * (buildEngine still indexes a local dir; the walker already ignores .git). The clone is an INJECTABLE
 * seam so the test suite stays deterministic (a fake copies a fixture) — the real clone is network I/O
 * behind RUN_SLOW. Injection-safety is load-bearing: the URL reaches `git` as an ARG (never a shell
 * string), plus an allowlist that rejects git's command-executing transports (ext::) and arg-injection.
 */

const execFileAsync = promisify(execFile)

/** Anything that looks like a URL/transport (has a scheme, a `word::` transport, or scp `user@host:`). */
const URLISH = /^([a-z][a-z0-9+.-]*:\/\/|[a-z][a-z0-9+.-]*::|[\w.-]+@[\w.-]+:)/i
/** The ALLOWLISTED git remotes we clone: http(s)/git/ssh schemes + scp-like `git@host:owner/repo`. */
const GIT_SCHEME = /^(https?|git|ssh):\/\//i
const SCP_LIKE = /^[\w.-]+@[\w.-]+:[\w./~-]+$/
/** Whitespace + shell metacharacters — a malicious/malformed remote; rejected defensively. */
const SHELL_META = /[\s;&|`$(){}<>'"\\]/

/** Is `source` an allowlisted git repo URL (vs a local filesystem path)? */
export function isRepoUrl(source: string): boolean {
  return GIT_SCHEME.test(source) || SCP_LIKE.test(source)
}

/** Redact userinfo (a token/password) from a URL so it never lands in an error/log (secret-leak guard). */
export function redactUrl(url: string): string {
  return url.replace(/\/\/[^/@]+@/, '//***@')
}

/**
 * assertSafeRepoUrl — throw unless `url` is a safe git remote. execFile already blocks SHELL injection
 * (the URL is an arg, no shell); these guards close GIT-LEVEL vectors: a leading '-' (argument
 * injection), whitespace/metacharacters, and — critically — the `ext::`/`file::`/`fd::` transports
 * (git will execute an arbitrary command for `ext::`), which the allowlist rejects.
 */
export function assertSafeRepoUrl(url: string): void {
  if (url.startsWith('-')) {
    throw new Error(`unsafe repo URL (leading '-' → git argument injection): ${redactUrl(url)}`)
  }
  if (SHELL_META.test(url)) {
    throw new Error(`unsafe repo URL (whitespace / shell metacharacters): ${redactUrl(url)}`)
  }
  if (!isRepoUrl(url)) {
    throw new Error(
      `unsupported repo URL — allowed: https|http|git|ssh://… or git@host:path (ext::/file:///fd:: rejected): ${redactUrl(url)}`,
    )
  }
}

/** the local clone target for a URL — a hash of the URL, so a repeat run can reuse it (cache: TKT-445). */
export function repoCacheDir(url: string): string {
  const key = createHash('sha256').update(url).digest('hex').slice(0, 16)
  return join(tmpdir(), 'code-rag-repos', key)
}

export interface CloneDeps {
  /** injected so tests stay deterministic (a fake copies a fixture); default = a real shallow git clone. */
  clone?: (url: string, dest: string) => Promise<void>
  /** injected `git pull` for a repeat run on a cached clone; default = a real shallow pull. */
  pull?: (dest: string) => Promise<void>
  /** CODE_RAG_GITHUB_TOKEN for a private repo — injected into an https URL; NEVER logged (redactUrl). */
  token?: string
}

/** The default cloner: shallow, arg-passed (NO shell), `--` guards a dash-leading URL (defence-in-depth). */
async function gitClone(url: string, dest: string): Promise<void> {
  try {
    await execFileAsync('git', ['clone', '--depth', '1', '--', url, dest])
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    // redact the URL + any URL echoed in git's message — never leak a token (TKT-445).
    throw new Error(`git clone failed for ${redactUrl(url)}: ${redactUrl(detail)}`)
  }
}

/** The default pull for a cached clone (repeat run) — shallow, arg-passed. */
async function gitPull(dest: string): Promise<void> {
  await execFileAsync('git', ['-C', dest, 'pull', '--depth', '1'])
}

/** Inject a token into an https URL (https://host/… → https://<token>@host/…) for a private repo;
 *  only https (ssh/git use keys). Any existing userinfo is replaced. The token is never logged. */
function withToken(url: string, token: string): string {
  return url.replace(/^https:\/\/(?:[^/@]+@)?/i, `https://${token}@`)
}

/**
 * resolveCorpus — a repo URL resolves to a local dir; a local path passes through unchanged. A URL-ish
 * string that is NOT an allowlisted git remote is REJECTED (never reaches `git`). A repeat run reuses the
 * stable URL-hashed cache dir via `git pull` (warm-restart-friendly, TKT-445); a failed pull falls back
 * to a fresh clone. A token (private repo) is injected into the https remote and never logged.
 */
export async function resolveCorpus(source: string, deps: CloneDeps = {}): Promise<string> {
  if (!URLISH.test(source)) return source // a plain local path — passthrough
  assertSafeRepoUrl(source) // URL-ish → must be a safe allowlisted git remote, else reject
  const clone = deps.clone ?? gitClone
  const pull = deps.pull ?? gitPull
  const dest = repoCacheDir(source) // stable per-URL → warm-restart reuses it
  if (existsSync(join(dest, '.git'))) {
    // already cloned → pull (paths stay constant for CODE_RAG_INDEX warm-restart). On failure, re-clone.
    try {
      await pull(dest)
      return dest
    } catch {
      rmSync(dest, { recursive: true, force: true })
    }
  }
  const remote = deps.token !== undefined ? withToken(source, deps.token) : source
  await clone(remote, dest)
  return dest
}

export interface CorpusSourceOpts {
  /** an explicit --repo flag (highest precedence). */
  repo?: string
  /** the process env (CODE_RAG_REPO + CODE_RAG_GITHUB_TOKEN). */
  env?: NodeJS.ProcessEnv
  /** injectable clone/pull seam for deterministic tests. */
  deps?: CloneDeps
}

/**
 * resolveCorpusSource — the ONE resolver every entrypoint (CLI/server/MCP) calls before buildEngine:
 * precedence explicit --repo > CODE_RAG_REPO > undefined (→ fall through to CORPUS_PATH in buildEngine).
 * Returns a LOCAL dir (cloned/pulled) or undefined. Mirrors CORPUS_PATH's single-loader discipline so a
 * URL wires to the server, CLI, and MCP at once. The token is read from env (never a flag → never in ps).
 */
export async function resolveCorpusSource(
  opts: CorpusSourceOpts = {},
): Promise<string | undefined> {
  const env = opts.env ?? process.env
  const repoUrl = (opts.repo ?? env.CODE_RAG_REPO)?.trim()
  if (repoUrl === undefined || repoUrl === '') return undefined
  const token = env.CODE_RAG_GITHUB_TOKEN?.trim()
  const deps: CloneDeps = { ...opts.deps }
  if (token !== undefined && token !== '') deps.token = token
  return resolveCorpus(repoUrl, deps)
}
