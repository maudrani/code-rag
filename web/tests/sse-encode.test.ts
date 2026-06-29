import { describe, expect, it } from 'vitest'
import { ANSWER_TEXT, answerProjection, refuseProjection } from '../src/mocks/fixtures'
import { encodeSse, HEARTBEAT_FRAME, parseSse } from '../src/mocks/sseEncode'
import { makeQueryStream } from '../src/mocks/wireMock'

describe('sseEncode — text/event-stream framing (ADR-008)', () => {
  it('round-trips: encode -> parse preserves event order', () => {
    const stream = makeQueryStream(answerProjection, { answer: ANSWER_TEXT })
    const round = parseSse(encodeSse(stream))
    expect(round.map((f) => f.event)).toEqual(stream.map((e) => e.event))
  })

  it('emits well-formed `event:`/`data:` frames ending in a blank line', () => {
    const text = encodeSse(makeQueryStream(answerProjection, { answer: 'hi there' }))
    expect(text).toMatch(/event: meta\ndata: .+\n\n/)
    expect(text.endsWith('\n\n')).toBe(true)
  })

  it('parseSse skips `:` heartbeat lines (no corruption)', () => {
    const text = HEARTBEAT_FRAME + encodeSse(makeQueryStream(refuseProjection))
    const round = parseSse(text)
    expect(round.map((f) => f.event)).toEqual(['meta', 'done'])
  })

  it('parseSse tolerates a frame split would-be boundary (well-formed regardless of batching)', () => {
    // Two events encoded back-to-back must parse as two frames.
    const text = encodeSse(makeQueryStream(refuseProjection))
    expect(parseSse(text)).toHaveLength(2)
  })
})
