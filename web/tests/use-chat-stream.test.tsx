import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatStream } from '../src/clients/useChatStream'
import { ANSWER_TEXT, answerProjection, refuseProjection } from '../src/mocks/fixtures'
import { encodeFrame, encodeSse } from '../src/mocks/sseEncode'
import { makeQueryStream } from '../src/mocks/wireMock'
import { controllableStream, streamFromString } from './sse-test-utils'

function fetchReturning(sseText: string) {
  return vi.fn().mockImplementation(async () => ({
    ok: true,
    status: 200,
    body: streamFromString(sseText, 16),
  }))
}

const assistantOf = (messages: ReturnType<typeof useChatStream>['messages']) =>
  messages.find((m) => m.role === 'assistant')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useChatStream — answer band', () => {
  it('records the user turn, streams tokens, and renders meta decision + citations', async () => {
    vi.stubGlobal(
      'fetch',
      fetchReturning(encodeSse(makeQueryStream(answerProjection, { answer: ANSWER_TEXT }))),
    )
    const { result } = renderHook(() => useChatStream())

    await act(async () => {
      await result.current.send('how does the membrane work')
    })

    expect(result.current.messages[0]?.role).toBe('user')
    expect(result.current.messages[0]?.content).toBe('how does the membrane work')

    const assistant = assistantOf(result.current.messages)
    expect(assistant?.phase).toBe('done')
    expect(assistant?.content).toBe(ANSWER_TEXT)
    expect(assistant?.decision?.band).toBe('answer')
    expect(assistant?.decision?.tier).toBe('strong')
    expect(assistant?.citations?.length).toBeGreaterThan(0)
    expect(result.current.isStreaming).toBe(false)
  })
})

describe('useChatStream — consumer identity (TKT-523)', () => {
  it('sends X-Consumer: web on the /query call so surface tags it web, not http', async () => {
    const fetchMock = fetchReturning(
      encodeSse(makeQueryStream(answerProjection, { answer: ANSWER_TEXT })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useChatStream())

    await act(async () => {
      await result.current.send('membrane')
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/query')
    expect((init.headers as Record<string, string>)['X-Consumer']).toBe('web')
  })
})

describe('useChatStream — refuse band', () => {
  it('renders the refusal (decision refuse) with NO answer tokens', async () => {
    vi.stubGlobal('fetch', fetchReturning(encodeSse(makeQueryStream(refuseProjection))))
    const { result } = renderHook(() => useChatStream())

    await act(async () => {
      await result.current.send('what is the capital of france')
    })

    const assistant = assistantOf(result.current.messages)
    expect(assistant?.phase).toBe('refused')
    expect(assistant?.content).toBe('')
    expect(assistant?.decision?.band).toBe('refuse')
  })
})

describe('useChatStream — control (stop / retry)', () => {
  it('stop() aborts in-flight, preserves the message, sets a terminal phase', async () => {
    const { stream, enqueue } = controllableStream()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream }))
    const { result } = renderHook(() => useChatStream())

    let sendPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      sendPromise = result.current.send('q')
      enqueue(encodeFrame({ event: 'meta', data: answerProjection }))
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.isStreaming).toBe(true))

    act(() => {
      result.current.stop()
    })
    await act(async () => {
      await sendPromise.catch(() => undefined)
    })

    const assistant = assistantOf(result.current.messages)
    expect(assistant).toBeDefined()
    expect(assistant?.phase).not.toBe('streaming') // terminal, not a perpetual spinner
    expect(result.current.isStreaming).toBe(false)
  })

  it('retry() re-streams the last query without duplicating tokens', async () => {
    vi.stubGlobal(
      'fetch',
      fetchReturning(encodeSse(makeQueryStream(answerProjection, { answer: ANSWER_TEXT }))),
    )
    const { result } = renderHook(() => useChatStream())

    await act(async () => {
      await result.current.send('q')
    })
    await act(async () => {
      await result.current.retry()
    })

    const assistants = result.current.messages.filter((m) => m.role === 'assistant')
    expect(assistants.at(-1)?.content).toBe(ANSWER_TEXT) // reset, not doubled
    // exactly one user turn (retry reuses it, does not append another)
    expect(result.current.messages.filter((m) => m.role === 'user')).toHaveLength(1)
  })
})
