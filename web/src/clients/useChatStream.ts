/**
 * useChatStream — React hook over the ADR-008 chat wire. Owns the transcript; POSTs
 * /query and streams meta -> token* -> done into the in-flight assistant turn. refuse
 * renders NO answer tokens. send / stop / retry with AbortController. Patches are keyed
 * by message id so a superseded stream never writes into a newer turn.
 */
import { useCallback, useRef, useState } from 'react'
import type { Citation, GateDecision, RankedChunk, Turn, WireProjection } from '../contract'
import { isAbortError, streamSse } from './sseClient'

export type ChatPhase = 'streaming' | 'done' | 'refused' | 'error'

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  decision?: GateDecision
  citations?: Citation[]
  results?: RankedChunk[]
  queryId?: string
  phase?: ChatPhase
}

export interface UseChatStreamOptions {
  baseUrl?: string
  stallMs?: number
}

export interface UseChatStream {
  messages: ChatMessage[]
  status: string | null
  isStreaming: boolean
  send(question: string): Promise<void>
  stop(): void
  retry(): Promise<void>
}

function toTurns(messages: ChatMessage[]): Turn[] {
  return messages
    .filter((m) => m.role === 'user' || m.content.length > 0)
    .map((m) => ({ role: m.role, content: m.content }))
}

export function useChatStream(options: UseChatStreamOptions = {}): UseChatStream {
  const { baseUrl = '', stallMs } = options
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const lastQueryRef = useRef<{ question: string; history: Turn[] } | null>(null)
  const idRef = useRef(0)

  // Mirror messages into a ref so send()/retry() read the current transcript without
  // re-creating callbacks on every keystroke. Read-only sync during render is safe.
  const messagesRef = useRef<ChatMessage[]>(messages)
  messagesRef.current = messages

  const runStream = useCallback(
    async (question: string, history: Turn[], reuse: boolean): Promise<void> => {
      abortRef.current?.abort() // a new stream supersedes any in-flight one
      const ac = new AbortController()
      abortRef.current = ac

      // ids generated OUTSIDE the updater (updater must stay pure for StrictMode).
      const assistantId = idRef.current++
      const userId = reuse ? -1 : idRef.current++

      setMessages((prev) => {
        const base = reuse && prev.at(-1)?.role === 'assistant' ? prev.slice(0, -1) : prev
        const withUser: ChatMessage[] = reuse
          ? base
          : [...base, { id: userId, role: 'user', content: question }]
        return [
          ...withUser,
          { id: assistantId, role: 'assistant', content: '', phase: 'streaming' },
        ]
      })
      setStatus('Searching the codebase…')
      setIsStreaming(true)

      let content = ''
      let band: GateDecision['band'] | undefined

      const patchAssistant = (patch: Partial<ChatMessage>): void => {
        setMessages((prev) => {
          const i = prev.findIndex((m) => m.id === assistantId)
          if (i < 0) {
            return prev
          }
          const next = prev.slice()
          next[i] = { ...next[i], ...patch }
          return next
        })
      }

      try {
        const res = await fetch(`${baseUrl}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, history }),
          signal: ac.signal,
        })
        if (!res.ok || !res.body) {
          throw new Error(`/query failed: ${res.status}`)
        }
        await streamSse(
          res.body,
          {
            onMeta: (data: WireProjection) => {
              band = data.decision.band
              setStatus(null)
              patchAssistant({
                decision: data.decision,
                citations: data.citations,
                results: data.results,
                queryId: data.queryId,
                phase: band === 'refuse' ? 'refused' : 'streaming',
              })
            },
            onToken: (text: string) => {
              content += text // mutate local, flush once per event (perf invariant)
              patchAssistant({ content })
            },
          },
          { signal: ac.signal, stallMs },
        )
        patchAssistant({ phase: band === 'refuse' ? 'refused' : 'done' })
      } catch (err) {
        // Abort => preserve partial + terminal phase (Rule 2); real failure => 'error'.
        const aborted = ac.signal.aborted || isAbortError(err)
        patchAssistant({ phase: aborted ? (band === 'refuse' ? 'refused' : 'done') : 'error' })
      } finally {
        // Only the OWNING stream resets shared flags (a newer send may have taken over).
        if (abortRef.current === ac) {
          setIsStreaming(false)
          setStatus(null)
          abortRef.current = null
        }
      }
    },
    [baseUrl, stallMs],
  )

  const send = useCallback(
    (question: string): Promise<void> => {
      const history = toTurns(messagesRef.current)
      lastQueryRef.current = { question, history }
      return runStream(question, history, false)
    },
    [runStream],
  )

  const retry = useCallback((): Promise<void> => {
    const q = lastQueryRef.current
    if (!q) {
      return Promise.resolve()
    }
    return runStream(q.question, q.history, true)
  }, [runStream])

  const stop = useCallback((): void => {
    abortRef.current?.abort()
  }, [])

  return { messages, status, isStreaming, send, stop, retry }
}
