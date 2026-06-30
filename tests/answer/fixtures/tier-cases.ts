/**
 * Committed tier-calibration fixture (FTR-32 / TKT-308).
 *
 * Each case is a realistic codebase-RAG query + the distinct-file PROFILE of its top-K
 * retrieval (only the count of distinct paths matters to the tier proxy) + the EXPECTED tier.
 * This fixture is the spec the recalibrated gate must satisfy, and the standing eval-gate that
 * catches a regression to the dogfood's "everything is strong" (cheap-recall 0) or its mirror
 * (all-cheap, strong-recall 0). It doubles as the dashboard (demonstrate-deterministically P5).
 *
 * Labels follow ADR-005: lookup intent (where/what/find/show/list/which) + low complexity ->
 * cheap; reasoning intent (how/why/explain/trace/compare/relate/across/flow) or genuine breadth
 * -> strong. The `why` field documents which signal each case exercises.
 */

export type Tier = 'cheap' | 'strong'

export interface TierCase {
  /** the resolved (post-L0) query the gate reads. */
  query: string
  /** distinct file paths across the top-K retrieved chunks (the proxy's only input). */
  files: string[]
  /** the tier a faithful ADR-005 gate must assign. */
  expect: Tier
  /** which signal this case exercises (documentation + failure triage). */
  why: string
}

export const TIER_CASES: TierCase[] = [
  // ── cheap: explicit lookups (the answer is "it's here" — a small model suffices) ──
  {
    query: 'where is createEngine defined',
    files: ['src/membrane/index.ts', 'src/contracts/engine.ts'],
    expect: 'cheap',
    why: 'lookup intent (where); 2-file spread is retrieval noise, not answer complexity',
  },
  {
    query: 'what does estimateCost return',
    files: ['src/answer/cost.ts'],
    expect: 'cheap',
    why: 'lookup intent (what); single file',
  },
  {
    query: 'list the fields of AnswerTelemetry',
    files: ['src/contracts/telemetry.ts', 'src/answer/telemetry.ts'],
    expect: 'cheap',
    why: 'lookup intent (list); a struct enumeration',
  },
  {
    query: 'show the refusalMessage text',
    files: ['src/answer/guardrails.ts'],
    expect: 'cheap',
    why: 'lookup intent (show); single file',
  },
  {
    // THE DOGFOOD FAILURE: a plain lookup whose retrieval happened to spread across files.
    query: 'which model id is the cheap tier',
    files: ['src/answer/score-gate.ts', 'src/answer/cost.ts', 'src/answer/telemetry.ts'],
    expect: 'cheap',
    why: 'lookup intent (which) MUST stay cheap even at 3-file spread — the bug this ticket fixes',
  },
  {
    query: 'find the GROUNDING_FLOOR constant',
    files: ['src/answer/score-gate.ts'],
    expect: 'cheap',
    why: 'lookup intent (find); single file',
  },

  // ── strong: reasoning / synthesis (a bigger model earns its cost) ──
  {
    query: 'how does the membrane sequence L0 through L5',
    files: ['src/membrane/index.ts', 'src/membrane/project.ts'],
    expect: 'strong',
    why: 'reasoning intent (how); multi-hop synthesis of a pipeline',
  },
  {
    query: 'why does the gate refuse ungrounded queries',
    files: ['src/answer/score-gate.ts'],
    expect: 'strong',
    why: 'reasoning intent (why); single file but a "why" explanation',
  },
  {
    query: 'trace how a query flows from the http server to the answer stream',
    files: ['src/http/server.ts', 'src/membrane/index.ts', 'src/provider/claude.ts'],
    expect: 'strong',
    why: 'reasoning intent (trace/how/flow); cross-file synthesis',
  },
  {
    query: 'compare the cheap and strong tiers',
    files: ['src/answer/cost.ts', 'src/answer/score-gate.ts'],
    expect: 'strong',
    why: 'reasoning intent (compare)',
  },
  {
    query: 'explain the RRF fusion across the retrieval legs',
    files: ['src/retrieve/retrieve.ts'],
    expect: 'strong',
    why: 'reasoning intent (explain/across); single file but a synthesis ask',
  },

  // ── strong: genuine breadth with NO intent verb (the breadth backstop) ──
  {
    query: 'telemetry struct emission registry ledger replay buffer seam',
    files: [
      'src/contracts/telemetry.ts',
      'src/answer/telemetry.ts',
      'src/membrane/index.ts',
      'src/registry.ts',
      'src/bus/index.ts',
    ],
    expect: 'strong',
    why: 'no intent verb, but 5 distinct files = genuine breadth -> the raised-threshold backstop',
  },

  // ── cheap: no intent verb, low spread (the backstop must NOT over-fire) ──
  {
    query: 'parseConfig options object shape',
    files: ['src/config.ts'],
    expect: 'cheap',
    why: 'no intent verb, single file -> below the breadth threshold',
  },
]
