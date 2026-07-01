import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AnswerChunk, Provider } from '../../src/contracts/index.js'
import { createEngine } from '../../src/membrane/index.js'

/**
 * FTR-4 TKT-003 — the provider test seam. EngineConfig.provider lets a test inject a deterministic
 * fake Provider, so the FULL query -> answer flow is E2E-testable through L5 with NO network + NO key.
 * This is the prerequisite for the deterministic E2E smoke (TKT-602).
 */
function fakeProvider(text: string): Provider {
  return {
    async *answer(): AsyncIterable<AnswerChunk> {
      yield { type: 'token', text }
      yield { type: 'usage', inputTokens: 12, outputTokens: 8 } // deterministic -> tokens 20
    },
    async rewrite(q: string): Promise<string> {
      return q // identity: no anaphora residue in the test
    },
  }
}

let corpus: string
afterEach(() => {
  if (corpus) rmSync(corpus, { recursive: true, force: true })
})

describe('membrane: EngineConfig.provider test seam (FTR-4 TKT-003)', () => {
  it('an injected fake Provider drives a deterministic answer + tokens/estCost (no network, no key)', async () => {
    corpus = mkdtempSync(join(tmpdir(), 'seam-provider-'))
    writeFileSync(
      join(corpus, 'greet.ts'),
      'export function greet(name: string): string {\n  return name\n}\n',
    )
    const engine = createEngine({
      corpusPath: corpus,
      provider: fakeProvider('greet returns its name'),
    })

    const projection = await engine.query('how does greet work', [], 'package')
    expect(projection.decision.band).toBe('answer') // grounded -> answers via the injected provider

    let streamed = ''
    for await (const chunk of engine.answer(projection, [])) {
      if (chunk.type === 'token') streamed += chunk.text
    }
    expect(streamed).toBe('greet returns its name') // the FAKE provider, deterministically (no key/network)

    // the enriched ledger (FTR-3 P2) carries the L5 outcome from the fake, deterministically.
    const [entry] = engine.queryLog()
    if (!entry) throw new Error('expected a ledger entry')
    expect(entry.answered).toBe(true)
    expect(entry.tokens).toBe(20) // 12 + 8
    expect(entry.estCost).toBeGreaterThan(0)
  })
})
