/**
 * Pure presentation helpers for the Observability tab (FTR-56) — NO React, NO I/O, fully
 * deterministic, so they are unit-tested directly (demonstrate-deterministically). Colour choice
 * and DOM live in the components; this file only shapes numbers + records.
 */
import type { Leg, QueryLogEntry } from '../../contract'

/** Human latency: sub-ms, ms, or seconds. */
export function formatMs(ms: number): string {
  if (ms < 1) {
    return '<1 ms'
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`
  }
  return `${(ms / 1000).toFixed(2)} s`
}

/** Human USD cost — sub-cent answers need 5 decimals to be visible at all. */
export function formatCost(usd: number): string {
  if (usd === 0) {
    return '$0'
  }
  if (usd < 0.01) {
    return `$${usd.toFixed(5)}`
  }
  return `$${usd.toFixed(4)}`
}

/** Index size; null = the live index is `:memory:` (no on-disk footprint). */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return 'in-memory'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const kb = bytes / 1024
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`
  }
  return `${(kb / 1024).toFixed(1)} MB`
}

/** Freshness of the last index build (`staleMs = now - builtAt`). */
export function formatStale(ms: number): string {
  if (ms < 1000) {
    return 'just now'
  }
  const s = Math.round(ms / 1000)
  if (s < 60) {
    return `${s}s ago`
  }
  const m = Math.round(s / 60)
  if (m < 60) {
    return `${m}m ago`
  }
  return `${Math.round(m / 60)}h ago`
}

export function formatInt(n: number): string {
  return n.toLocaleString('en-US')
}

/** A hybrid-retrieval score to a stable 4-decimal string (RRF contributions are small). */
export function formatScore(n: number): string {
  return n.toFixed(4)
}

/** The ordered legs — bm25, dense, structural — so "dense is live" reads the same everywhere. */
export const LEG_ORDER: readonly Leg[] = ['bm25', 'dense', 'structural']

export interface LegDatum {
  leg: Leg
  label: string
  score: number
}

/** scoresByLeg -> an ordered dataset (missing legs coerce to 0, never undefined). */
export function legChartData(scoresByLeg: QueryLogEntry['scoresByLeg']): LegDatum[] {
  return LEG_ORDER.map((leg) => ({ leg, label: leg, score: scoresByLeg[leg] ?? 0 }))
}

export interface DistDatum {
  name: string
  value: number
}

/** A Record<string, number> (byKind / byLang) as a descending-by-value bar dataset. */
export function distributionData(rec: Record<string, number>): DistDatum[] {
  return Object.entries(rec)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
}
