import { type ChangeEvent, type KeyboardEvent, useRef, useState } from 'react'

export interface ComposerProps {
  onSend: (text: string) => void
  onStop?: () => void
  onRetry?: () => void
  isStreaming?: boolean
  canRetry?: boolean
}

/** Auto-growing input. Enter sends, Shift+Enter newlines; Send↔Stop swap while streaming. */
export function Composer({
  onSend,
  onStop,
  onRetry,
  isStreaming = false,
  canRetry = false,
}: ComposerProps) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  function submit() {
    const text = value.trim()
    if (!text) {
      return
    }
    onSend(text)
    setValue('')
    if (ref.current) {
      ref.current.style.height = 'auto'
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      // While streaming the composer is in Stop mode — Enter must not start a new query.
      if (!isStreaming) {
        submit()
      }
    }
  }

  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setValue(event.target.value)
    const el = event.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }

  return (
    <div className="composer">
      {canRetry && onRetry && (
        <button type="button" className="composer__retry" onClick={onRetry}>
          Retry
        </button>
      )}
      <textarea
        ref={ref}
        className="composer__input"
        rows={1}
        placeholder={isStreaming ? 'Generating answer… you can stop.' : 'Ask the codebase…'}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        aria-label="message"
      />
      {isStreaming ? (
        <button
          type="button"
          className="composer__btn composer__stop"
          onClick={onStop}
          aria-label="stop"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          className="composer__btn composer__send"
          onClick={submit}
          disabled={!value.trim()}
          aria-label="send"
        >
          Send
        </button>
      )}
    </div>
  )
}
