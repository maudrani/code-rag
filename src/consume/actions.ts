import type { Engine, EngineConfig } from '../contracts/engine.js'
import type { Projection, Turn } from '../contracts/projection.js'
import type { Consumer, Observable } from '../contracts/telemetry.js'
import { walk } from '../ingest/walker.js'
import { createEngine } from '../package/index.js'
import { JsonlLedgerSink, resolveLedgerPath, withLedger } from './ledger.js'

/**
 * resolveEngineConfig — config precedence: explicit arg > env (CORPUS_PATH,
 * ANTHROPIC_API_KEY, CODE_RAG_INDEX) > engine default. Undefined keys are OMITTED
 * (never set to `undefined`) so they don't trip exactOptionalPropertyTypes at createEngine.
 *
 * This is the ONE loader every consumer funnels through (buildEngine → createEngine), so
 * adding a env-fed key here wires it for the HTTP server, the CLI, AND the MCP serve at
 * once — no per-call-site drift. `CODE_RAG_INDEX` is the warm-restart index path (FTR-57):
 * a second run re-embeds only changed files (minutes → seconds); unset = today's cold index.
 */
export function resolveEngineConfig(
  config: EngineConfig = {},
  env: NodeJS.ProcessEnv = process.env,
): EngineConfig {
  const corpusPath = config.corpusPath ?? env.CORPUS_PATH
  const apiKey = config.apiKey ?? env.ANTHROPIC_API_KEY
  const indexPath = config.indexPath ?? env.CODE_RAG_INDEX
  const dense = config.dense ?? parseDense(env.CODE_RAG_DENSE)
  const resolved: EngineConfig = {}
  if (corpusPath !== undefined) resolved.corpusPath = corpusPath
  if (apiKey !== undefined) resolved.apiKey = apiKey
  if (indexPath !== undefined) resolved.indexPath = indexPath
  if (dense !== undefined) resolved.dense = dense
  return resolved
}

/**
 * CODE_RAG_DENSE → boolean | undefined (TKT-448). false/0/off/no → false (BM25+structural only:
 * fully offline, no ~25MB model download, heat-safe — one ONNX at a time); true/1/on/yes → true.
 * Unset / empty / anything else → undefined, so it falls through to the membrane default
 * (dense on in a live process) — behaviour is UNCHANGED unless the switch is set on purpose.
 */
function parseDense(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined
  const v = raw.trim().toLowerCase()
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false
  if (v === 'true' || v === '1' || v === 'on' || v === 'yes') return true
  return undefined
}

/**
 * The heat guard's ceiling. Above this many files, a COLD dense index (the local MiniLM model runs once
 * per chunk) can peg CPU + swap and FREEZE a laptop. A deliberate corpus — a small `--repo`, a
 * `CORPUS_PATH` subdir — sits well under; the danger is the naive `code-rag ask` that self-indexes a
 * whole repo. ky (~52 files) passes; a full repo (hundreds) is refused. Bypass: CODE_RAG_ALLOW_BIG_DENSE.
 */
export const DENSE_COLD_FILE_CAP = 200

function truthy(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

/**
 * assertDenseAskSafe — a backstop for the ONE remaining heat footgun after dense went opt-in: someone
 * EXPLICITLY sets CODE_RAG_DENSE=true and then `code-rag ask` self-indexes a whole repo, cold-embedding
 * every chunk (the local MiniLM runs per chunk → CPU + swap → freeze). Dense is now OFF by default, so a
 * bare `ask` runs BM25 + structural and is heat-safe — this only guards the explicit dense-on case. It
 * walks the corpus FIRST (cheap file discovery, no embedding) and throws an ACTIONABLE error above the
 * cap. No-op unless dense is explicitly on. `walkFn` is injected so it is unit-testable offline.
 */
export function assertDenseAskSafe(
  corpusDir: string,
  env: NodeJS.ProcessEnv = process.env,
  walkFn: (root: string) => { files: string[] } = walk,
): void {
  // Dense is opt-in now: only an EXPLICIT CODE_RAG_DENSE=true can cold-embed. Unset/false → BM25 +
  // structural (no ONNX, no heat), so a bare `ask` is always safe and must not be blocked.
  if (parseDense(env.CODE_RAG_DENSE) !== true) return
  if (truthy(env.CODE_RAG_ALLOW_BIG_DENSE)) return // explicit "this box can take it"
  let fileCount: number
  try {
    fileCount = walkFn(corpusDir).files.length
  } catch {
    return // cannot walk (missing dir, etc.) -> let the engine surface the real error, don't mask it
  }
  if (fileCount <= DENSE_COLD_FILE_CAP) return
  throw new Error(
    `refusing to dense-embed ${fileCount} files from "${corpusDir}" cold — CODE_RAG_DENSE=true + the ` +
      `local model runs per chunk, which can FREEZE the machine (the >${DENSE_COLD_FILE_CAP}-file footgun).\n` +
      `Pick one:\n` +
      `  - drop the dense leg (default): unset CODE_RAG_DENSE — BM25 + structural is heat-safe\n` +
      `  - a smaller corpus:            CORPUS_PATH=src/contracts code-rag ask "..."\n` +
      `  - a specific repo:             code-rag ask --repo <git-url> "..."\n` +
      `  - override (you accept the load): CODE_RAG_ALLOW_BIG_DENSE=1 code-rag ask "..."`,
  )
}

/**
 * buildEngine — the single place config becomes an Engine, so no two loaders drift.
 * Returns `Engine & Observable` (what createEngine returns): the query/answer verbs
 * PLUS the telemetry read-surface the stats/health/log transports need.
 *
 * When `CODE_RAG_LEDGER` is set, the engine is wrapped so every query ALSO appends its
 * entry to the shared cross-consumer JSONL ledger (the dashboard funnel, §5.3). Env-gated:
 * unset (tests, default) → in-memory only, no fs writes, today's behavior.
 */
export function buildEngine(
  config: EngineConfig = {},
  env: NodeJS.ProcessEnv = process.env,
): Engine & Observable {
  const engine = createEngine(resolveEngineConfig(config, env))
  const ledgerPath = resolveLedgerPath(env)
  return ledgerPath === undefined ? engine : withLedger(engine, new JsonlLedgerSink(ledgerPath))
}

export interface AskOptions {
  /** dry = deterministic membrane only (`query()`); no LLM, no cost. */
  dry?: boolean
  history?: Turn[]
  /** called once with the Projection as soon as `query()` returns — BEFORE the
   *  answer streams. Lets a consumer render citations/decision first (header-first,
   *  mirroring the HTTP wire's `meta`-before-`token` order). */
  onProjection?: (projection: Projection) => void
  /** called once per streamed answer token (for live output). */
  onToken?: (token: string) => void
}

/** A Projection always; an `answer` only when the gate actually answered (discriminated). */
export type AskResult =
  | { projection: Projection; answered: false }
  | { projection: Projection; answer: string; answered: true }

/**
 * ask — the shared query→branch→answer orchestration each transport binds. Always
 * runs the deterministic membrane (`query`). If `dry` or the gate refused, it stops
 * there (no LLM call). Otherwise it streams `answer()`, pushing each token to
 * `onToken` and accumulating the full answer.
 *
 * `consumer` is the TRANSPORT identity (mcp | cli | http | package) — the ledger tag.
 * It is EXPLICIT (not derived from `dry`): the earlier `dry ? 'cli-dry' : 'package'`
 * conflated mode with consumer, so every MCP/CLI query was mislabeled (TKT-424). `dry`
 * is a MODE (whether to stream answer()), orthogonal to who is asking.
 */
export async function ask(
  engine: Engine,
  question: string,
  consumer: Consumer,
  opts: AskOptions = {},
): Promise<AskResult> {
  const history = opts.history ?? []
  // The consumer IS the ledger tag; ConsumerIntent is now aligned 1:1 with Consumer (TKT-424),
  // so the transport identity passes straight through, no cast.
  const projection = await engine.query(question, history, consumer)
  opts.onProjection?.(projection) // header-first: projection known before any answer token

  if (opts.dry || projection.decision.band !== 'answer') {
    return { projection, answered: false }
  }

  let answer = ''
  for await (const chunk of engine.answer(projection, history)) {
    if (chunk.type === 'token') {
      answer += chunk.text
      opts.onToken?.(chunk.text)
    }
  }
  return { projection, answer, answered: true }
}
