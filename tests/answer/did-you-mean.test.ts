import { describe, expect, it } from 'vitest'
import { suggestSymbol } from '../../src/answer/did-you-mean.js'
import { refusalMessage } from '../../src/answer/guardrails.js'
import type { RankedChunk } from '../../src/contracts/index.js'

// A RankedChunk whose only relevant field is chunk.symbol (the candidate pool).
function rc(symbol: string): RankedChunk {
  return {
    chunk: {
      id: `f.ts#${symbol}@1-2`,
      path: 'f.ts',
      lang: 'ts',
      symbol,
      kind: 'function',
      span: { startLine: 1, endLine: 2 },
      code: `function ${symbol}() {}`,
      structuralRefs: { calls: [], imports: [] },
    },
    scores: { bm25: 0, dense: 0, structural: 0 },
    fused: 0.02,
  }
}

// ── SC-8: suggestSymbol ─────────────────────────────────────────────────────────
describe('suggestSymbol — near-miss detection (SC-8)', () => {
  it('a token-REORDER near-miss is suggested (the canonical useStreamChat -> useChatStream)', () => {
    // Plain edit-distance scores this far apart; sub-token normalization makes it a match.
    const out = suggestSymbol('how does useStreamChat work', [
      rc('useChatStream'),
      rc('parseConfig'),
    ])
    expect(out).toBe('useChatStream')
  })

  it('a one-character typo near-miss is suggested', () => {
    const out = suggestSymbol('what does estimateCst do', [rc('estimateCost'), rc('buildPrompt')])
    expect(out).toBe('estimateCost')
  })

  it('the EXACT symbol present in retrieval -> null (it was found; do not suggest)', () => {
    expect(
      suggestSymbol('where is useChatStream', [rc('useChatStream'), rc('parseConfig')]),
    ).toBeNull()
  })

  it('a far-miss (no close candidate) -> null', () => {
    expect(
      suggestSymbol('how does fetchProfileData work', [rc('useChatStream'), rc('parseConfig')]),
    ).toBeNull()
  })

  it('a prose query with no identifier-shaped token -> null', () => {
    expect(suggestSymbol('how does authentication work', [rc('useChatStream')])).toBeNull()
  })

  it('empty retrieval -> null', () => {
    expect(suggestSymbol('how does useStreamChat work', [])).toBeNull()
  })

  it('deterministic tie-break: equidistant candidates -> lexicographically smallest symbol', () => {
    const out = suggestSymbol('where is fooBar', [rc('fooBaz'), rc('fooBat')])
    expect(out).toBe('fooBat')
  })
})

// ── SC-9: refusalMessage enrichment (and its invariance) ────────────────────────
describe('refusalMessage — did-you-mean enrichment (SC-9)', () => {
  const CANNED =
    "I can't answer that from the provided code — the relevant context isn't in the index."

  it('no suggestion -> the canned text, byte-identical (no regression)', () => {
    expect(refusalMessage()).toBe(CANNED)
  })

  it('NON-VACUITY: the no-suggestion refusal MUST NOT contain "Did you mean"', () => {
    expect(refusalMessage()).not.toContain('Did you mean')
  })

  it('with a suggestion -> appends "Did you mean `X`?" with the backticked symbol', () => {
    const out = refusalMessage('useChatStream')
    expect(out.startsWith(CANNED)).toBe(true)
    expect(out).toContain('Did you mean `useChatStream`?')
  })
})
