import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState, Metric, StatCard } from '../src/components/observability/StatCard'

/** TKT-529 — StatCard/Metric/EmptyState had no dedicated test (only indirect via observability-tab). */
describe('StatCard (TKT-529)', () => {
  it('is a region landmark named by its title, rendering its metrics', () => {
    render(
      <StatCard layerLabel="L1 · Ingest" title="Ingest">
        <Metric label="Files indexed" value="198 / 214" />
      </StatCard>,
    )
    const region = screen.getByRole('region', { name: /ingest/i })
    expect(within(region).getByText('Files indexed')).toBeInTheDocument()
    expect(within(region).getByText('198 / 214')).toBeInTheDocument()
  })

  it('EmptyState renders an explicit message (never a blank card)', () => {
    render(<EmptyState>Not ingested yet.</EmptyState>)
    expect(screen.getByText('Not ingested yet.')).toBeInTheDocument()
  })
})
