import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * FTR-53 — onnxruntime-node exit-safety pin (the live-engine's clean-exit guarantee).
 *
 * onnxruntime-node <= ~1.21 aborts the HOST process on teardown on macOS
 * (`libc++abi: ... mutex lock failed`, exit 134) — onnxruntime#24579, fixed upstream by
 * PR#26445. `@huggingface/transformers` 3.8.1 pins onnxruntime-node to EXACTLY 1.21.0, so
 * package.json OVERRIDES it up to the fixed line. Without this, every short-lived live
 * process that loads the dense embedder (the CLI, scripts/dense-verify.ts) exits non-zero
 * AFTER printing a correct answer. Proven empirically: on 1.21 a live embed SIGABRTs (134)
 * even after `dispose()`; on 1.24.3 the same embed exits 0. This test locks the floor so a
 * careless downgrade can't silently reintroduce the crash (a config-level regression shield;
 * the live exit-0 behaviour itself is exercised by scripts/dense-verify.ts).
 */
const CLEAN_FLOOR = '1.24.3'

/** compare dotted numeric versions (major.minor.patch); prerelease/range prefixes stripped. */
function cmpSemver(a: string, b: string): number {
  const pa = a
    .replace(/^[^\d]*/, '')
    .split('.')
    .map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

describe('onnxruntime-node exit safety (FTR-53)', () => {
  it('pins onnxruntime-node at or above the macOS teardown-abort fix (>=1.24.3)', () => {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url))
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { overrides?: Record<string, string> }
    const pinned = pkg.overrides?.['onnxruntime-node']

    expect(pinned, 'package.json overrides must pin onnxruntime-node (FTR-53)').toBeTruthy()
    expect(
      cmpSemver(pinned as string, CLEAN_FLOOR) >= 0,
      `onnxruntime-node override "${pinned}" is below the clean floor ${CLEAN_FLOOR} — the macOS teardown SIGABRT (exit 134) returns (FTR-53)`,
    ).toBe(true)
  })
})
