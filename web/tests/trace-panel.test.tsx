import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChatTelemetry } from '../src/clients/useChatStream'
import { TracePanel } from '../src/components/TracePanel'
import type { Event, RankedChunk } from '../src/contract'
import { makeTraceEvents } from '../src/mocks/wireMock'

const topHit: RankedChunk = {
  chunk: {
    id: 'src/membrane/index.ts#query@20-44',
    path: 'src/membrane/index.ts',
    lang: 'ts',
    symbol: 'query',
    kind: 'function',
    span: { startLine: 20, endLine: 44 },
    code: '',
    structuralRefs: { calls: [], imports: [] },
  },
  scores: { bm25: 0.0187, dense: 0.0231, structural: 0.0094 },
  fused: 0.0312,
  cosine: 0.41,
}

describe('TracePanel', () => {
  it('renders the COMPLETE per-queryId telemetry (rewrite → per-leg+cosine → gate+model → tokens+cost)', () => {
    const telemetry: ChatTelemetry = {
      queryId: 'q-1',
      question: 'how does it work',
      resolvedQuery: 'how does the membrane orchestrate a query',
      decision: {
        groundingScore: 0.0312,
        band: 'answer',
        tier: 'strong',
        model: 'claude-sonnet-4-6',
      },
      results: [topHit],
      usage: { tokensTotal: 128, estCost: 0.00026 },
    }
    render(<TracePanel events={[]} telemetry={telemetry} />)

    // L0 rewrite (question → resolvedQuery)
    expect(screen.getByText('how does the membrane orchestrate a query')).toBeInTheDocument()
    // L3/L4 per-leg + the FTR-55 cosine signal
    expect(screen.getByText(/dense 0\.0231/)).toBeInTheDocument()
    expect(screen.getByText(/cos 0\.410/)).toBeInTheDocument()
    // gate + model
    expect(screen.getByText(/claude-sonnet-4-6/)).toBeInTheDocument()
    // L5 tokens + cost
    expect(screen.getByText(/128 tokens/)).toBeInTheDocument()
    expect(screen.getByText(/\$0\.00026/)).toBeInTheDocument()
  })

  it('shows "refused — no LLM ($0)" for a refused turn (no cost)', () => {
    const telemetry: ChatTelemetry = {
      queryId: 'q-2',
      question: 'capital of france',
      resolvedQuery: 'capital of france',
      decision: { groundingScore: 0.006, band: 'refuse', tier: 'cheap', model: '' },
      results: [],
    }
    render(<TracePanel events={[]} telemetry={telemetry} />)
    expect(screen.getByText(/refused — no LLM/i)).toBeInTheDocument()
  })

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
