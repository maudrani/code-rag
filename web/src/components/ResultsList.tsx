import type { RankedChunk } from '../contract'

/**
 * Ranked retrieval results. Each row shows path#symbol + span + the RRF-fused score and its
 * per-leg breakdown (bm25 / dense / structural) — the hybrid-retrieval signal, honestly. Click
 * opens the source viewer (reuses the chat's join, TKT-506).
 */
export function ResultsList({
  results,
  onOpen,
}: {
  results: RankedChunk[]
  onOpen: (result: RankedChunk) => void
}) {
  if (results.length === 0) {
    return <div className="results__empty">No results.</div>
  }
  return (
    <ul className="results">
      {results.map((result) => (
        <li key={result.chunk.id} className="result">
          <button type="button" className="result__head" onClick={() => onOpen(result)}>
            <span className="result__sym">
              {result.chunk.path}#{result.chunk.symbol}
            </span>
            <span className="result__span">
              :{result.chunk.span.startLine}-{result.chunk.span.endLine}
            </span>
            <span className="result__fused">RRF {result.fused.toFixed(4)}</span>
          </button>
          <div className="result__scores">
            bm25 {result.scores.bm25.toFixed(3)} · dense {result.scores.dense.toFixed(3)} · struct{' '}
            {result.scores.structural.toFixed(3)}
          </div>
        </li>
      ))}
    </ul>
  )
}
