import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DecisionBadge } from '../src/components/DecisionBadge'
import type { GateDecision } from '../src/contract'

describe('DecisionBadge', () => {
  it('answer band: shows answer + tier + grounding + model', () => {
    const decision: GateDecision = {
      groundingScore: 0.0312,
      band: 'answer',
      tier: 'strong',
      model: 'mock-strong',
    }
    render(<DecisionBadge decision={decision} />)
    expect(screen.getByText('answer')).toBeInTheDocument()
    expect(screen.getByText('strong')).toBeInTheDocument()
    expect(screen.getByText(/0\.031/)).toBeInTheDocument()
    expect(screen.getByText('mock-strong')).toBeInTheDocument()
  })

  it('cheap tier renders for a single-file answer', () => {
    render(
      <DecisionBadge
        decision={{ groundingScore: 0.02, band: 'answer', tier: 'cheap', model: 'mock-cheap' }}
      />,
    )
    expect(screen.getByText('cheap')).toBeInTheDocument()
  })

  it('refuse band: shows refused + grounding, but NOT a tier (tier is moot on refuse)', () => {
    render(
      <DecisionBadge
        decision={{ groundingScore: 0.006, band: 'refuse', tier: 'cheap', model: 'mock-cheap' }}
      />,
    )
    expect(screen.getByText('refused')).toBeInTheDocument()
    expect(screen.getByText(/0\.006/)).toBeInTheDocument()
    expect(screen.queryByText('cheap')).not.toBeInTheDocument()
  })
})
