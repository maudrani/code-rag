import type { Chunk } from '../contract'

/**
 * In-app source view for a citation: line-numbered code with the cited span highlighted.
 * The chunk's code IS the cited span (ADR-002), so every rendered line is part of it. A
 * null chunk (trimmed from the light payload) renders a graceful notice instead of crashing.
 */
export function SourceViewer({ chunk }: { chunk: Chunk | null }) {
  if (!chunk) {
    return (
      <div className="source source--missing" role="note">
        Source not in payload for this citation.
      </div>
    )
  }

  const lines = chunk.code.split('\n')
  return (
    <div className="source">
      <div className="source__head">
        {chunk.path}:{chunk.span.startLine}-{chunk.span.endLine}
      </div>
      <pre className="source__code">
        {lines.map((line, i) => {
          const lineNo = chunk.span.startLine + i
          return (
            <div key={lineNo} className="source__line source__line--hl">
              <span className="source__ln">{lineNo}</span>
              <span className="source__lc">{line}</span>
            </div>
          )
        })}
      </pre>
    </div>
  )
}
