import type { Engine, EngineConfig } from '../contracts/engine.js'
import type { Projection, Turn } from '../contracts/projection.js'
import type { Consumer, Observable } from '../contracts/telemetry.js'
import { createEngine } from '../package/index.js'
import { JsonlLedgerSink, resolveLedgerPath, withLedger } from './ledger.js'

/**
 * resolveEngineConfig — config precedence: explicit arg > env (CORPUS_PATH,
 * ANTHROPIC_API_KEY) > engine default. Undefined keys are OMITTED (never set to
 * `undefined`) so they don't trip exactOptionalPropertyTypes at createEngine.
 */
export function resolveEngineConfig(
  config: EngineConfig = {},
  env: NodeJS.ProcessEnv = process.env,
): EngineConfig {
  const corpusPath = config.corpusPath ?? env.CORPUS_PATH
  const apiKey = config.apiKey ?? env.ANTHROPIC_API_KEY
  const resolved: EngineConfig = {}
  if (corpusPath !== undefined) resolved.corpusPath = corpusPath
  if (apiKey !== undefined) resolved.apiKey = apiKey
  return resolved
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
