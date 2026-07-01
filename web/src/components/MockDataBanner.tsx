import { AlertTriangle } from 'lucide-react'
import { IS_MOCK_BACKEND } from '../lib/config'

/**
 * MockDataBanner — an always-visible, unmissable warning that the UI is showing the DEV MOCK wire
 * (mockWirePlugin fixtures), not a real backend. Rendered in the App shell above every tab, so a
 * mock can never be mistaken for live data during QA / a demo (operator trust fix).
 *
 * `active` defaults to the real environment predicate (IS_MOCK_BACKEND); it is overridable so both
 * states are deterministically testable. When inactive it renders nothing (no layout cost in prod).
 */
export function MockDataBanner({ active = IS_MOCK_BACKEND }: { active?: boolean }) {
  if (!active) {
    return null
  }
  return (
    <div
      role="alert"
      data-testid="mock-data-banner"
      className="flex items-center justify-center gap-2 border-b border-amber-500/40 bg-amber-500/15 px-4 py-1.5 text-center text-sm text-amber-200"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <span>
        <strong className="font-semibold">MOCK DATA</strong> — no backend wired. These are
        deterministic dev fixtures; set <code className="font-mono">VITE_API_BASE</code> to point at
        the live surface.
      </span>
    </div>
  )
}
