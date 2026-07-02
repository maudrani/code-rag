import { FolderGit2, Loader2 } from 'lucide-react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { ingest } from '../clients/ingestClient'
import type { IngestResponse } from '../contract'
import { repoLabel } from '../lib/repoLabel'

/**
 * RepoIngestBar (FTR-5 P4, TKT-533) — paste a GitHub/git URL in the app header to index that repo;
 * chat + search then run over it. A COMPACT header field + an always-visible active-corpus chip (NOT a
 * modal — a modal hides which repo is live). State machine: idle → submitting (spinner, input disabled)
 * → success (chip = repo) / error (message; the PRIOR chip is left UNCHANGED — the server keeps the old
 * corpus on any failure, so the UI must not flip). A mountedRef ignores a stale in-flight response after
 * unmount so the chip never flickers to the wrong repo (same guard as LiveListenerTab, TKT-531).
 *
 * Web ⊥ Node: talks only to the /ingest wire. The active corpus is server-side (one engine), so a
 * successful ingest needs no client corpus state beyond the chip — chat/search already target the same
 * baseUrl, hence the now-active repo.
 */
export function RepoIngestBar({
  baseUrl = '',
  onIngested,
}: {
  baseUrl?: string
  onIngested?: (corpus: IngestResponse['activeCorpus']) => void
}) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [corpus, setCorpus] = useState<IngestResponse['activeCorpus'] | null>(null)
  const mountedRef = useRef(true)
  const inputId = useId()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false // unmount → ignore a late (stale) /ingest response
    }
  }, [])

  const submitting = status === 'submitting'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = url.trim()
    if (!trimmed || submitting) {
      return
    }
    setStatus('submitting')
    setErrorMsg('')
    try {
      const res = await ingest(trimmed, baseUrl)
      if (!mountedRef.current) {
        return // stale — the component is gone; do not touch state
      }
      setCorpus(res.activeCorpus)
      setStatus('idle')
      setUrl('')
      onIngested?.(res.activeCorpus)
    } catch (err) {
      if (!mountedRef.current) {
        return
      }
      // the server kept the PREVIOUS corpus — leave `corpus` untouched, just surface the error.
      setErrorMsg(err instanceof Error ? err.message : 'Indexing failed')
      setStatus('error')
    }
  }

  return (
    <div data-testid="repo-ingest-bar" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
      <form onSubmit={onSubmit} className="flex min-w-0 items-center gap-2">
        <label htmlFor={inputId} className="shrink-0 text-xs text-muted-foreground">
          Index a repo
        </label>
        <input
          id={inputId}
          data-testid="repo-url-input"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={submitting}
          placeholder="Paste a git repo URL…"
          className="h-7 w-64 max-w-[60vw] rounded border border-border bg-card px-2 text-xs text-foreground placeholder:text-muted-foreground disabled:opacity-60"
        />
        <button
          type="submit"
          data-testid="repo-index-submit"
          disabled={submitting}
          className="flex h-7 shrink-0 items-center gap-1 rounded border border-border bg-card px-2 text-xs font-medium hover:bg-accent/40 disabled:opacity-60"
        >
          {submitting ? (
            <Loader2
              data-testid="repo-ingest-spinner"
              role="status"
              aria-label="Indexing…"
              className="size-3.5 animate-spin"
            />
          ) : null}
          {submitting ? 'Indexing…' : 'Index'}
        </button>
      </form>

      <span
        data-testid="active-corpus-chip"
        title={
          corpus
            ? corpus.url
            : 'The default corpus (this repo, self-indexed) until you index another'
        }
        className="flex min-w-0 max-w-[16rem] items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-0.5 text-xs text-muted-foreground"
      >
        <FolderGit2 className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="truncate">{corpus ? repoLabel(corpus.url) : 'self-indexed corpus'}</span>
      </span>

      {status === 'error' ? (
        <span data-testid="repo-ingest-error" role="alert" className="min-w-0 text-xs text-refuse">
          {errorMsg}
        </span>
      ) : null}
    </div>
  )
}
