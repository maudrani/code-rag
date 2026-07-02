import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPill } from '../src/components/StatusPill'

/** TKT-529 — StatusPill had ZERO test; the chat never sets a non-null status so its live path was dead. */
describe('StatusPill (TKT-529)', () => {
  it('renders nothing when idle (status null)', () => {
    const { container } = render(<StatusPill status={null} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders the status text as a role=status live indicator when set', () => {
    render(<StatusPill status="Searching the codebase…" />)
    expect(screen.getByRole('status')).toHaveTextContent(/searching the codebase/i)
  })
})
