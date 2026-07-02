import { describe, expect, it } from 'vitest'
import { CARD_SURFACE, OUTCOME_TONES } from '../src/lib/badgeTones'
import { assertContrastAA, contrastRatio, TOKENS } from './_ui-verify'

describe('UI-verify kit (TKT-525) — the deterministic leg of RULE-UI-001', () => {
  it('computes the WCAG contrast ratio (white/black is 21:1; bright fg on the dark panel clears AA)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrastRatio(TOKENS.fg, TOKENS.panel)).toBeGreaterThan(AA())
  })

  it('BITES: a muted-grey-on-grey pairing FAILS AA — the exact class the refused badge was (TKT-522)', () => {
    // muted foreground on a muted background: grey-on-grey, ~1.5:1 — illegible.
    expect(() => assertContrastAA('#8b949e', '#6e7681')).toThrow(/AA fail/)
    // and the current, brighter refused tone does NOT throw
    expect(() => assertContrastAA(OUTCOME_TONES.refused, CARD_SURFACE)).not.toThrow()
  })

  it('PROVES the approved registry: every ledger outcome tone meets AA on the card surface', () => {
    for (const [tone, hex] of Object.entries(OUTCOME_TONES)) {
      expect(
        contrastRatio(hex, CARD_SURFACE),
        `${tone} (${hex}) on ${CARD_SURFACE} must be >= AA`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('does NOT overclaim: the kit asserts the TOKEN, never the rendered pixel (defers to the operator)', () => {
    // documents the honest boundary — contrastRatio takes hex tokens, not a rendered element.
    expect(typeof contrastRatio).toBe('function')
    expect(contrastRatio(TOKENS.refuse, TOKENS.panel)).toBeGreaterThan(0)
  })
})

function AA(): number {
  return 4.5
}
