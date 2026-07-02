import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LayerDetail } from '../src/components/observability/LayerDetail'
import { LAYERS } from '../src/components/observability/layerContent'
import { statsFixture } from '../src/mocks/fixtures'

/** TKT-529 — LayerDetail's glossary + CLI callout were only covered incidentally via observability-tab. */
describe('LayerDetail (TKT-529)', () => {
  it('renders the layer telemetry card, its glossary, and the per-layer agent CLI command', () => {
    const ingest = LAYERS[0] // L1 · Ingest
    render(<LayerDetail layer={ingest} stats={statsFixture} />)
    // the CLI command an agent owning this layer would run (CLI/MCP/HTTP parity thesis)
    expect(screen.getByText(/code-rag stats --layer ingest/)).toBeInTheDocument()
    // a glossary term — "what each number means" (distinct from the card's "Files indexed" metric)
    expect(screen.getByText(/files indexed \/ walked/i)).toBeInTheDocument()
  })
})
