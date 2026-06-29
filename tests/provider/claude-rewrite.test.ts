import { describe, expect, it } from 'vitest'
import type { Turn } from '../../src/contracts/index.js'
import { ClaudeProvider } from '../../src/provider/claude.js'
import { fakeClient, nonTextMessage, textMessage } from './_fake-anthropic.js'

const history: Turn[] = [
  { role: 'user', content: 'where is auth handled?' },
  { role: 'assistant', content: 'In src/auth.ts, the login() function.' },
]

// ── anaphora resolution (SC-5) ────────────────────────────────────────────────
describe('ClaudeProvider.rewrite — anaphora resolution', () => {
  it('resolves an anaphoric turn into the standalone query the model returns', async () => {
    const { client } = fakeClient({ createResult: textMessage('where is login() defined?') })
    const out = await new ClaudeProvider(client).rewrite('where is that defined?', history)
    expect(out).toBe('where is login() defined?')
  })

  it('trims surrounding whitespace from the model output', async () => {
    const { client } = fakeClient({ createResult: textMessage('  standalone query  ') })
    expect(await new ClaudeProvider(client).rewrite('q', history)).toBe('standalone query')
  })

  it('empty history -> still runs, returns the model output', async () => {
    const { client } = fakeClient({ createResult: textMessage('standalone') })
    expect(await new ClaudeProvider(client).rewrite('q', [])).toBe('standalone')
  })
})

// ── cheap tier + non-streamed (SC-5) ──────────────────────────────────────────
describe('ClaudeProvider.rewrite — cheap tier + non-streamed', () => {
  it('uses the cheap (haiku) model for every input', async () => {
    const { client, create } = fakeClient({ createResult: textMessage('x') })
    await new ClaudeProvider(client).rewrite('q', history)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5' }))
  })

  it('calls messages.create (non-streamed), NOT messages.stream', async () => {
    const { client, create, stream } = fakeClient({ createResult: textMessage('x') })
    await new ClaudeProvider(client).rewrite('q', history)
    expect(create).toHaveBeenCalledTimes(1)
    expect(stream).not.toHaveBeenCalled()
  })

  it('sends a bounded history window + the current question turn last', async () => {
    const long: Turn[] = Array.from(
      { length: 20 },
      (_, i): Turn => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `t${i}`,
      }),
    )
    const { client, create } = fakeClient({ createResult: textMessage('x') })
    await new ClaudeProvider(client).rewrite('current?', long)
    const params = create.mock.calls[0]?.[0] as { messages: unknown[] }
    expect(params.messages.length).toBeLessThanOrEqual(7) // HISTORY_WINDOW_TURNS(6) + current
    expect(params.messages.at(-1)).toEqual({ role: 'user', content: 'current?' })
  })
})

// ── graceful fallback (negatives) ─────────────────────────────────────────────
describe('ClaudeProvider.rewrite — graceful fallback', () => {
  it('MUST fall back to the original question on empty/whitespace model text', async () => {
    const { client } = fakeClient({ createResult: textMessage('   ') })
    expect(await new ClaudeProvider(client).rewrite('  the original?  ', history)).toBe(
      'the original?',
    )
  })

  it('MUST fall back to the original question on a non-text content block', async () => {
    const { client } = fakeClient({ createResult: nonTextMessage() })
    expect(await new ClaudeProvider(client).rewrite('original q', history)).toBe('original q')
  })

  it('MUST fall back to the original question on an empty content array', async () => {
    const { client } = fakeClient({
      createResult: { content: [], usage: { input_tokens: 0, output_tokens: 0 } },
    })
    expect(await new ClaudeProvider(client).rewrite('original q', history)).toBe('original q')
  })

  it('MUST NOT use the strong tier (model is always haiku)', async () => {
    const { client, create } = fakeClient({ createResult: textMessage('x') })
    await new ClaudeProvider(client).rewrite('q', history)
    expect(create).not.toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-4-6' }))
  })

  it('MUST NOT return an empty string (falls back to the question)', async () => {
    const { client } = fakeClient({ createResult: textMessage('') })
    const out = await new ClaudeProvider(client).rewrite('fallback q', history)
    expect(out.length).toBeGreaterThan(0)
  })
})
