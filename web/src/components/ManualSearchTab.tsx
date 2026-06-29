import { type FormEvent, useState } from 'react'
import { search } from '../clients/searchClient'
import type { Chunk, WireProjection } from '../contract'
import { resolveCitation } from '../lib/resolveCitation'
import { Citations } from './Citations'
import { DecisionBadge } from './DecisionBadge'
import { ResultsList } from './ResultsList'
import { SourceViewer } from './SourceViewer'

/**
 * Manual-search tab — the deterministic path (POST /search, no LLM, no cost). Reuses the
 * chat's projection renderer (DecisionBadge + Citations + SourceViewer) so there is ONE
 * projection renderer; the only difference from chat is the absence of a streaming bubble.
 */
export function ManualSearchTab({ baseUrl }: { baseUrl?: string }) {
  const [query, setQuery] = useState('')
  const [projection, setProjection] = useState<WireProjection | null>(null)
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState<{ chunk: Chunk | null } | null>(null)

  async function run(event: FormEvent) {
    event.preventDefault()
    const q = query.trim()
    if (!q) {
      return
    }
    setLoading(true)
    setSource(null)
    try {
      setProjection(await search(q, baseUrl))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="search" aria-label="manual search">
      <form className="search__bar" onSubmit={run}>
        <input
          className="search__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the codebase — deterministic, no LLM, no cost"
          aria-label="search query"
        />
        <button type="submit" className="composer__btn composer__send" disabled={!query.trim()}>
          Search
        </button>
      </form>

      {loading && <div className="search__status">Searching…</div>}
      {!loading && !projection && (
        <div className="search__empty">Run a search to see ranked code — no tokens billed.</div>
      )}
      {!loading && projection && (
        <div className="search__results">
          <DecisionBadge decision={projection.decision} />
          <ResultsList
            results={projection.results}
            onOpen={(result) => setSource({ chunk: result.chunk })}
          />
          <Citations
            citations={projection.citations}
            onOpen={(citation) =>
              setSource({ chunk: resolveCitation(citation, projection.results) })
            }
          />
          {source && <SourceViewer chunk={source.chunk} />}
        </div>
      )}
    </section>
  )
}
