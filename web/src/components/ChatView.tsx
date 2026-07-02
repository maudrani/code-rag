import { useEffect, useMemo } from 'react'
import {
  type ChatTelemetry,
  telemetryOf,
  type UseChatStreamOptions,
  useChatStream,
} from '../clients/useChatStream'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'
import { StatusPill } from './StatusPill'

/**
 * The chat surface: transcript (streaming) + status pill + composer, bound to useChatStream.
 * Reports its active queryId up (so the shell can wire the trace rail) and exposes a polite
 * aria-live region that announces status + completion — NOT every token (a11y, react-ai skill).
 */
export function ChatView({
  options,
  onActiveQuery,
  onActiveTelemetry,
}: {
  options?: UseChatStreamOptions
  onActiveQuery?: (queryId: string | null) => void
  onActiveTelemetry?: (telemetry: ChatTelemetry | null) => void
}) {
  const chat = useChatStream(options)
  const canRetry = chat.messages.some((m) => m.phase === 'error')

  const activeQueryId = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
      const qid = chat.messages[i].queryId
      if (qid) {
        return qid
      }
    }
    return null
  }, [chat.messages])

  // The COMPLETE telemetry for the most recent answered turn — assembled from the wire data the chat
  // already holds (decision + results + usage), lifted so the trace rail can render it (#2).
  const activeTelemetry = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
      const telemetry = telemetryOf(chat.messages[i])
      if (telemetry) {
        return telemetry
      }
    }
    return null
  }, [chat.messages])

  useEffect(() => {
    onActiveQuery?.(activeQueryId)
  }, [activeQueryId, onActiveQuery])

  useEffect(() => {
    onActiveTelemetry?.(activeTelemetry)
  }, [activeTelemetry, onActiveTelemetry])

  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === 'assistant')
  let announcement = chat.status ?? ''
  if (!announcement && lastAssistant?.phase === 'done') {
    announcement = 'Answer ready.'
  } else if (!announcement && lastAssistant?.phase === 'refused') {
    announcement = 'Refused — insufficient grounding to answer.'
  }

  return (
    <section className="chat" aria-label="chat">
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
      <div className="chat__transcript">
        {chat.messages.length === 0 ? (
          <div className="chat__empty">
            Ask how the code works, where things live, or what depends on what — answers come
            grounded in clickable citations.
          </div>
        ) : (
          chat.messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
        <StatusPill status={chat.status} />
      </div>
      <Composer
        onSend={(text) => void chat.send(text)}
        onStop={chat.stop}
        onRetry={() => void chat.retry()}
        isStreaming={chat.isStreaming}
        canRetry={canRetry}
      />
    </section>
  )
}
