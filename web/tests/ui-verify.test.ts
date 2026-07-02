import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARD_SURFACE, CONSUMER_TONES, OUTCOME_TONES, STATUS_TONES } from '../src/lib/badgeTones'
import { assertContrastAA, contrastRatio, TOKENS } from './_ui-verify'

/**
 * TKT-532 — a design token defined in two CSS files is a cascade-order bug: the effective color is
 * whichever file loads last, NOT necessarily the AA-proven value TKT-526 asserts. This source-scan
 * guard fails if any `--token:` is DEFINED in more than one web/src/*.css file (a token themed across
 * light/dark blocks of the SAME file is fine — that's not cross-file duplication).
 */
describe('design-token single source of truth (TKT-532)', () => {
  it('no design token is defined in more than one CSS file', () => {
    const files = ['src/styles.css', 'src/index.css']
    const filesByToken = new Map<string, Set<string>>()
    for (const file of files) {
      const css = readFileSync(join(process.cwd(), file), 'utf8')
      for (const match of css.matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
        const token = match[1]
        const set = filesByToken.get(token) ?? new Set<string>()
        set.add(file)
        filesByToken.set(token, set)
      }
    }
    const duplicated = [...filesByToken.entries()]
      .filter(([, fileSet]) => fileSet.size > 1)
      .map(([token, fileSet]) => `${token} → ${[...fileSet].join(' + ')}`)
    expect(duplicated, `tokens defined in >1 CSS file:\n${duplicated.join('\n')}`).toEqual([])
  })
})

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

  it('every consumer + StatusPill tone meets AA on the card surface (TKT-526 — incl. the fixed closed/offline)', () => {
    for (const [name, hex] of Object.entries({ ...CONSUMER_TONES, ...STATUS_TONES })) {
      expect(contrastRatio(hex, CARD_SURFACE), `${name} (${hex})`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('DecisionBadge band/tier tokens meet AA on the panel (TKT-526)', () => {
    for (const hex of [TOKENS.answer, TOKENS.refuse, TOKENS.strong, TOKENS.cheap]) {
      expect(contrastRatio(hex, TOKENS.panel)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the search kind-pill (secondary-foreground on secondary) + the mock-banner amber meet AA (TKT-526)', () => {
    // secondary tokens resolved from index.css oklch (secondary #1d222a, secondary-foreground #e7ecf0)
    expect(contrastRatio('#e7ecf0', '#1d222a')).toBeGreaterThanOrEqual(4.5)
    // MockDataBanner: amber-200 text over the (near-black) page background
    expect(contrastRatio('#fde68a', TOKENS.bg)).toBeGreaterThanOrEqual(4.5)
  })
})

function AA(): number {
  return 4.5
}
