import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TracePanel } from '../src/components/TracePanel'
import type { Event } from '../src/contract'
import { makeTraceEvents } from '../src/mocks/wireMock'

describe('TracePanel', () => {
  it('renders per-layer groups for the pipeline (L0..L5 + membrane), in order', () => {
    render(<TracePanel events={makeTraceEvents('q-x')} />)
    for (const layer of ['L0', 'L2', 'L4', 'membrane', 'L5']) {
      expect(screen.getByText(layer)).toBeInTheDocument()
    }
  })

  it('surfaces the L5 cost payload (tokens / tier / estCost)', () => {
    render(<TracePanel events={makeTraceEvents('q-x')} />)
    expect(screen.getByText(/tokens=128/)).toBeInTheDocument()
    expect(screen.getByText(/tier=strong/)).toBeInTheDocument()
  })

  it('shows an empty state when there are no events', () => {
    render(<TracePanel events={[]} />)
    expect(screen.getByText(/no events/i)).toBeInTheDocument()
  })

  it('renders an unsafe/odd payload as inert text — no HTML injection, no crash', () => {
    const evil: Event[] = [
      { queryId: 'q', layer: 'L0', type: 'x', payload: '<img src=x onerror="alert(1)">', ts: 1 },
    ]
    const { container } = render(<TracePanel events={evil} />)
    expect(container.querySelector('img')).toBeNull()
  })
})
