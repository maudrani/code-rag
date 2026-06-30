import type { Citation } from '../contracts/index.js'

/**
 * Guardrails (ADR-005; TKT-303) — the deterministic guardrail surfaces. NO LLM.
 *
 *  - refusalMessage()    the canned copy used when the gate's band === 'refuse'
 *  - enforceCitations()  flags answers that cite nothing or cite a hallucinated id
 *  - policy strings      the answer-only-from-context instructions the prompt
 *                        template (TKT-304/305) composes into the system message
 *
 * One source of truth so the in-prompt instruction (what the model is told) and
 * the post-check (what we verify) cannot drift.
 */

/**
 * Citation marker format, SHARED with the prompt template: a chunk id in square
 * brackets, e.g. `[a.ts#foo@1-3]`. The prompt instructs the model to emit it; the
 * checker parses it. The capture group is the chunk id (-> Citation.chunkId).
 */
export const CITATION_PATTERN = /\[([^\]]+)\]/g

/** System guardrail: answer only from the provided context — no outside knowledge. */
export const SYSTEM_ANSWER_ONLY =
  'Answer ONLY from the provided code context below. If the answer is not present ' +
  'in that context, say you do not have it — never use outside or prior knowledge.'

/** System guardrail: cite every claim with the shared [chunkId] marker. */
export const CITE_INSTRUCTION =
  'Cite every claim with its chunk id in square brackets, e.g. [path#symbol@start-end]. ' +
  'Only cite ids that appear in the provided context; never invent an id.'

/**
 * The refuse-when-empty copy. With no argument it is the fixed canned text (no interpolation ->
 * cannot leak chunk content) — byte-identical to before, so existing callers are unaffected.
 *
 * An optional `suggestion` (a near-miss symbol from `suggestSymbol`, TKT-309) appends a
 * "Did you mean `X`?" — the only interpolated value is a symbol NAME the index already holds
 * (never chunk content), so the no-outside-knowledge guarantee is preserved.
 */
export function refusalMessage(suggestion?: string): string {
  const base =
    "I can't answer that from the provided code — the relevant context isn't in the index."
  return suggestion === undefined ? base : `${base} Did you mean \`${suggestion}\`?`
}

/** Result of the deterministic citation check. */
export interface CitationCheck {
  /** true iff >= 1 marker AND zero hallucinated (unknown) ids. */
  ok: boolean
  /** marker ids that exist in the projection's citations (deduped, first-seen order). */
  citedIds: string[]
  /** marker ids NOT in the projection's citations — hallucinated references. */
  unknownIds: string[]
}

/**
 * Deterministic citation enforcement: every claim must reference a REAL chunk id.
 * Full per-sentence attribution is NLP-hard + probabilistic (it would defeat the
 * deterministic-before-LLM posture, ADR-001), so the invariant is: the answer must
 * cite at least one id AND every cited id must exist in `citations`.
 */
export function enforceCitations(text: string, citations: Citation[]): CitationCheck {
  const known = new Set(citations.map((c) => c.chunkId))

  const markerIds = [
    ...new Set(
      [...text.matchAll(CITATION_PATTERN)]
        .map((m) => m[1])
        .filter((id): id is string => id !== undefined),
    ),
  ]

  const citedIds = markerIds.filter((id) => known.has(id))
  const unknownIds = markerIds.filter((id) => !known.has(id))
  const ok = markerIds.length > 0 && unknownIds.length === 0

  return { ok, citedIds, unknownIds }
}
