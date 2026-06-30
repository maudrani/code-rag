import { serializeProjection } from '../consume/serialize.js'
import type { Citation, GateDecision, Projection } from '../contracts/projection.js'
import type { RankedChunk } from '../contracts/retrieval.js'

const ESC = '\x1b'
const COLORS = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  green: `${ESC}[32m`,
  red: `${ESC}[31m`,
} as const

function paint(text: string, color: keyof typeof COLORS, useColor: boolean): string {
  return useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text
}

function fileLine(c: Citation): string {
  return `${c.path}:${c.span.startLine}-${c.span.endLine}`
}

function resultLine(r: RankedChunk): string {
  const loc = `${r.chunk.path}:${r.chunk.span.startLine}-${r.chunk.span.endLine}`
  return `  [${r.fused.toFixed(3)}] ${loc} ${r.chunk.symbol}`
}

const BAND_COLOR: Record<GateDecision['band'], keyof typeof COLORS> = {
  answer: 'green',
  refuse: 'red',
}

/**
 * citationsHeader — the sources block shown FIRST on the streaming answer path
 * (before any token), mirroring the HTTP wire's meta-before-token order.
 */
export function citationsHeader(p: Projection, useColor: boolean): string {
  if (p.citations.length === 0) return ''
  const lines = p.citations.map((c) => `  ${fileLine(c)}`)
  return `${paint('sources:', 'dim', useColor)}\n${lines.join('\n')}\n\n`
}

/** humanDry — the `--dry` view: the deterministic Projection, human-readable (no LLM ran). */
export function humanDry(p: Projection, useColor: boolean): string {
  const d = p.decision
  const lines = [
    `${paint('query:', 'dim', useColor)} ${p.resolvedQuery}`,
    `${paint('decision:', 'dim', useColor)} ${paint(d.band, BAND_COLOR[d.band], useColor)} · ${d.tier} · grounding ${d.groundingScore.toFixed(3)}`,
    p.citations.length > 0
      ? `${paint('citations:', 'dim', useColor)}\n${p.citations.map((c) => `  ${fileLine(c)}`).join('\n')}`
      : `${paint('citations:', 'dim', useColor)} (none)`,
    p.results.length > 0
      ? `${paint('results:', 'dim', useColor)}\n${p.results.map(resultLine).join('\n')}`
      : `${paint('results:', 'dim', useColor)} (none)`,
  ]
  return `${lines.join('\n')}\n`
}

/** jsonOut — the `--json` view: the serializeProjection DTO (one line, pipeable). */
export function jsonOut(p: Projection): string {
  return JSON.stringify(serializeProjection(p))
}
