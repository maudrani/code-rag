import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Unmount React trees between tests so DOM state never leaks (testing-frontend).
afterEach(() => {
  cleanup()
})

// Recharts' ResponsiveContainer (used by shadcn's ChartContainer in the Observability tab, FTR-56)
// needs ResizeObserver, which jsdom does not implement. A no-op stub lets the chart mount without
// throwing; ChartContainer's `initialDimension` gives it a real size. Tests assert the numeric TEXT,
// never the SVG geometry, so this stub never affects an assertion — it only prevents a mount crash.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
