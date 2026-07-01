import type { GateDecision, RankedChunk, ScoreGate } from '../contracts/index.js'
import { COS_FLOOR } from '../contracts/index.js'

/**
 * scoreGate — the deterministic 2-signal gate (ADR-005, seam 1; TKT-301).
 *
 * Pure function the master-owned membrane imports and calls in `project()` to
 * populate `Projection.decision`. NO LLM, no I/O, no Date/random — given the same
 * inputs it always returns the same decision.
 *
 *   signal 1  grounding (lexical overlap) -> band   (the refuse floor)
 *   signal 2  complexity-proxy             -> tier   (cheap | strong) -> model
 *
 * The two signals are ORTHOGONAL (ADR-005): grounding decides *whether* to answer,
 * complexity decides *with which model*. One score must never do both jobs.
 */

/**
 * The grounding floor: lexical-overlap score strictly below this -> `band: 'refuse'`.
 *
 * The grounding signal is the fraction (0..1) of the query's significant terms that
 * appear in the top-K retrieved chunks' symbols + code — an ABSOLUTE, code-appropriate
 * measure of "does the retrieved code actually contain what the query asks about".
 *
 * This REPLACED the top fused-RRF score, which a real-corpus dogfood (2026-06-29) showed
 * is a poor grounding signal: RRF scores are rank-based and tiny (~0.01-0.03), so they
 * barely separate a grounded query (a real symbol present) from an off-topic one — e.g.
 * "createEngine" scored 0.0132 vs "airspeed velocity of an unladen swallow" 0.0116, a
 * 0.0007 gap that no floor can split. Lexical overlap separates them cleanly (1.0 vs 0.0).
 * Pure-semantic queries whose words differ from the code are the documented dense-leg /
 * jina-upgrade frontier — there, low overlap conservatively refuses.
 */
export const GROUNDING_FLOOR = 0.25

/**
 * The SEMANTIC grounding floor: a raw dense cosine at/above {@link COS_FLOOR} ALSO grounds an answer,
 * additively (by OR) with the lexical floor. Its ONE corpus-tuned value lives in the contract next to
 * RankedChunk.cosine (the SSOT retrieval measured + the eval gates); re-exported here for the gate's
 * callers/tests. NOT a calibrated confidence (peripheral-hub TKT-337).
 */
export { COS_FLOOR }

/** How many top hits define the semantic signal — max raw cosine over the best few (FTR-55). */
export const K_SEMANTIC = 3

/** How many top results define "the assembled context" for the file/symbol proxy. */
export const K_PROXY = 5

/**
 * Distinct files in the top-K results at/above which a NO-INTENT query is treated as genuinely
 * broad (the breadth backstop -> strong). RAISED from 2 (TKT-308): a 2-file spread is retrieval
 * noise, not answer complexity — RRF surfaces diverse files by design, so the old value forced
 * ~every query to `strong` and made the cheap tier vestigial (cost dogfood 2026-06-30:
 * ~$0.027/q strong measured vs ~$0.009 cheap modeled-never-measured). With K_PROXY=5, 4 means
 * "most of the retrieval window is distinct files" = real breadth. Intent (below) is the dominant
 * signal; this threshold only decides queries that carry NO intent verb.
 */
export const MULTI_FILE_THRESHOLD = 4

/** Model ids per tier (claude-api skill, locked; ADR-005: haiku=cheap, sonnet=strong). */
export const MODEL_CHEAP = 'claude-haiku-4-5'
export const MODEL_STRONG = 'claude-sonnet-4-6'

/**
 * Reasoning-intent keywords -> escalate to the strong tier (ADR-005).
 * Matched case-insensitively on WORD BOUNDARIES so "flower" does not trigger
 * "flow" and "whose" does not trigger "how".
 */
export const STRONG_INTENT = [
  'how',
  'why',
  'explain',
  'across',
  'flow',
  'compare',
  'relate',
  'trace',
] as const

const STRONG_INTENT_RE = STRONG_INTENT.map((kw) => new RegExp(`\\b${kw}\\b`, 'i'))

/**
 * Lookup-intent keywords -> bias the CHEAP tier (ADR-005: "where/what/find/show -> cheap";
 * "cheap for single-file factual lookup"). An explicit lookup ("where is X", "what does Y
 * return") asks for a localized fact a small model answers well — so it stays cheap EVEN when
 * retrieval spreads the result across several files (the dogfood's vestigial-cheap failure lived
 * exactly here). Strong (reasoning) intent is checked FIRST and dominates, so "show me HOW auth
 * flows" is still strong. Matched case-insensitively on word boundaries (same as STRONG_INTENT).
 */
export const CHEAP_INTENT = ['where', 'what', 'find', 'show', 'list', 'which'] as const

const CHEAP_INTENT_RE = CHEAP_INTENT.map((kw) => new RegExp(`\\b${kw}\\b`, 'i'))

/** Top-K retrieved chunks scanned for query-term overlap (the assembled-context horizon). */
export const K_GROUND = 10

/** Minimum length for a query token to count as a significant grounding term. */
const MIN_TERM_LEN = 3

/** Question / glue words that carry no grounding signal. */
const STOPWORDS = new Set([
  'how',
  'why',
  'what',
  'where',
  'when',
  'who',
  'which',
  'whose',
  'does',
  'did',
  'are',
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'its',
  'into',
  'from',
  'has',
  'have',
  'can',
  'will',
  'would',
  'should',
  'you',
  'your',
  'they',
  'them',
  'use',
  'used',
  'get',
])

/** Significant, de-duplicated query terms (alphanumeric, >= MIN_TERM_LEN, non-stopword). */
function significantTerms(query: string): string[] {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return [...new Set(tokens.filter((t) => t.length >= MIN_TERM_LEN && !STOPWORDS.has(t)))]
}

/**
 * Lexical grounding: the fraction of the query's significant terms present in the top-K
 * retrieved chunks' symbols + code. 0 = nothing the query asks about was retrieved.
 */
function lexicalGrounding(retrieval: RankedChunk[], resolvedQuery: string): number {
  const terms = significantTerms(resolvedQuery)
  if (terms.length === 0) return 0
  // Token-SET membership, not substring: "cat" must NOT ground "concatenate" (a substring
  // over-match an audit found). The haystack is tokenized the same way as the query terms.
  const haystackTokens = new Set(
    retrieval
      .slice(0, K_GROUND)
      .flatMap((r) => `${r.chunk.symbol} ${r.chunk.code}`.toLowerCase().match(/[a-z0-9]+/g) ?? []),
  )
  const hits = terms.filter((t) => haystackTokens.has(t)).length
  return hits / terms.length
}

/**
 * Semantic grounding: the MAX raw dense cosine over the top-K_SEMANTIC hits, IGNORING undefined
 * cosines. A hit with `cosine === undefined` had no dense candidate (bm25/structural-only) — that
 * is "no vector signal", NOT "zero relevance" — so it contributes nothing (a 0 would read as a
 * confident non-match and could suppress a real signal, TKT-337). Returns 0 when NO top-N hit
 * carries a cosine (no semantic signal available -> the lexical floor decides alone).
 */
function semanticGrounding(retrieval: RankedChunk[]): number {
  const cosines = retrieval
    .slice(0, K_SEMANTIC)
    .map((r) => r.cosine)
    .filter((c): c is number => c !== undefined)
  return cosines.length === 0 ? 0 : Math.max(...cosines)
}

export const scoreGate: ScoreGate = (retrieval, query) => {
  // ── signal 1: grounding -> band (lexical OR semantic; FTR-55) ─────────────
  // Two ADDITIVE grounding signals (design §4). Lexical overlap: the share of the query's
  // significant terms present in the retrieved code. Semantic: the top hits' raw dense cosine —
  // the ABSOLUTE relevance the rank-based `fused` score can't express (TKT-337). The OR is
  // deliberate and MONOTONE: either signal strong -> answer, so it only ever turns a lexical
  // refuse into an answer (fixing pure-NL false-refuse + a semantically off-topic refuse) and
  // NEVER regresses a lexically-grounded query. `cosine` is undefined until retrieval/membrane
  // thread it (FTR-55 Phase 1/3), so this OR is a safe no-op today (semanticScore 0 < COS_FLOOR).
  // GateDecision.groundingScore stays the LEXICAL score (design §4); semanticScore is internal.
  const groundingScore = lexicalGrounding(retrieval, query.resolvedQuery)
  const semanticScore = semanticGrounding(retrieval)
  const grounded = groundingScore >= GROUNDING_FLOOR || semanticScore >= COS_FLOOR
  const band: GateDecision['band'] = grounded ? 'answer' : 'refuse'

  // ── signal 2: complexity-proxy -> tier -> model ──────────────────────────
  // Distinct files over the top-K results approximate "files in the assembled
  // context" (the context IS the top results) with zero contract change.
  const distinctFiles = new Set(retrieval.slice(0, K_PROXY).map((r) => r.chunk.path)).size

  // Read intent from the post-L0 resolvedQuery (the real standalone intent),
  // not the raw anaphoric question.
  const hasStrongIntent = STRONG_INTENT_RE.some((re) => re.test(query.resolvedQuery))
  const hasCheapIntent = CHEAP_INTENT_RE.some((re) => re.test(query.resolvedQuery))

  // Tier (ADR-005, recalibrated TKT-308) — intent-PRIMARY, file-count as a raised breadth
  // backstop. The prior `distinctFiles >= 2 || hasStrongIntent` forced ~every query to strong
  // (cheap vestigial) because a 2-file spread is near-universal; intent is the real signal:
  //   1. reasoning intent (how/why/explain/...) DOMINATES -> strong (synthesis earns the cost).
  //   2. else an explicit lookup (where/what/find/...) -> cheap, EVEN at a multi-file spread
  //      (the spread is retrieval noise; this is where the vestigial-cheap bug lived).
  //   3. else (no intent verb) fall back to genuine breadth -> strong only at the raised
  //      MULTI_FILE_THRESHOLD. A false-cheap on a truly complex query costs more answer quality
  //      than a false-strong costs money, so the neutral case still escalates on real breadth.
  const tier: GateDecision['tier'] = hasStrongIntent
    ? 'strong'
    : hasCheapIntent
      ? 'cheap'
      : distinctFiles >= MULTI_FILE_THRESHOLD
        ? 'strong'
        : 'cheap'

  const model = tier === 'strong' ? MODEL_STRONG : MODEL_CHEAP

  return { groundingScore, band, tier, model }
}
