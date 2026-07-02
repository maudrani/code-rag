import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatView } from '../src/components/ChatView'
import { LiveListenerTab } from '../src/components/LiveListenerTab'
import { ManualSearchTab } from '../src/components/ManualSearchTab'
import { ObservabilityTab } from '../src/components/observability/ObservabilityTab'
import { CARD_SURFACE, OUTCOME_TONES } from '../src/lib/badgeTones'
import {
  ANSWER_TEXT,
  answerProjection,
  healthFixture,
  statsFixture,
  symbolsFixture,
} from '../src/mocks/fixtures'
import { encodeSse } from '../src/mocks/sseEncode'
import { makeQueryStream } from '../src/mocks/wireMock'
import { assertContrastAA, assertHasBottomGutter } from './_ui-verify'
import { streamFromString } from './sse-test-utils'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('accessibility', () => {
  it('exposes a polite live region for streaming announcements', () => {
    render(<ChatView />)
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull()
  })

  it('the composer input is reachable as a labelled textbox (keyboard)', () => {
    render(<ChatView />)
    expect(screen.getByRole('textbox', { name: /message/i })).toBeInTheDocument()
  })

  it('announces completion when the answer is done (not per token)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        body: streamFromString(
          encodeSse(makeQueryStream(answerProjection, { answer: ANSWER_TEXT })),
          16,
        ),
      })),
    )
    const user = userEvent.setup()
    render(<ChatView />)

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'q')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]')
      expect(live?.textContent ?? '').toMatch(/answer ready/i)
    })
  })
})

describe('accessibility — Observability tab', () => {
  it('exposes the layers as a keyboard tablist + named region landmarks + a labelled refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        const body = String(url).includes('/health') ? healthFixture : statsFixture
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => body,
        } as unknown as Response)
      }),
    )
    render(<ObservabilityTab />)

    // the aggregate health + the default layer are landmarks with accessible names
    expect(await screen.findByRole('region', { name: /health/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /ingest/i })).toBeInTheDocument()

    // the five layers are a proper ARIA tablist (keyboard-navigable roving tabs)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    for (const name of [/ingest/i, /chunk/i, /index/i, /retrieve/i, /answer/i]) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
    // the refresh action is a real, named button
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
    // the view carries a bottom gutter so its last card does not glue to the viewport bottom (TKT-524)
    assertHasBottomGutter(screen.getByRole('region', { name: /observability/i }))
  })
})

describe('accessibility — assisted search', () => {
  it('exposes the corpus assist as an ARIA combobox + a browsable tree, with a labelled search box', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () =>
            String(url).includes('/symbols') ? { symbols: symbolsFixture } : answerProjection,
        } as unknown as Response),
      ),
    )
    const user = userEvent.setup()
    render(<ManualSearchTab baseUrl="" />)

    // the symbol autocomplete is a proper combobox (keyboard type-ahead)
    expect(await screen.findByRole('combobox', { name: /find a symbol/i })).toBeInTheDocument()
    // the deterministic search input stays a labelled textbox
    expect(screen.getByRole('textbox', { name: /search query/i })).toBeInTheDocument()

    // the corpus browser is a real ARIA tree once revealed
    await user.click(screen.getByRole('button', { name: /browse files/i }))
    expect(screen.getByRole('tree', { name: /corpus files/i })).toBeInTheDocument()
  })
})

describe('accessibility — live listener', () => {
  it('exposes the live feed as a labelled region with a status live-region', () => {
    // jsdom has no EventSource + no injected factory -> the hook resolves to a graceful status region
    render(<LiveListenerTab />)
    expect(screen.getByRole('region', { name: /live listener/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    // the feed view carries a bottom gutter (no bottom-glue) — TKT-524 cross-view check
    assertHasBottomGutter(screen.getByRole('region', { name: /live listener/i }))
  })
})

describe('accessibility — design-token contrast (RULE-UI-001 deterministic leg, TKT-525/522)', () => {
  it('every ledger outcome tone meets WCAG AA on the card surface (token-level, jsdom-deterministic)', () => {
    for (const [tone, hex] of Object.entries(OUTCOME_TONES)) {
      expect(() => assertContrastAA(hex, CARD_SURFACE), `${tone} ${hex}`).not.toThrow()
    }
  })
})
