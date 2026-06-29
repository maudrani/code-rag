import type Anthropic from '@anthropic-ai/sdk'
import { vi } from 'vitest'

/**
 * Test doubles for @anthropic-ai/sdk (0.32.1). The ClaudeProvider takes the REAL
 * `Anthropic` type by constructor injection (tsc proves conformance); these fakes are
 * cast `as unknown as Anthropic` at the single injection seam so the whole stream/create
 * path is unit-tested with NO network. Shapes mirror the installed SDK type defs
 * (lib/MessageStream.d.ts, resources/messages.d.ts).
 */

export interface FakeUsage {
  input_tokens: number
  output_tokens: number
}

/** A streamed text delta event — answer() extracts `{type:'token'}` from these. */
export function textDelta(text: string) {
  return {
    type: 'content_block_delta' as const,
    index: 0,
    delta: { type: 'text_delta' as const, text },
  }
}

/** A non-text (tool input_json) delta — answer() MUST ignore it. */
export function jsonDelta(partialJson: string) {
  return {
    type: 'content_block_delta' as const,
    index: 0,
    delta: { type: 'input_json_delta' as const, partial_json: partialJson },
  }
}

/** A `messages.create` Message carrying one text content block (TKT-306 rewrite). */
export function textMessage(text: string): unknown {
  return { content: [{ type: 'text', text }], usage: { input_tokens: 0, output_tokens: 0 } }
}

/** A `messages.create` Message whose first block is NOT text (TKT-306 fallback). */
export function nonTextMessage(): unknown {
  return {
    content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }],
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}

/**
 * A MessageStream-like object: async-iterable over `events` + `finalMessage()` resolving
 * the consolidated usage (the SDK's source of truth for token counts).
 */
export function fakeStream(events: unknown[], usage: FakeUsage) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) {
        yield e
      }
    },
    finalMessage: async () => ({ usage }),
  }
}

/**
 * A fake Anthropic client. `messages.stream()` returns `streamObj`; `messages.create()`
 * resolves `createResult`. Both are vi.fn spies so tests assert call args (model, params).
 */
export function fakeClient(opts: { streamObj?: unknown; createResult?: unknown } = {}) {
  const stream = vi.fn((_params: unknown) => opts.streamObj)
  const create = vi.fn(async (_params: unknown) => opts.createResult)
  const client = { messages: { stream, create } } as unknown as Anthropic
  return { client, stream, create }
}
