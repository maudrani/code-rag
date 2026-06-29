import type { Projection, Turn } from '../contracts/index.js'
import { CITE_INSTRUCTION, SYSTEM_ANSWER_ONLY } from './guardrails.js'

/**
 * Prompt & context assembly (ADR-005 context management; TKT-304) — the PURE,
 * provider-AGNOSTIC L5 prompt builder. NO LLM, no SDK, no I/O, never throws.
 *
 * The Claude provider (TKT-305/306) maps the result to Anthropic params; a second
 * provider (the config-only OpenAI swap, ADR-005) can reuse the same logical prompt.
 *
 *   system   = answer-only policy + assembled context + the citable id set + cite
 *              instruction. The guardrail strings are IMPORTED from guardrails.ts
 *              (TKT-303) so the in-prompt instruction and the post-check (enforceCitations)
 *              cannot drift.
 *   messages = a bounded window of prior turns + the current user turn carrying the
 *              resolvedQuery (the standalone, anaphora-resolved query aligned with the
 *              retrieved context; ADR-002). Retrieval stays stateless — only the LLM
 *              sees history.
 */

/** A provider-agnostic chat turn (Claude maps it to a MessageParam). */
export interface PromptTurn {
  role: 'user' | 'assistant'
  content: string
}

/** The assembled logical prompt the provider maps to its SDK params. */
export interface AssembledPrompt {
  system: string
  messages: PromptTurn[]
}

/**
 * Bounded conversation window (ADR-005): only the last N turns go to the LLM.
 * N turns (not a token budget) keeps this module tokenizer-free + deterministic —
 * a documented proxy, tunable. Recency matters most for anaphora/continuity.
 */
export const HISTORY_WINDOW_TURNS = 6

/**
 * Keep the last HISTORY_WINDOW_TURNS turns; if that window begins on an assistant
 * turn, drop it so the sequence is well-formed (user-led — the current user turn is
 * always appended last by buildPrompt). Pure: never mutates the input.
 */
export function windowHistory(history: Turn[]): Turn[] {
  const tail = history.slice(-HISTORY_WINDOW_TURNS)
  return tail[0]?.role === 'assistant' ? tail.slice(1) : tail
}

/**
 * Assemble the L5 system + messages from a Projection + conversation history.
 * Band gating is upstream (the membrane short-circuits a 'refuse' decision to
 * refusalMessage and never calls the provider), so this is total + band-agnostic:
 * an empty-context prompt still carries the answer-only policy so the model declines.
 */
export function buildPrompt(projection: Projection, history: Turn[]): AssembledPrompt {
  const sections: string[] = [SYSTEM_ANSWER_ONLY, `Context:\n${projection.context.assembled}`]

  if (projection.citations.length > 0) {
    const ids = projection.citations.map((c) => `[${c.chunkId}]`).join(' ')
    sections.push(`Available citation ids (cite ONLY these): ${ids}`)
  }
  sections.push(CITE_INSTRUCTION)

  const messages: PromptTurn[] = [
    ...windowHistory(history).map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: projection.resolvedQuery },
  ]

  return { system: sections.join('\n\n'), messages }
}
