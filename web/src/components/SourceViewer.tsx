import type { CSSProperties } from 'react'
import type { Chunk, Citation } from '../contract'
import { inferLang } from '../lib/inferLang'
import { CodeBlock } from './CodeBlock'

/** Map an absolute citation span to chunk-relative 1-based [start, end], clamped to the code. */
function toRelativeRange(
  span: { startLine: number; endLine: number },
  chunkStart: number,
  lineCount: number,
): [number, number] {
  const start = Math.max(1, span.startLine - chunkStart + 1)
  const end = Math.min(lineCount, span.endLine - chunkStart + 1)
  return [start, end]
}

/**
 * In-app source view for a citation (TKT-511): the cited chunk rendered with Shiki syntax
 * highlighting (CodeBlock), line-numbered from its absolute file line, with the cited span
 * banded. The chunk's code IS the cited span by default (ADR-002); the contract also allows a
 * narrower `citationSpan`, which the viewer honors (chunk-relative + clamped). A null chunk
 * (trimmed from the light payload) renders a graceful notice instead of crashing.
 */
export function SourceViewer({
  chunk,
  citationSpan,
}: {
  chunk: Chunk | null
  citationSpan?: Citation['span']
}) {
  if (!chunk) {
    return (
      <div className="source source--missing" role="note">
        Source not in payload for this citation.
      </div>
    )
  }

  const lang = chunk.lang || inferLang(chunk.path)
  const lineCount = chunk.code.split('\n').length
  const highlightLines = citationSpan
    ? toRelativeRange(citationSpan, chunk.span.startLine, lineCount)
    : undefined

  return (
    <div className="source">
      <div className="source__head">
        {chunk.path}:{chunk.span.startLine}-{chunk.span.endLine}
      </div>
      <div
        className="source__lines"
        style={{ '--start-line': chunk.span.startLine } as CSSProperties}
      >
        <CodeBlock code={chunk.code} lang={lang} highlightLines={highlightLines} />
      </div>
    </div>
  )
}
