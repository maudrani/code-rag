import { useState } from 'react'
import type { ChatMessage } from '../clients/useChatStream'
import type { Chunk, Citation } from '../contract'
import { closeUnterminated } from '../lib/markdownStream'
import { resolveCitation } from '../lib/resolveCitation'
import { AnswerMarkdown } from './AnswerMarkdown'
import { Citations } from './Citations'
import { DecisionBadge } from './DecisionBadge'
import { SourceViewer } from './SourceViewer'

/**
 * One transcript turn. User turns are plain text. Assistant turns lead with the decision
 * badge; refuse renders an explicit refusal (NO answer content), answer renders the streamed
 * text + clickable citations that open an in-app source view (TKT-506).
 */
export function MessageBubble({ message }: { message: ChatMessage }) {
  // `source === null` = closed; `{ chunk }` open (chunk may be null = trimmed from payload).
  const [source, setSource] = useState<{ chunk: Chunk | null; span: Citation['span'] } | null>(null)

  if (message.role === 'user') {
    return (
      <div className="bubble bubble--user">
        <div className="bubble__content">{message.content}</div>
      </div>
    )
  }

  const refused = message.phase === 'refused' || message.decision?.band === 'refuse'
  const citations = message.citations ?? []
  const openCitation = (citation: Citation) => {
    setSource({ chunk: resolveCitation(citation, message.results ?? []), span: citation.span })
  }

  return (
    <div className="bubble bubble--assistant">
      <div className="bubble__eyebrow">Assistant</div>
      {message.decision && <DecisionBadge decision={message.decision} />}
      {refused ? (
        <p className="bubble__refusal">
          Not enough grounding in the codebase to answer confidently.
        </p>
      ) : (
        <AnswerMarkdown content={closeUnterminated(message.content)} />
      )}
      <Citations citations={citations} onOpen={openCitation} />
      {source && <SourceViewer chunk={source.chunk} citationSpan={source.span} />}
    </div>
  )
}
