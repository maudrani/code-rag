import { describe, expect, it } from 'vitest'
import type { AnswerChunk, Projection } from '../../src/contracts/index.js'
import { ClaudeProvider } from '../../src/provider/claude.js'
import { fakeClient, fakeStream, jsonDelta, textDelta } from './_fake-anthropic.js'

// ── fixtures ────────────────────────────────────────────────────────────────
function projection(overrides: Partial<Projection> = {}): Projection {
  return {
    queryId: 'q1',
    question: 'raw question',
    resolvedQuery: 'resolved standalone query',
    results: [],
    citations: [
      {
        chunkId: 'a.ts#foo@1-3',
        path: 'a.ts',
        span: { startLine: 1, endLine: 3 },
        label: 'a.ts#foo@1-3',
      },
    ],
    context: { assembled: 'CTX', tokensEst: 10 },
    decision: { groundingScore: 0.5, band: 'answer', tier: 'cheap', model: 'claude-haiku-4-5' },
    ...overrides,
  }
}

const STRONG = {
  groundingScore: 0.9,
  band: 'answer',
  tier: 'strong',
  model: 'claude-sonnet-4-6',
} as const

async function collect(stream: AsyncIterable<AnswerChunk>): Promise<AnswerChunk[]> {
  const out: AnswerChunk[] = []
  for await (const chunk of stream) {
    out.push(chunk)
  }
  return out
}

// ── streaming: token deltas then a final usage chunk (SC-4) ───────────────────
describe('ClaudeProvider.answer — streaming', () => {
  it('yields each text delta as a token chunk in order, then ONE final usage chunk', async () => {
    const { client } = fakeClient({
      streamObj: fakeStream([textDelta('Hello '), textDelta('world')], {
        input_tokens: 12,
        output_tokens: 8,
      }),
    })
    const chunks = await collect(new ClaudeProvider(client).answer('q', projection(), []))
    expect(chunks).toEqual([
      { type: 'token', text: 'Hello ' },
      { type: 'token', text: 'world' },
      { type: 'usage', inputTokens: 12, outputTokens: 8 },
    ])
  })

  it('maps the SDK snake_case usage to the contract camelCase fields (REAL counts)', async () => {
    const { client } = fakeClient({
      streamObj: fakeStream([textDelta('x')], { input_tokens: 123, output_tokens: 45 }),
    })
    const chunks = await collect(new ClaudeProvider(client).answer('q', projection(), []))
    expect(chunks.at(-1)).toEqual({ type: 'usage', inputTokens: 123, outputTokens: 45 })
  })

  it('ignores non-text deltas (e.g. tool input_json) — only text becomes tokens', async () => {
    const { client } = fakeClient({
      streamObj: fakeStream([textDelta('a'), jsonDelta('{"x":1}'), textDelta('b')], {
        input_tokens: 1,
        output_tokens: 1,
      }),
    })
    const tokens = (await collect(new ClaudeProvider(client).answer('q', projection(), [])))
      .filter((c) => c.type === 'token')
      .map((c) => (c.type === 'token' ? c.text : ''))
    expect(tokens).toEqual(['a', 'b'])
  })
})

// ── model routing + params (SC-4) ─────────────────────────────────────────────
describe('ClaudeProvider.answer — model + params', () => {
  it('passes the strong-tier decision.model (sonnet) to messages.stream', async () => {
    const { client, stream } = fakeClient({
      streamObj: fakeStream([textDelta('x')], { input_tokens: 1, output_tokens: 1 }),
    })
    await collect(new ClaudeProvider(client).answer('q', projection({ decision: STRONG }), []))
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-4-6' }))
  })

  it('passes the cheap-tier decision.model (haiku) to messages.stream', async () => {
    const { client, stream } = fakeClient({
      streamObj: fakeStream([textDelta('x')], { input_tokens: 1, output_tokens: 1 }),
    })
    await collect(new ClaudeProvider(client).answer('q', projection(), []))
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5' }))
  })

  it('sends max_tokens + system + messages and NO thinking/effort field (N/A in SDK 0.32.1)', async () => {
    const { client, stream } = fakeClient({
      streamObj: fakeStream([textDelta('x')], { input_tokens: 1, output_tokens: 1 }),
    })
    await collect(new ClaudeProvider(client).answer('q', projection(), []))
    const params = stream.mock.calls[0]?.[0] as Record<string, unknown>
    expect(params).toHaveProperty('max_tokens')
    expect(params).toHaveProperty('system')
    expect(params).toHaveProperty('messages')
    expect(params).not.toHaveProperty('thinking')
    expect(params).not.toHaveProperty('effort')
  })
})

// ── usage always closes (SC-4) ────────────────────────────────────────────────
describe('ClaudeProvider.answer — usage always closes', () => {
  it('zero text deltas (empty completion) -> still exactly one usage chunk', async () => {
    const { client } = fakeClient({
      streamObj: fakeStream([], { input_tokens: 3, output_tokens: 0 }),
    })
    const chunks = await collect(new ClaudeProvider(client).answer('q', projection(), []))
    expect(chunks).toEqual([{ type: 'usage', inputTokens: 3, outputTokens: 0 }])
  })
})

// ── refuse guard + negatives ──────────────────────────────────────────────────
describe('ClaudeProvider.answer — refuse guard & negatives', () => {
  it('MUST throw on a refuse-band projection and make NO SDK call (protects cost)', async () => {
    const { client, stream } = fakeClient({
      streamObj: fakeStream([], { input_tokens: 0, output_tokens: 0 }),
    })
    const refuse = projection({
      decision: { groundingScore: 0, band: 'refuse', tier: 'cheap', model: 'claude-haiku-4-5' },
    })
    await expect(collect(new ClaudeProvider(client).answer('q', refuse, []))).rejects.toThrow(
      /refuse/i,
    )
    expect(stream).not.toHaveBeenCalled()
  })

  it('MUST NOT omit the final usage chunk even when zero tokens streamed', async () => {
    const { client } = fakeClient({
      streamObj: fakeStream([], { input_tokens: 7, output_tokens: 0 }),
    })
    const chunks = await collect(new ClaudeProvider(client).answer('q', projection(), []))
    expect(chunks.some((c) => c.type === 'usage')).toBe(true)
  })

  it('MUST NOT fabricate token counts — the usage chunk equals the SDK finalMessage usage', async () => {
    const { client } = fakeClient({
      streamObj: fakeStream([textDelta('hi')], { input_tokens: 99, output_tokens: 100 }),
    })
    const chunks = await collect(new ClaudeProvider(client).answer('q', projection(), []))
    expect(chunks.at(-1)).toEqual({ type: 'usage', inputTokens: 99, outputTokens: 100 })
  })
})
