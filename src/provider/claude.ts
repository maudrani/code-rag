import Anthropic from '@anthropic-ai/sdk'
import { buildPrompt, windowHistory } from '../answer/prompt.js'
import { MODEL_CHEAP } from '../answer/score-gate.js'
import type { AnswerChunk, Projection, Provider, Turn } from '../contracts/index.js'

/**
 * ClaudeProvider (ADR-005; TKT-305/306) — the shipped default Provider, Claude via
 * @anthropic-ai/sdk (pinned 0.32.1). The OpenAI swap is config only (not built).
 *
 * The Anthropic client is constructor-INJECTED so the whole stream/create path is
 * unit-tested against a fake (no network); `createClaudeProvider` wires the real one.
 *
 * NOTE: the `implements Provider` conformance clause is added in TKT-306, once
 * `rewrite` lands — a class cannot satisfy the full interface with only `answer`.
 * `answer`'s signature already matches the contract.
 */

/** Max output tokens per answer completion — bounds cost/latency; tunable (ADR-005). */
export const MAX_TOKENS_ANSWER = 1024

/** Max output tokens for a rewrite — a standalone query is short. */
export const MAX_TOKENS_REWRITE = 256

/** System instruction for the L0 rewrite residue (anaphora -> standalone query). */
export const REWRITE_SYSTEM =
  "Rewrite the user's latest message into a standalone search query by resolving " +
  'pronouns and references ("it", "that", "this", "there") using the conversation above. ' +
  'Output ONLY the rewritten query — no preamble, no quotes, no explanation. If it is ' +
  'already standalone, return it unchanged.'

export class ClaudeProvider implements Provider {
  constructor(private readonly client: Anthropic) {}

  /**
   * L5 — stream `token`s then ONE final `usage` chunk carrying the SDK's REAL token
   * counts (seam 2). Model + tier come from `projection.decision` (the TKT-301 gate).
   * Called only when `decision.band === 'answer'`; a refuse decision throws (fail-fast:
   * answering an ungrounded query both breaks the guardrail and spends tokens — the
   * membrane must short-circuit to refusalMessage()).
   *
   * No `thinking`/`effort` params: they do not exist in SDK 0.32.1, and thinking-off
   * keeps the cost numbers honest + latency low (the strong tier's value is the bigger
   * model). The async-generator body is lazy — the refuse guard fires on first iteration.
   */
  async *answer(
    _question: string,
    projection: Projection,
    history: Turn[],
  ): AsyncIterable<AnswerChunk> {
    if (projection.decision.band === 'refuse') {
      throw new Error(
        "ClaudeProvider.answer called on a 'refuse' decision — the membrane must short-circuit to refusalMessage() instead (answering an ungrounded query violates the guardrail and spends tokens).",
      )
    }

    const { system, messages } = buildPrompt(projection, history)
    const stream = this.client.messages.stream({
      model: projection.decision.model,
      max_tokens: MAX_TOKENS_ANSWER,
      system,
      messages,
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'token', text: event.delta.text }
      }
    }

    // finalMessage() is the SDK's consolidated usage (input set at message_start,
    // output finalised at message_delta) — REAL counts, mapped to camelCase.
    const final = await stream.finalMessage()
    yield {
      type: 'usage',
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
    }
  }

  /**
   * L0 residue (ADR-002) — resolve an anaphoric turn into a standalone query. The
   * membrane calls this ONLY when its deterministic anaphora gate flags a dangling
   * reference. Non-streamed, CHEAP tier: rewrite runs BEFORE retrieval (so no
   * GateDecision exists yet) and is a small transform. Degrades gracefully — an
   * empty / whitespace / non-text completion falls back to the original question so
   * a flaky rewrite never breaks an answerable query.
   */
  async rewrite(question: string, history: Turn[]): Promise<string> {
    const messages = [...windowHistory(history), { role: 'user' as const, content: question }]
    const message = await this.client.messages.create({
      model: MODEL_CHEAP,
      max_tokens: MAX_TOKENS_REWRITE,
      system: REWRITE_SYSTEM,
      messages,
    })

    const block = message.content[0]
    const rewritten = block?.type === 'text' ? block.text.trim() : ''
    return rewritten.length > 0 ? rewritten : question.trim()
  }
}

/**
 * Construct a ClaudeProvider backed by a real Anthropic client. With no apiKey the SDK
 * reads ANTHROPIC_API_KEY from the environment (used by the gated cost dogfood, SC-7).
 */
export function createClaudeProvider(apiKey?: string): ClaudeProvider {
  const client = apiKey === undefined ? new Anthropic() : new Anthropic({ apiKey })
  return new ClaudeProvider(client)
}
