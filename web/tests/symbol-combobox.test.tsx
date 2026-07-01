import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SymbolCombobox } from '../src/components/search/SymbolCombobox'
import type { SymbolEntry } from '../src/contract'

const sym = (path: string, symbol: string): SymbolEntry => ({
  path,
  symbol,
  kind: 'interface',
  lang: 'ts',
  span: { startLine: 1, endLine: 5 },
})

const COMBO: SymbolEntry[] = [
  sym('src/http/routes/search.ts', 'SearchRequest'),
  sym('src/http/routes/search.ts', 'SearchResponse'),
  sym('src/contracts/wire.ts', 'WireProjection'),
  sym('src/ingest/walk.ts', 'walkCorpus'),
]

describe('SymbolCombobox', () => {
  it('exposes an ARIA combobox that is closed until the operator types', () => {
    render(<SymbolCombobox symbols={COMBO} onSelect={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: /find a symbol/i })).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('prefix filter narrows the option list as the query gets more specific', async () => {
    const user = userEvent.setup()
    render(<SymbolCombobox symbols={COMBO} onSelect={vi.fn()} />)
    const input = screen.getByRole('combobox', { name: /find a symbol/i })

    await user.type(input, 'sea')
    // 'sea' matches SearchRequest + SearchResponse
    expect(screen.getAllByRole('option')).toHaveLength(2)

    await user.type(input, 'rchreq')
    // 'searchreq' now narrows to SearchRequest only
    const narrowed = screen.getAllByRole('option')
    expect(narrowed).toHaveLength(1)
    expect(narrowed[0]).toHaveTextContent('SearchRequest')
  })

  it('selecting an option (mouse) fires onSelect with the entry and fills the input', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<SymbolCombobox symbols={COMBO} onSelect={onSelect} />)
    const input = screen.getByRole('combobox', { name: /find a symbol/i })

    await user.type(input, 'Wire')
    await user.click(screen.getByRole('option', { name: /WireProjection/ }))

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'WireProjection', path: 'src/contracts/wire.ts' }),
    )
    expect(input).toHaveValue('WireProjection')
    // list closes after a selection
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('is keyboard-operable: ArrowDown + Enter selects the active option', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<SymbolCombobox symbols={COMBO} onSelect={onSelect} />)
    const input = screen.getByRole('combobox', { name: /find a symbol/i })

    await user.type(input, 'Wire')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'WireProjection' }))
  })

  it('shows a no-match state and Enter is a no-op when nothing matches', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<SymbolCombobox symbols={COMBO} onSelect={onSelect} />)
    const input = screen.getByRole('combobox', { name: /find a symbol/i })

    await user.type(input, 'zzzznope')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText(/no symbols match/i)).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
