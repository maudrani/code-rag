import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CorpusTree } from '../src/components/search/CorpusTree'
import { buildCorpusTree, countFiles, type TreeDir } from '../src/components/search/treeModel'
import type { SymbolEntry } from '../src/contract'

const sym = (path: string, symbol: string, startLine: number): SymbolEntry => ({
  path,
  symbol,
  kind: 'other',
  lang: 'ts',
  span: { startLine, endLine: startLine + 4 },
})

const SAMPLE: SymbolEntry[] = [
  sym('src/contracts/wire.ts', 'SearchRequest', 18),
  sym('src/contracts/wire.ts', 'WireProjection', 9),
  sym('src/contracts/chunk.ts', 'Chunk', 6),
  sym('src/membrane/index.ts', 'query', 20),
]

describe('buildCorpusTree', () => {
  it('buildCorpusTree turns flat paths into a nested dir tree (non-vacuous)', () => {
    const tree = buildCorpusTree(SAMPLE)
    // one root: src
    expect(tree).toHaveLength(1)
    const src = tree[0] as TreeDir
    expect(src.type).toBe('dir')
    expect(src.name).toBe('src')
    // shared prefix collapses: 'contracts' appears ONCE, not once per file
    const dirNames = src.children.map((c) => c.name)
    expect(dirNames).toEqual(['contracts', 'membrane'])

    const contracts = src.children[0] as TreeDir
    // dirs sort before files; both alphabetical -> chunk.ts before wire.ts
    expect(contracts.children.map((c) => c.name)).toEqual(['chunk.ts', 'wire.ts'])

    const wire = contracts.children[1]
    expect(wire.type).toBe('file')
    if (wire.type === 'file') {
      // both symbols grouped under the one file, sorted by start line
      expect(wire.symbols.map((s) => s.symbol)).toEqual(['WireProjection', 'SearchRequest'])
    }
  })

  it('is empty for an empty corpus and drops pathless entries (total function)', () => {
    expect(buildCorpusTree([])).toEqual([])
    expect(buildCorpusTree([sym('', 'ghost', 1)])).toEqual([])
  })

  it('countFiles counts leaf files across the tree', () => {
    // wire.ts, chunk.ts, index.ts = 3 files (4 symbols)
    expect(countFiles(buildCorpusTree(SAMPLE))).toBe(3)
  })
})

describe('CorpusTree', () => {
  it('renders an ARIA tree; files start collapsed and reveal their symbols on demand', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<CorpusTree symbols={SAMPLE} onSelect={onSelect} />)

    expect(screen.getByRole('tree', { name: /corpus files/i })).toBeInTheDocument()
    // dirs render expanded -> the file node is visible
    const fileBtn = screen.getByRole('button', { name: /wire\.ts/i })
    expect(fileBtn).toBeInTheDocument()
    // files start collapsed -> the symbol is NOT in the DOM yet
    expect(screen.queryByText('WireProjection')).not.toBeInTheDocument()

    // expand the file -> its symbols appear as treeitems; selecting one calls onSelect with the entry
    await user.click(fileBtn)
    const symbolBtn = screen.getByRole('button', { name: /WireProjection/ })
    await user.click(symbolBtn)
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'WireProjection', path: 'src/contracts/wire.ts' }),
    )
  })

  it('renders an explicit empty state for an empty corpus', () => {
    render(<CorpusTree symbols={[]} onSelect={vi.fn()} />)
    expect(screen.getByText(/no files in the corpus/i)).toBeInTheDocument()
    expect(screen.queryByRole('tree')).not.toBeInTheDocument()
  })

  it('collapses shared path prefixes into a single directory chain (no duplicate dirs)', () => {
    render(<CorpusTree symbols={SAMPLE} onSelect={vi.fn()} />)
    const tree = screen.getByRole('tree')
    // 'contracts' directory label appears exactly once despite two files under it
    expect(within(tree).getAllByText('contracts')).toHaveLength(1)
  })
})
