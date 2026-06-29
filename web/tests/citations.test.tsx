import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Citations } from '../src/components/Citations'
import { answerProjection } from '../src/mocks/fixtures'

describe('Citations', () => {
  it('renders one clickable chip per citation, labelled file:line', () => {
    render(<Citations citations={answerProjection.citations} onOpen={vi.fn()} />)
    for (const c of answerProjection.citations) {
      expect(screen.getByRole('button', { name: c.label })).toBeInTheDocument()
    }
  })

  it('calls onOpen with the clicked citation', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<Citations citations={answerProjection.citations} onOpen={onOpen} />)
    await user.click(screen.getByRole('button', { name: answerProjection.citations[0].label }))
    expect(onOpen).toHaveBeenCalledWith(answerProjection.citations[0])
  })

  it('renders nothing for an empty citations array', () => {
    const { container } = render(<Citations citations={[]} onOpen={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
