# UI verification — the RULE-UI-001 done-gate (frontend)

RULE-UI-001 (HARD) says: **a ticket with visual/UI changes cannot close without before/after
verification + explicit operator confirmation.** This exists because jsdom + testing-library — the
web's real test mechanism — **cannot compute rendered color or geometry**, so contrast and layout bugs
pass CI green. (That is exactly how the muted-on-muted badge and the bottom-glued code preview shipped.)

We split verification honestly by what each mechanism CAN prove:

## 1. Deterministic leg — CI (`web/tests/_ui-verify.ts`)

jsdom CAN assert: **token-level contrast**, **structure/position**, and **stable selectors**. So every
visual change ships with a regression that lives here:

- **Contrast** — `assertContrastAA(fgHex, bgHex)` computes the WCAG ratio from the design-token HEX
  values. A band/label must use an **AA-approved token** from `web/src/lib/badgeTones.ts` (proven in
  `web/tests/ui-verify.test.ts`). CI turns RED if a tone drops below AA. It pins the token+background
  **pairing**, not a free color. **It does NOT claim to verify the rendered pixel** — no false confidence.
- **Structure** — `assertWithinPane(el, testid)` proves an element renders *in-context* (inside its
  pane) rather than appended at document end (the bottom-glue shape).
- **Selectors** — interactive/asserted elements expose a stable `data-testid` (e2e-testing skill: never
  select by text/CSS). Add the id, centralize renames.

## 2. Human leg — operator manual pixel check (browser automation is blocked)

The pixel truth — *is the label actually legible? does the split-pane actually sit side-by-side? is
anything glued to the bottom at this viewport?* — is **operator-manual** here, because the browser
automation env is down (`compositor_no_frames`). A visual ticket's done-report MUST include:

- [ ] **BEFORE**: what was wrong (the operator's review note, or a screenshot if the env is restored).
- [ ] **AFTER**: the change, described concretely (which token/layout), for the operator to eyeball at
      `npm run dev`.
- [ ] **States** tested where relevant: hover, expand/collapse, empty, error, scroll (top/middle/bottom).
- [ ] **Viewports** if responsive: mobile 375 / tablet 768 / desktop 1280.
- [ ] **Operator confirmation** — explicit "yes, the pixels are right, close it." **The specialist does
      not self-close a visual ticket** (and under Fork A never commits) — master serializes after the
      operator confirms.

## Checklist to paste into a visual ticket's done-report

```
RULE-UI-001 verification
- CI (deterministic): assertContrastAA / assertWithinPane / data-testid green — <test refs>
- BEFORE: <the bug>
- AFTER: <the fix, concretely — token / layout>
- States: <hover / expand / empty / scroll …>
- Viewports: <n/a | 375 / 768 / 1280>
- Operator pixel-confirm: PENDING  ← ticket cannot close until this is "confirmed"
```
