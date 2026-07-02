/**
 * UI-verification kit (TKT-525) — the DETERMINISTIC leg of RULE-UI-001, split honestly by what jsdom
 * CAN prove. jsdom + testing-library do NOT compute rendered color or geometry — that is exactly why
 * the TKT-522 contrast bug and the TKT-524 bottom-glue bug were invisible to the test suite. So this
 * kit asserts only what IS deterministic:
 *
 *   1. TOKEN contrast — the WCAG ratio computed from the design-token HEX values (not the rendered
 *      pixels); pins a fg/bg token PAIRING to AA. Pixel-truth stays operator-manual (RULE-UI-001).
 *   2. STRUCTURE — an element is a descendant of its intended pane (in-context), NOT appended at
 *      document end (the exact TKT-524 shape); a section carries its required padding class.
 *   3. data-testid — a stable selector helper (e2e-testing skill: never select by text/CSS).
 *
 * It deliberately does NOT claim to verify pixel contrast — no false confidence.
 */

/** The plain-CSS design tokens (web/src/styles.css :root) — the pinned hexes the assertions use. */
export const TOKENS = {
  bg: '#0d1117',
  panel: '#161b22',
  panel2: '#1c2230',
  border: '#2b3240',
  fg: '#e6edf3',
  muted: '#8b949e',
  primary: '#4493f8',
  answer: '#2ea043',
  refuse: '#d29922',
  strong: '#a371f7',
  cheap: '#57a6ff',
} as const

export const AA_NORMAL = 4.5
export const AA_LARGE = 3

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ]
}

/** sRGB channel → linear (WCAG 2.x). */
function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** WCAG 2.x contrast ratio (1..21) between two hex colours (order-independent). */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/** Throw if a fg/bg token pairing does not meet WCAG AA (4.5 normal text / 3 large). */
export function assertContrastAA(fg: string, bg: string, opts: { large?: boolean } = {}): void {
  const min = opts.large ? AA_LARGE : AA_NORMAL
  const ratio = contrastRatio(fg, bg)
  if (ratio < min) {
    throw new Error(`WCAG AA fail: contrast ${ratio.toFixed(2)}:1 < ${min}:1 for ${fg} on ${bg}`)
  }
}

/**
 * Assert an element renders INSIDE the given pane (by data-testid) — i.e. in-context — rather than
 * detached/appended at document end (the TKT-524 bug). Returns the pane for further assertions.
 */
export function assertWithinPane(el: Element, paneTestId: string): Element {
  const pane = el.closest(`[data-testid="${paneTestId}"]`)
  if (!pane) {
    throw new Error(
      `element is not within [data-testid="${paneTestId}"] — is it appended at document end instead of in-pane?`,
    )
  }
  return pane
}

/**
 * Assert a scrolling view root carries a bottom-gutter (a `pb-*` class), so its last card/row does not
 * glue to the viewport bottom (the TKT-524 cross-view check). jsdom can't measure geometry, but it CAN
 * see the class that provides the gutter — the honest deterministic proxy.
 */
export function assertHasBottomGutter(el: Element): void {
  if (!/\bpb-\d/.test(el.className)) {
    throw new Error(
      `element has no bottom-gutter (pb-*) class — its last content may glue to the viewport bottom`,
    )
  }
}

/**
 * Assert an element is the SCROLL OWNER of its pane (TKT-524/530): it scrolls internally instead of
 * growing the page. In a flex column that needs BOTH `overflow-y-auto` AND `min-h-0` — without min-h-0
 * a flex item's implicit `min-height:auto` refuses to shrink below content, so nothing scrolls and the
 * entries overflow/clip to nothing (the exact Live-feed bug). jsdom can't measure the scroll, but it
 * CAN see the two classes that establish it.
 */
export function assertIsScrollOwner(el: Element): void {
  const cls = el.className
  if (!/\boverflow-y-auto\b|\boverflow-auto\b/.test(cls)) {
    throw new Error('element is not a scroll owner — no overflow-y-auto/overflow-auto class')
  }
  if (!/\bmin-h-0\b/.test(cls)) {
    throw new Error(
      "element can't scroll in a flex column — missing min-h-0 (the flex item won't shrink below content, so it overflows/clips)",
    )
  }
}

/** Assert an element declares a minimum height (`min-h-*`, not `min-h-0`), so it stays legible. */
export function assertHasMinHeight(el: Element): void {
  if (!/\bmin-h-(?!0\b)/.test(el.className)) {
    throw new Error('element has no min-height (min-h-*) floor — it can collapse/clip to nothing')
  }
}
