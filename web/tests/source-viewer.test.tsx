import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SourceViewer } from '../src/components/SourceViewer'
import { answerProjection } from '../src/mocks/fixtures'

describe('SourceViewer', () => {
  const chunk = answerProjection.results[0].chunk

  it('renders the chunk with its path:span header', () => {
    render(<SourceViewer chunk={chunk} />)
    expect(screen.getByText(new RegExp(chunk.path))).toBeInTheDocument()
    // before highlight resolves, the code is reachable as plaintext (first-paint)
    expect(screen.getByText(/export async function query/)).toBeInTheDocument()
  })

  it('syntax-highlights the chunk via Shiki CodeBlock', async () => {
    const { container } = render(<SourceViewer chunk={chunk} />)
    await waitFor(() => expect(container.querySelector('pre.shiki')).not.toBeNull())
  })

  it('bands ONLY the cited sub-range, not every line (non-vacuous)', async () => {
    // The contract allows a citation span narrower than the chunk. Cite 2 lines of it.
    const span = { startLine: chunk.span.startLine + 1, endLine: chunk.span.startLine + 2 }
    const { container } = render(<SourceViewer chunk={chunk} citationSpan={span} />)
    await waitFor(() => expect(container.querySelector('.line--cited')).not.toBeNull())
    const total = container.querySelectorAll('.line').length
    const cited = container.querySelectorAll('.line--cited').length
    expect(cited).toBe(2) // exactly the 2 cited lines
    expect(cited).toBeLessThan(total) // ...NOT every line — proves the range, not "mark all"
  })

  it('renders a graceful fallback (no throw) when the chunk is missing', () => {
    expect(() => render(<SourceViewer chunk={null} />)).not.toThrow()
    expect(screen.getByText(/source not in payload/i)).toBeInTheDocument()
  })
})
