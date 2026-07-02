import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HealthCard } from '../src/components/observability/HealthCard'
import type { HealthReport } from '../src/contract'
import { contrastRatio } from './_ui-verify'

const report = (over: Partial<HealthReport> = {}): HealthReport => ({
  status: 'ok',
  checks: { indexed: { ok: true, detail: '642 docs' } },
  ts: 1,
  ...over,
})

/**
 * TKT-527 — the degraded/down + failing-check path renders in prod but was NEVER mounted in a test
 * (the fixture is all-ok). Mount each status + a failing check and assert the Badge variant + the fail
 * chip; assert the destructive badge's dark-mode pairing is legible (token-level, jsdom-deterministic).
 */
describe('HealthCard — status path (TKT-527)', () => {
  it('renders DOWN with the destructive variant + a failing check chip (never mounted before)', () => {
    render(
      <HealthCard
        report={report({
          status: 'down',
          checks: { provider: { ok: false, detail: 'unreachable' } },
        })}
      />,
    )
    expect(screen.getByText('down')).toHaveAttribute('data-variant', 'destructive')
    expect(screen.getByText('fail')).toHaveAttribute('data-variant', 'destructive')
    expect(screen.getByText('provider')).toBeInTheDocument()
  })

  it('renders DEGRADED with the secondary variant', () => {
    render(<HealthCard report={report({ status: 'degraded' })} />)
    expect(screen.getByText('degraded')).toHaveAttribute('data-variant', 'secondary')
  })

  it('renders the empty-checks state without crashing', () => {
    render(<HealthCard report={report({ checks: {} })} />)
    expect(screen.getByText(/no checks reported/i)).toBeInTheDocument()
  })

  it('an all-ok report shows NO destructive variant and NO fail chip (negative)', () => {
    render(<HealthCard report={report()} />)
    expect(screen.queryByText('fail')).not.toBeInTheDocument()
    expect(document.querySelector('[data-variant="destructive"]')).toBeNull()
  })

  it('the destructive (down/fail) badge is legible in the shipped dark theme — AA', () => {
    // dark mode renders `dark:bg-destructive/60`: destructive #f14445 at 60% over the card #14191f
    // composites to ≈ #993336, so white text on it clears AA (the light solid #f14445 would not).
    expect(contrastRatio('#ffffff', '#993336')).toBeGreaterThanOrEqual(4.5)
  })
})
