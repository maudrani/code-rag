/** Test helpers for SSE streaming: build ReadableStreams from strings. */

/** A ReadableStream that emits `text` in fixed-size byte chunks (exercises frame splitting). */
export function streamFromString(text: string, chunkSize = 64): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize))
      offset += chunkSize
    },
  })
}

/** A stream you feed manually — enqueue chunks over time, then close (for in-flight tests). */
export function controllableStream(): {
  stream: ReadableStream<Uint8Array>
  enqueue: (text: string) => void
  close: () => void
} {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    stream,
    enqueue: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  }
}

/** A stream whose pull never resolves — simulates a hung backend (stall watchdog tests). */
export function neverStream(onCancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => {
        // never resolves
      })
    },
    cancel() {
      onCancel()
    },
  })
}
