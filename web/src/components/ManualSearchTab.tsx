import { AlertTriangle, ChevronDown, ChevronRight, FolderOpen, RefreshCw } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { search } from '../clients/searchClient'
import { useSymbols } from '../clients/useSymbols'
import type { Chunk, SymbolEntry, WireProjection } from '../contract'
import { resolveCitation } from '../lib/resolveCitation'
import { Citations } from './Citations'
import { DecisionBadge } from './DecisionBadge'
import { ResultsList } from './ResultsList'
import { SourceViewer } from './SourceViewer'
import { CorpusTree } from './search/CorpusTree'
import { SymbolCombobox } from './search/SymbolCombobox'

/**
 * Manual-search tab — the deterministic path (POST /search, no LLM, no cost). Reuses the
 * chat's projection renderer (DecisionBadge + Citations + SourceViewer) so there is ONE
 * projection renderer; the only difference from chat is the absence of a streaming bubble.
 *
 * ASSISTED (FTR-56 P4): above the search bar, an "Explore the corpus" panel lets the operator browse
 * the indexed filesystem (CorpusTree) and autocomplete symbols (SymbolCombobox) BEFORE searching —
 * selecting either prefills the query and runs the search. The panel is fed by GET /symbols and
 * DEGRADES GRACEFULLY: if the endpoint is absent (real surface without it yet), it shows
 * "explorer unavailable" and the deterministic search below is entirely unaffected.
 */
export function ManualSearchTab({ baseUrl }: { baseUrl?: string }) {
  const [query, setQuery] = useState('')
  const [projection, setProjection] = useState<WireProjection | null>(null)
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState<{ chunk: Chunk | null } | null>(null)
  const [treeOpen, setTreeOpen] = useState(false)
  const corpus = useSymbols(baseUrl)

  async function runSearch(q: string) {
    const trimmed = q.trim()
    if (!trimmed) {
      return
    }
    setLoading(true)
    setSource(null)
    try {
      setProjection(await search(trimmed, baseUrl))
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void runSearch(query)
  }

  // Pick from the assist (combobox or tree) -> prefill the query and run the deterministic search.
  function pick(entry: SymbolEntry) {
    setQuery(entry.symbol)
    void runSearch(entry.symbol)
  }

  const fileCount = new Set(corpus.symbols.map((s) => s.path)).size

  return (
    <section className="search" aria-label="manual search">
      <div className="mb-4 rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <FolderOpen className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold">Explore the corpus</h3>
          {!corpus.loading && !corpus.error && corpus.symbols.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              {corpus.symbols.length} symbols · {fileCount} files
            </span>
          ) : null}
        </div>

        {corpus.loading ? (
          <div role="status" aria-label="Loading corpus" className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : corpus.error ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span>Corpus explorer unavailable — search still works.</span>
            <Button type="button" variant="outline" size="sm" onClick={corpus.retry}>
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : corpus.symbols.length === 0 ? (
          <p className="text-sm text-muted-foreground">No symbols indexed yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <SymbolCombobox symbols={corpus.symbols} onSelect={pick} />
            <div>
              <button
                type="button"
                onClick={() => setTreeOpen((v) => !v)}
                aria-expanded={treeOpen}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                {treeOpen ? (
                  <ChevronDown className="size-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-4" aria-hidden="true" />
                )}
                Browse files
              </button>
              {treeOpen ? (
                <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border p-1">
                  <CorpusTree symbols={corpus.symbols} onSelect={pick} />
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Read-only over <code className="font-mono">GET /symbols</code> — the same index the
              retriever reads.
            </p>
          </div>
        )}
      </div>

      <form className="search__bar" onSubmit={onSubmit}>
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
        // Split-pane (TKT-524): results on the left, the selected result's code in a dedicated,
        // padded, internally-scrolling pane on the right — IN CONTEXT, not appended at the page
        // bottom. Stacks to one column below lg; the pane clamps its own height so long code scrolls
        // within the pane instead of stretching the page.
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="flex min-w-0 flex-col gap-3">
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
          </div>
          <div
            data-testid="search-preview-pane"
            className="max-h-[70vh] min-w-0 overflow-auto rounded-lg border border-border bg-card p-3 lg:sticky lg:top-4"
          >
            {source ? (
              <SourceViewer chunk={source.chunk} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a result to preview its code here — in context, not dumped at the page
                bottom.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
