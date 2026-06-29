/** Live "what's happening now" indicator — a pulsing dot + text. Hidden when idle. */
export function StatusPill({ status }: { status: string | null }) {
  if (!status) {
    return null
  }
  return (
    <div className="status-pill" role="status">
      <span className="status-pill__dot" aria-hidden="true" />
      {status}
    </div>
  )
}
