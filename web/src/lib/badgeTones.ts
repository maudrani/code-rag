/**
 * Ledger/outcome badge tones (TKT-522) — bright design-token foregrounds, each PROVEN to meet WCAG AA
 * on the card surface (web/tests/ui-verify.test.ts computes the contrast). Shared by LiveListenerTab
 * (render) and the UI-verify kit (regression) so the AA-approved pairing is a SINGLE source of truth:
 * a badge that drops below AA fails CI at the token level (the deterministic leg of RULE-UI-001).
 *
 * The badges are transparent (coloured text on the card), so contrast is the tone vs CARD_SURFACE.
 * The earlier `refused` badge used muted-foreground on a muted background (grey-on-grey) → illegible;
 * these bright hues fix it and stay distinct (blue / green / amber).
 */
export const CARD_SURFACE = '#161b22' // --panel (the row/card background the badges sit on)

export const OUTCOME_TONES = {
  /** an LLM answered — the model badge (--primary blue). */
  model: '#4493f8',
  /** a search-only query, no LLM invoked (GitHub-dark green). */
  deterministic: '#3fb950',
  /** the gate refused — $0 (--refuse amber). */
  refused: '#d29922',
} as const

export type OutcomeTone = keyof typeof OUTCOME_TONES
