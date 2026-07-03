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

  it('projected (Manual search): the model reads "would route to <model>" — no LLM was called', () => {
    const decision: GateDecision = {
      groundingScore: 0.0177,
      band: 'answer',
      tier: 'strong',
      model: 'claude-sonnet-4-6',
    }
    render(<DecisionBadge decision={decision} projected />)
    // it must NOT present the model as if it answered — it is the route the gate WOULD take
    expect(screen.getByText('would route to claude-sonnet-4-6')).toBeInTheDocument()
    expect(screen.queryByText('claude-sonnet-4-6')).not.toBeInTheDocument()
    expect(screen.getByText('answer')).toBeInTheDocument() // band + grounding are real (computed by /search)
    expect(screen.getByText(/0\.018/)).toBeInTheDocument() // 0.0177.toFixed(3) → "0.018"
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
