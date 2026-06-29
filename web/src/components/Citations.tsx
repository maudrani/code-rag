import type { Citation } from '../contract'

/** Clickable file:line citation chips (ADR-006 §UI). Click opens the source viewer. */
export function Citations({
  citations,
  onOpen,
}: {
  citations: Citation[]
  onOpen: (citation: Citation) => void
}) {
  if (citations.length === 0) {
    return null
  }
  return (
    <div className="citations">
      {citations.map((citation) => (
        <button
          type="button"
          key={citation.chunkId}
          className="citation"
          onClick={() => onOpen(citation)}
        >
          {citation.label}
        </button>
      ))}
    </div>
  )
}
