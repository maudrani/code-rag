import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEngine } from '../../src/membrane/index.js'

/**
 * FTR-3 P1 (TKT-001) — the per-query ledger record carries the routing decision.
 *
 * The gate (score-gate) is the SSOT for band/tier/model; it runs in project() BEFORE the
 * ledger push, so the ledger entry mirrors `projection.decision.{tier,model}` rather than
 * re-deriving them (RULE-019). Dense is OFF under vitest, so these are deterministic.
 */
let corpus: string
afterEach(() => {
  if (corpus) rmSync(corpus, { recursive: true, force: true })
})

describe('membrane: QueryLogEntry carries the gate routing decision (FTR-3 P1)', () => {
  it('records tier + model on the ledger entry, equal to the gate decision (non-vacuous)', async () => {
    corpus = mkdtempSync(join(tmpdir(), 'qle-corpus-'))
    writeFileSync(
      join(corpus, 'greet.ts'),
      'export function greet(name: string): string {\n  return name\n}\n',
    )
    const engine = createEngine({ corpusPath: corpus })

    const projection = await engine.query('how does greet work', [], 'package')
    const [entry] = engine.queryLog()
    if (!entry) throw new Error('expected a ledger entry')
    // the ledger's routing fields mirror the gate decision (the SSOT), not a re-derivation.
    expect(entry.tier).toBe(projection.decision.tier)
    expect(entry.model).toBe(projection.decision.model)
    // non-vacuous: they are actually populated (a real tier + a real model id).
    expect(entry.tier).toBeDefined()
    expect(entry.model).toBeTruthy()
  })

  it('EDGE: a REFUSED query still records tier + model (the gate computes them regardless of band)', async () => {
    corpus = mkdtempSync(join(tmpdir(), 'qle-refuse-'))
    writeFileSync(join(corpus, 'greet.ts'), 'export function greet(): number {\n  return 1\n}\n')
    const engine = createEngine({ corpusPath: corpus })

    // no lexical overlap + dense OFF under vitest -> grounding 0 -> band refuse.
    const projection = await engine.query('xyzzy plugh frobnicate quux', [], 'package')
    const [entry] = engine.queryLog()
    if (!entry) throw new Error('expected a ledger entry')
    expect(entry.band).toBe('refuse')
    expect(entry.tier).toBe(projection.decision.tier)
    expect(entry.model).toBe(projection.decision.model)
    expect(entry.tier).toBeDefined()
  })
})
