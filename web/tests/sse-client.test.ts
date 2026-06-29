import { describe, expect, it, vi } from 'vitest'
import { createSseParser, streamSse } from '../src/clients/sseClient'
import { ANSWER_TEXT, answerProjection, refuseProjection } from '../src/mocks/fixtures'
import { encodeFrame, encodeSse, HEARTBEAT_FRAME } from '../src/mocks/sseEncode'
import { makeQueryStream } from '../src/mocks/wireMock'
import { neverStream, streamFromString } from './sse-test-utils'

describe('createSseParser — incremental framing', () => {
  it('dispatches meta -> token* -> done in order; tokens rejoin the answer', () => {
    const seq: string[] = []
    const tokens: string[] = []
    const parser = createSseParser({
      onMeta: () => seq.push('meta'),
      onToken: (t) => {
        seq.push('token')
        tokens.push(t)
      },
      onDone: () => seq.push('done'),
    })
    parser.push(encodeSse(makeQueryStream(answerProjection, { answer: ANSWER_TEXT })))
    expect(seq[0]).toBe('meta')
    expect(seq.at(-1)).toBe('done')
    expect(tokens.join('')).toBe(ANSWER_TEXT)
  })

  it('refuse: onToken is NEVER called (meta + done only)', () => {
    const onMeta = vi.fn()
    const onToken = vi.fn()
    const onDone = vi.fn()
    createSseParser({ onMeta, onToken, onDone }).push(encodeSse(makeQueryStream(refuseProjection)))
    expect(onMeta).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onToken).not.toHaveBeenCalled()
  })

  it('reassembles a frame split across two push() calls (buffers the partial)', () => {
    const onToken = vi.fn()
    const parser = createSseParser({ onToken })
    const frame = encodeFrame({ event: 'token', data: { text: 'hello' } })
    const mid = Math.floor(frame.length / 2)
    parser.push(frame.slice(0, mid))
    expect(onToken).not.toHaveBeenCalled()
    parser.push(frame.slice(mid))
    expect(onToken).toHaveBeenCalledWith('hello')
  })

  it('skips `:` heartbeat frames without corrupting the buffer', () => {
    const onMeta = vi.fn()
    const onToken = vi.fn()
    createSseParser({ onMeta, onToken }).push(
      HEARTBEAT_FRAME + encodeSse(makeQueryStream(refuseProjection)),
    )
    expect(onMeta).toHaveBeenCalledTimes(1)
    expect(onToken).not.toHaveBeenCalled()
  })

  it('skips a malformed (non-JSON) data frame without throwing', () => {
    const onToken = vi.fn()
    const parser = createSseParser({ onToken })
    expect(() => parser.push('event: token\ndata: {not valid json\n\n')).not.toThrow()
    expect(onToken).not.toHaveBeenCalled()
  })
})

describe('streamSse — reader loop + resilience', () => {
  it('reads a ReadableStream and dispatches handlers (chunked transport)', async () => {
    const tokens: string[] = []
    const sse = encodeSse(makeQueryStream(answerProjection, { answer: 'one two three' }))
    await streamSse(streamFromString(sse, 8), { onToken: (t) => tokens.push(t) })
    expect(tokens.join('')).toBe('one two three')
  })

  it('stall watchdog: fires onStall + cancels the reader when no bytes arrive', async () => {
    vi.useFakeTimers()
    let cancelled = false
    const onStall = vi.fn()
    const promise = streamSse(
      neverStream(() => {
        cancelled = true
      }),
      {},
      { stallMs: 1000, onStall },
    )
    await vi.advanceTimersByTimeAsync(1100)
    expect(onStall).toHaveBeenCalledTimes(1)
    expect(cancelled).toBe(true)
    vi.useRealTimers()
    await promise.catch(() => undefined)
  })

  it('abort via signal: cancels the reader and resolves (no throw)', async () => {
    const ac = new AbortController()
    let cancelled = false
    const promise = streamSse(
      neverStream(() => {
        cancelled = true
      }),
      {},
      { signal: ac.signal },
    )
    ac.abort()
    await expect(promise).resolves.toBeUndefined()
    expect(cancelled).toBe(true)
  })
})
