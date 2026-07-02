import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ChunkCard,
  coveragePct,
  freshnessTone,
  IndexCard,
  IngestCard,
} from '../src/components/observability/LayerCards'
import type { IngestTelemetry } from '../src/contract'

const ingest = (over: Partial<IngestTelemetry>): IngestTelemetry => ({
  filesWalked: 0,
  filesIndexed: 0,
  skipped: 0,
  chunks: 0,
  byLang: {},
  errors: [],
  durationMs: 0,
  ...over,
})

/** TKT-529 — the pure helpers + the null/empty card branches never exercised off the all-populated fixture. */
describe('LayerCards pure helpers (TKT-529)', () => {
  it('coveragePct: full / partial / zero-walked (never NaN or Infinity)', () => {
    expect(coveragePct(ingest({ filesWalked: 200, filesIndexed: 200 }))).toBe(100)
    expect(coveragePct(ingest({ filesWalked: 214, filesIndexed: 198 }))).toBe(93)
    expect(coveragePct(ingest({ filesWalked: 0, filesIndexed: 0 }))).toBe(0)
  })

  it('freshnessTone: fresh (<1m) / aging (<1h) / stale (≥1h) branches', () => {
    expect(freshnessTone(30_000)).toContain('emerald')
    expect(freshnessTone(600_000)).toContain('amber')
    expect(freshnessTone(7_200_000)).toContain('rose')
  })
})

describe('LayerCards empty states (TKT-529 — the data===null branch)', () => {
  it('IngestCard renders an empty state when not ingested', () => {
    render(<IngestCard data={null} />)
    expect(screen.getByText(/not ingested yet/i)).toBeInTheDocument()
  })
  it('ChunkCard renders an empty state when no chunks', () => {
    render(<ChunkCard data={null} />)
    expect(screen.getByText(/no chunks yet/i)).toBeInTheDocument()
  })
  it('IndexCard renders an empty state when the index is not built', () => {
    render(<IndexCard data={null} />)
    expect(screen.getByText(/index not built yet/i)).toBeInTheDocument()
  })
})
