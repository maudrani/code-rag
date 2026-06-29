import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SourceViewer } from '../src/components/SourceViewer'
import { answerProjection } from '../src/mocks/fixtures'

describe('SourceViewer', () => {
  it('renders the chunk code with its path:span header', () => {
    const chunk = answerProjection.results[0].chunk
    render(<SourceViewer chunk={chunk} />)
    expect(screen.getByText(new RegExp(chunk.path))).toBeInTheDocument()
    // a distinctive line of the chunk code is rendered
    expect(screen.getByText(/export async function query/)).toBeInTheDocument()
  })

  it('marks the cited line span as highlighted', () => {
    const chunk = answerProjection.results[0].chunk
    const { container } = render(<SourceViewer chunk={chunk} />)
    expect(container.querySelectorAll('.source__line--hl').length).toBeGreaterThan(0)
  })

  it('renders a graceful fallback (no throw) when the chunk is missing', () => {
    expect(() => render(<SourceViewer chunk={null} />)).not.toThrow()
    expect(screen.getByText(/source not in payload/i)).toBeInTheDocument()
  })
})
