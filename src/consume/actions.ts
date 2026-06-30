import type { Engine, EngineConfig } from '../contracts/engine.js'
import type { Projection, Turn } from '../contracts/projection.js'
import type { Observable } from '../contracts/telemetry.js'
import { createEngine } from '../package/index.js'

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
 */
export function buildEngine(config: EngineConfig = {}): Engine & Observable {
  return createEngine(resolveEngineConfig(config))
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
 * ask — the shared query→branch→answer orchestration both transports bind.
 * Always runs the deterministic membrane (`query`). If `dry` or the gate refused,
 * it stops there (no LLM call). Otherwise it streams `answer()`, pushing each
 * token to `onToken` and accumulating the full answer.
 */
export async function ask(
  engine: Engine,
  question: string,
  opts: AskOptions = {},
): Promise<AskResult> {
  const history = opts.history ?? []
  // intent is currently cosmetic (the membrane ignores it); 'cli-dry' marks the no-LLM path.
  const projection = await engine.query(question, history, opts.dry ? 'cli-dry' : 'package')
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
