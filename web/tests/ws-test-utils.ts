import type { MinimalWebSocket } from '../src/clients/traceSocket'

/**
 * Injectable fake WebSocket for deterministic trace-socket tests. Implements the
 * MinimalWebSocket contract the client depends on, plus test drivers (open/emit/serverClose).
 */
export class FakeWebSocket implements MinimalWebSocket {
  static instances: FakeWebSocket[] = []

  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly url: string
  closed = false

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  // ---- test drivers ----
  open(): void {
    this.onopen?.()
  }
  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
  emitRaw(data: string): void {
    this.onmessage?.({ data })
  }
  serverClose(): void {
    this.closed = true
    this.onclose?.()
  }

  // ---- MinimalWebSocket ----
  close(): void {
    this.closed = true
    this.onclose?.()
  }

  static reset(): void {
    FakeWebSocket.instances = []
  }
}
