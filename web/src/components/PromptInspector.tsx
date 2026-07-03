import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { WirePrompt } from '../contract'

/**
 * PromptInspector — reveals the EXACT L5 prompt for an answered turn, straight from the wire:
 *  - `system` is the SUBSTRATE the model reasons over: the answer-only policy + the assembled
 *    retrieved code + the citable id set + the cite instruction.
 *  - `messages` is what the API literally receives: the windowed history + the resolved query.
 *
 * This is the guardrail made inspectable — the model sees ONLY this, so it cannot answer from outside
 * the retrieved context. Collapsed by default (the assembled context can be long).
 */
export function PromptInspector({ prompt }: { prompt: WirePrompt }) {
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  const messages = prompt.messages.map((m) => `${m.role}: ${m.content}`).join('\n\n')
  return (
    <div className="mt-2">
      <button
        type="button"
        data-testid="prompt-inspector-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <Chevron className="size-4 shrink-0" aria-hidden="true" />
        {open ? 'Hide' : 'Show'} the exact prompt sent to the model
      </button>
      {open ? (
        <div data-testid="prompt-inspector" className="mt-2 flex flex-col gap-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            system — the substrate: answer-only policy + assembled context + citable ids
          </div>
          <pre
            data-testid="prompt-system"
            className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card p-3 font-mono text-xs leading-relaxed"
          >
            {prompt.system}
          </pre>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            messages — exactly what the LLM API receives
          </div>
          <pre
            data-testid="prompt-messages"
            className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card p-3 font-mono text-xs leading-relaxed"
          >
            {messages}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
