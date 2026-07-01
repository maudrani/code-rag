import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEngine } from '../../src/membrane/index.js'

/**
 * FTR-4 TKT-004 — the clock test seam. EngineConfig.now lets a test inject a deterministic clock so the
 * observability record (ts, latencyMs, staleMs) is assertable. Default is Date.now (production unchanged).
 */
let corpus: string
afterEach(() => {
  if (corpus) rmSync(corpus, { recursive: true, force: true })
})

describe('membrane: EngineConfig.now clock seam (FTR-4 TKT-004)', () => {
  it('an injected clock makes the ledger ts + latencyMs deterministic (not wall time)', async () => {
    corpus = mkdtempSync(join(tmpdir(), 'seam-clock-'))
    writeFileSync(join(corpus, 'greet.ts'), 'export function greet(): number {\n  return 1\n}\n')
    const engine = createEngine({ corpusPath: corpus, now: () => 424242 })

    await engine.query('how does greet work', [], 'package')
    const [entry] = engine.queryLog()
    if (!entry) throw new Error('expected a ledger entry')

    expect(entry.ts).toBe(424242) // the injected clock, NOT Date.now() wall time
    expect(entry.latencyMs).toBe(0) // queryStart + stamp both read the same constant clock
  })
})
