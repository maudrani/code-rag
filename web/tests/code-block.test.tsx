import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { CodeBlock } from '../src/components/CodeBlock'
import { _resetHighlighterForTest } from '../src/lib/highlighter'

beforeEach(() => {
  _resetHighlighterForTest()
})

describe('CodeBlock', () => {
  it('shows the raw code immediately (plaintext first-paint), then swaps to highlighted', async () => {
    const { container } = render(<CodeBlock code="const x = 1" lang="ts" />)
    // First paint: plain, contiguous text (before the async highlight resolves).
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
    // Then Shiki resolves and the tokenized markup swaps in.
    await waitFor(() => expect(container.querySelector('pre.shiki')).not.toBeNull())
    expect(container.querySelectorAll('span[style*="color"]').length).toBeGreaterThan(1)
  })

  it('renders an unknown language without crashing (escaped plaintext)', async () => {
    const { container } = render(<CodeBlock code="WHATEVER LANG" lang="brainfuck-x" />)
    await waitFor(() => expect(container.querySelector('pre')).not.toBeNull())
    expect(screen.getByText(/WHATEVER LANG/)).toBeInTheDocument()
  })

  it('does not flicker back to plaintext when re-rendered with identical props (memoized)', async () => {
    const { container, rerender } = render(<CodeBlock code="const x = 1" lang="ts" />)
    await waitFor(() => expect(container.querySelector('pre.shiki')).not.toBeNull())
    const firstHtml = container.querySelector('pre.shiki')?.outerHTML
    rerender(<CodeBlock code="const x = 1" lang="ts" />)
    expect(container.querySelector('pre.shiki')?.outerHTML).toBe(firstHtml)
  })

  it('passes the cited line range through to the highlighter', async () => {
    const { container } = render(<CodeBlock code={'a\nb\nc'} lang="text" highlightLines={[2, 2]} />)
    await waitFor(() => expect(container.querySelector('.line--cited')).not.toBeNull())
    expect(container.querySelectorAll('.line--cited').length).toBe(1)
  })
})
