/**
 * SSE chat client for the ADR-008 `/query` wire. Two layers:
 *  - createSseParser: a PURE incremental parser (push raw chunks -> typed callbacks).
 *  - streamSse: drives a byte ReadableStream through the parser with a per-chunk stall
 *    watchdog + AbortController, clearing all state in `finally` (sse-streaming-discipline).
 * Types come from the type-only contract bridge (../contract) — zero drift.
 */
import type { WireProjection } from '../contract'

export interface SseDoneUsage {
  tokensTotal: number
  estCost: number
}

export interface SseHandlers {
  onMeta(data: WireProjection): void
  onToken(text: string): void
  onDone(usage: SseDoneUsage): void
}

export interface SseParser {
  push(chunk: string): void
}

/**
 * Pure incremental parser: buffers chunks, splits on the blank-line frame delimiter,
 * keeps the partial trailing frame, skips `:` heartbeats + malformed JSON, dispatches
 * typed handlers. No I/O — directly unit-testable.
 */
export function createSseParser(handlers: Partial<SseHandlers>): SseParser {
  let buffer = ''

  function dispatch(event: string, data: unknown): void {
    if (event === 'meta') {
      handlers.onMeta?.(data as WireProjection)
    } else if (event === 'token') {
      handlers.onToken?.((data as { text: string }).text)
    } else if (event === 'done') {
      handlers.onDone?.(data as SseDoneUsage)
    }
    // New event types must add a branch here AND in the producer (discipline Rule 5).
  }

  return {
    push(chunk: string): void {
      buffer += chunk
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? '' // keep the incomplete trailing frame
      for (const raw of frames) {
        if (!raw.trim() || raw.startsWith(':')) {
          continue // skip blank + heartbeat frames
        }
        let event = 'message'
        let dataStr = ''
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) {
            event = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            dataStr = line.slice(6)
          }
        }
        if (!dataStr) {
          continue
        }
        let data: unknown
        try {
          data = JSON.parse(dataStr)
        } catch {
          continue // skip malformed frame, keep streaming
        }
        dispatch(event, data)
      }
    },
  }
}

export interface StreamSseOptions {
  signal?: AbortSignal
  stallMs?: number
  onStall?(): void
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/**
 * Drive a byte ReadableStream through the parser. Resolves on normal end OR abort
 * (never throws on abort). A per-chunk stall watchdog cancels a hung stream. The stall
 * timer + abort listener are cleared in `finally` on EVERY exit path (Rule 1).
 */
export async function streamSse(
  body: ReadableStream<Uint8Array>,
  handlers: Partial<SseHandlers>,
  options: StreamSseOptions = {},
): Promise<void> {
  const parser = createSseParser(handlers)
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const stallMs = options.stallMs ?? 30_000
  let stallTimer: ReturnType<typeof setTimeout> | undefined

  const clearStall = (): void => {
    if (stallTimer) {
      clearTimeout(stallTimer)
      stallTimer = undefined
    }
  }
  const armStall = (): void => {
    clearStall()
    if (stallMs > 0) {
      stallTimer = setTimeout(() => {
        options.onStall?.()
        void reader.cancel()
      }, stallMs)
    }
  }
  const onAbort = (): void => {
    void reader.cancel()
  }

  if (options.signal?.aborted) {
    await reader.cancel()
    reader.releaseLock()
    return
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    armStall()
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (err) {
        if (isAbortError(err)) {
          break // aborted upstream — clean end
        }
        throw err
      }
      if (chunk.done) {
        break
      }
      armStall()
      parser.push(decoder.decode(chunk.value, { stream: true }))
    }
  } finally {
    clearStall()
    options.signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}
