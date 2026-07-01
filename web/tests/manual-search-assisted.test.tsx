import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualSearchTab } from '../src/components/ManualSearchTab'
import { answerProjection, symbolsFixture } from '../src/mocks/fixtures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type RouteReply = { body: unknown; ok?: boolean; status?: number } | Error

/** Route /symbols + /search to per-test replies (a value, a status, or a thrown Error). */
function stubFetch(routes: { symbols?: RouteReply; search?: RouteReply }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown) => {
      const u = String(url)
      const reply = u.includes('/symbols')
        ? routes.symbols
        : u.includes('/search')
          ? routes.search
          : undefined
      if (reply === undefined) {
        return Promise.reject(new Error(`unrouted ${u}`))
      }
      if (reply instanceof Error) {
        return Promise.reject(reply)
      }
      const status = reply.status ?? 200
      return Promise.resolve({
        ok: reply.ok ?? (status >= 200 && status < 300),
        status,
        json: async () => reply.body,
      } as unknown as Response)
    }),
  )
}

describe('ManualSearchTab — assisted search', () => {
  it('selecting a symbol in the autocomplete prefills the query and runs the deterministic search', async () => {
    stubFetch({
      symbols: { body: { symbols: symbolsFixture } },
      search: { body: answerProjection },
    })
    const user = userEvent.setup()
    render(<ManualSearchTab baseUrl="" />)

    // the assist loads its combobox from GET /symbols
    const combo = await screen.findByRole('combobox', { name: /find a symbol/i })
    await user.type(combo, 'walkCorpus')
    await user.click(screen.getByRole('option', { name: /walkCorpus/ }))

    // the deterministic search ran and the projection rendered
    expect(await screen.findByText('answer')).toBeInTheDocument()
    // the query was prefilled into the real search input
    expect(screen.getByRole('textbox', { name: /search query/i })).toHaveValue('walkCorpus')
  })

  it('reveals the corpus filesystem tree on demand (browse before you search)', async () => {
    stubFetch({
      symbols: { body: { symbols: symbolsFixture } },
      search: { body: answerProjection },
    })
    const user = userEvent.setup()
    render(<ManualSearchTab baseUrl="" />)

    await screen.findByRole('combobox', { name: /find a symbol/i })
    expect(screen.queryByRole('tree')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /browse files/i }))
    const tree = screen.getByRole('tree', { name: /corpus files/i })
    // the corpus dirs are real treeitems (non-vacuous)
    expect(within(tree).getAllByRole('treeitem').length).toBeGreaterThan(0)
  })

  it('degrades gracefully when /symbols is absent: assist unavailable, deterministic search still works', async () => {
    stubFetch({
      symbols: { body: { error: 'not found' }, status: 404 },
      search: { body: answerProjection },
    })
    const user = userEvent.setup()
    render(<ManualSearchTab baseUrl="" />)

    // the assist reports unavailable — never crashes the tab
    expect(await screen.findByText(/explorer unavailable/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    // the plain deterministic search below is entirely unaffected
    await user.type(screen.getByRole('textbox', { name: /search query/i }), 'membrane')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('answer')).toBeInTheDocument()
  })
})
