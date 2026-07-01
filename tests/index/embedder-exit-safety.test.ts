/**
 * createOnnxEmbedder — host-exit safety (FTR-22, the live complement to master's config-floor shield).
 *
 * master's tests/membrane/onnxruntime-exit-safety.test.ts asserts the CONFIG floor (package.json pins
 * onnxruntime-node ≥1.24.3). This is the BEHAVIORAL twin: fork a REAL embed + dispose + teardown and
 * assert the host process exits 0 — never the libc++abi abort (SIGABRT / exit 134) that 1.21 raised at
 * native teardown (#24579). "The version is pinned" ≠ "the process actually exits clean"
 * (demonstrate-deterministically: assert the boundary, not the config). RUN_SLOW-gated (real model).
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const RUN_SLOW = process.env.RUN_SLOW === '1'

describe.skipIf(!RUN_SLOW)('createOnnxEmbedder — host-exit safety (RUN_SLOW, real model)', () => {
  it('a real embed + dispose + teardown exits the host cleanly (exit 0, never SIGABRT/134)', () => {
    const probe = fileURLToPath(new URL('./fixtures/embed-exit-probe.ts', import.meta.url))
    const res = spawnSync('npx', ['tsx', probe], { encoding: 'utf8', timeout: 300_000 })
    // The 1.21 regression surfaced as a native libc++abi abort at process teardown.
    expect(res.error).toBeUndefined() // did not fail to spawn / time out
    expect(res.stdout).toContain('EMBED_OK') // the model actually ran (not a silent early exit)
    expect(res.signal).toBeNull() // NOT killed by SIGABRT
    expect(res.status).toBe(0) // clean host exit — the ≥1.24.3 floor holds behaviourally
  }, 300_000)
})
