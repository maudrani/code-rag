import { Search } from 'lucide-react'
import { type KeyboardEvent, useId, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { SymbolEntry } from '../../contract'

/** Max options shown at once; the rest are summarised as "+N more" (never silently dropped). */
const MAX_VISIBLE = 8

interface SymbolComboboxProps {
  symbols: SymbolEntry[]
  onSelect: (entry: SymbolEntry) => void
  /** disable while the corpus is still loading. */
  disabled?: boolean
}

interface Ranked {
  entry: SymbolEntry
  rank: number
}

/** Case-insensitive substring match over symbol name + path, ranked so name-prefix hits float up. */
function rankMatches(symbols: SymbolEntry[], query: string): SymbolEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return []
  }
  const ranked: Ranked[] = []
  for (const entry of symbols) {
    const name = entry.symbol.toLowerCase()
    const path = entry.path.toLowerCase()
    const nameIdx = name.indexOf(q)
    const pathIdx = path.indexOf(q)
    if (nameIdx === -1 && pathIdx === -1) {
      continue
    }
    // 0 = symbol-name prefix, 1 = name substring, 2 = path-only
    const rank = nameIdx === 0 ? 0 : nameIdx > 0 ? 1 : 2
    ranked.push({ entry, rank })
  }
  ranked.sort((a, b) => a.rank - b.rank || a.entry.symbol.localeCompare(b.entry.symbol))
  return ranked.map((r) => r.entry)
}

/**
 * SymbolCombobox — accessible type-ahead over the corpus symbol index (WAI-ARIA APG combobox:
 * editable, list autocomplete). Typing a prefix narrows the list; selecting an option (mouse or
 * keyboard) hands the entry to the caller, which prefills + runs the deterministic search. The
 * option list is capped at MAX_VISIBLE with a visible "+N more" count so a match is never silently
 * hidden (FTR-56 P4 negative test).
 */
export function SymbolCombobox({ symbols, onSelect, disabled = false }: SymbolComboboxProps) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const matches = useMemo(() => rankMatches(symbols, query), [symbols, query])
  const visible = matches.slice(0, MAX_VISIBLE)
  const overflow = matches.length - visible.length
  const hasQuery = query.trim().length > 0
  const optionId = (i: number) => `${listId}-opt-${i}`

  function choose(entry: SymbolEntry) {
    onSelect(entry)
    setQuery(entry.symbol)
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, visible.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      if (open && active >= 0 && active < visible.length) {
        event.preventDefault()
        choose(visible[active])
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          aria-label="Find a symbol"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder="Jump to a symbol — type a name or path"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => hasQuery && setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
      </div>

      {open && hasQuery ? (
        // Neutral <div> containers carry the ARIA listbox/option roles (WAI-ARIA APG combobox):
        // focus stays on the input, options are tracked via aria-activedescendant, not tab order.
        <div
          id={listId}
          role="listbox"
          aria-label="Symbol suggestions"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {visible.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">
              No symbols match “{query.trim()}”.
            </div>
          ) : (
            visible.map((entry, i) => (
              <div
                key={`${entry.path}#${entry.symbol}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                // onMouseDown (not onClick) so the choice lands before the input's blur closes the list
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(entry)
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm',
                  i === active ? 'bg-accent text-accent-foreground' : 'text-foreground',
                )}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate font-mono">{entry.symbol}</span>
                  <span className="truncate text-xs text-muted-foreground">{entry.path}</span>
                </span>
                <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-secondary-foreground">
                  {entry.kind}
                </span>
              </div>
            ))
          )}
          {overflow > 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground" aria-live="polite">
              +{overflow} more — refine your query
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
