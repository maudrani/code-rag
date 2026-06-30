/**
 * Definition-boost gate — the symbol-chunk-granular eval (FTR-22, TKT-208).
 *
 * The deterministic anti-vacuity gate for the pin (rule demonstrate-deterministically P4/P5). One
 * notch finer than peripheral's doc-granular eval: each gold target is the queried symbol's BODY
 * chunk id (chunk-by-symbol), and the question is the reproduced "how does <symbol> work" shape.
 *
 * Three asserted properties, over the REAL self-indexed src/ corpus (ADR-006, via ingestAndChunk),
 * offline tier (BM25 + structural — CI-safe, no model):
 *   1. GUARANTEE  — recall@10 === 1 for EVERY gold query WITH the pin (the body is in top-k).
 *   2. BASELINE   — that 1.0 meets the committed byte-stable baseline (assertNonRegression; NaN=fail).
 *   3. NON-VACUITY— WITHOUT the pin the body drops for >= 1 gold query, so the gate fails if the
 *                   behaviour is removed (it cannot pass vacuously). Measured: 5 of 8 drop entirely.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { ingestAndChunk, initParser } from '../../src/chunk/index.js'
import type { Chunk } from '../../src/contracts/chunk.js'
import { createOnnxEmbedder, type Embedder } from '../../src/index/embed.js'
import { SqliteStore } from '../../src/index/store.js'
import {
  assertNoCorpusDrift,
  assertNonRegression,
  type GoldCoverage,
  type RelevanceFn,
  recallAtK,
} from '../../src/retrieve/eval.js'
import { retrieve } from '../../src/retrieve/retrieve.js'

const RUN_SLOW = process.env.RUN_SLOW === '1'
const K = 10
const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url))
const BASELINE = JSON.parse(
  readFileSync(new URL('./fixtures/definition-boost.baseline.json', import.meta.url), 'utf8'),
) as { metrics: Record<string, number> }

/** A "how does <symbol> work" gold case; relevant = the symbol's BODY chunk (symbol-chunk granular). */
interface DefGold {
  symbol: string
  file: string
  kind: string
}
const GOLD: DefGold[] = [
  { symbol: 'buildStructuralIndex', file: 'structural.ts', kind: 'function' },
  { symbol: 'rrfFuse', file: 'fuse.ts', kind: 'function' },
  { symbol: 'cosineSimilarity', file: 'dense.ts', kind: 'function' },
  { symbol: 'createOnnxEmbedder', file: 'embed.ts', kind: 'function' },
  { symbol: 'structuralExpand', file: 'structural.ts', kind: 'function' },
  { symbol: 'SqliteStore', file: 'store.ts', kind: 'class' },
  { symbol: 'ingestAndChunk', file: 'index.ts', kind: 'function' },
  { symbol: 'extractQuerySymbols', file: 'symbols.ts', kind: 'function' },
]
const bodyOf =
  (g: DefGold): RelevanceFn =>
  (chunk) =>
    chunk.symbol === g.symbol && chunk.path.endsWith(g.file)
const queryFor = (g: DefGold): string => `how does ${g.symbol} work`

// ── gate helpers (pure units) ─────────────────────────────────────────────────
describe('eval gate helpers (FTR-22)', () => {
  it('assertNoCorpusDrift throws when a gold target matched nothing', () => {
    const ok: GoldCoverage[] = [{ label: 'rrfFuse', relevantTotal: 1 }]
    expect(() => assertNoCorpusDrift(ok)).not.toThrow()
    const drifted: GoldCoverage[] = [
      { label: 'rrfFuse', relevantTotal: 1 },
      { label: 'renamedAway', relevantTotal: 0 },
    ]
    expect(() => assertNoCorpusDrift(drifted)).toThrow(/corpus drift.*renamedAway/)
  })

  it('assertNonRegression passes when current >= baseline', () => {
    expect(() => assertNonRegression({ recall: 1 }, { recall: 1 })).not.toThrow()
    expect(() => assertNonRegression({ recall: 1 }, { recall: 0.8 })).not.toThrow()
  })

  it('assertNonRegression FAILS on a regression', () => {
    expect(() => assertNonRegression({ recall: 0.9 }, { recall: 1 })).toThrow(/regression.*recall/)
  })

  it('assertNonRegression treats NaN / absent as a FAIL (never a silent pass)', () => {
    expect(() => assertNonRegression({ recall: Number.NaN }, { recall: 1 })).toThrow(/NaN|fail/)
    expect(() => assertNonRegression({}, { recall: 1 })).toThrow(/NaN|fail|absent/)
  })
})

// ── the gate over the real self-indexed corpus ────────────────────────────────
describe('definition-boost gate — how does <symbol> work (self-indexed src/, offline)', () => {
  let chunks: Chunk[]
  let store: SqliteStore
  beforeAll(async () => {
    await initParser()
    chunks = ingestAndChunk(SRC_ROOT).chunks
    store = new SqliteStore()
    await store.index(chunks, {})
  })

  const coverage = (): GoldCoverage[] =>
    GOLD.map((g) => ({ label: g.symbol, relevantTotal: chunks.filter(bodyOf(g)).length }))

  /** recall@K per gold query, with the pin on or off. */
  const recalls = async (definitionPin: boolean): Promise<number[]> => {
    const deps = store.retrievalDeps()
    const out: number[] = []
    for (const g of GOLD) {
      const result = await retrieve(queryFor(g), deps, { k: K, definitionPin })
      out.push(recallAtK(result, bodyOf(g), K, chunks.filter(bodyOf(g)).length))
    }
    return out
  }

  it('gold set spans kinds and every target exists in the corpus (no drift)', () => {
    expect(GOLD.length).toBeGreaterThanOrEqual(6)
    expect(new Set(GOLD.map((g) => g.kind)).size).toBeGreaterThanOrEqual(2) // function + class
    expect(() => assertNoCorpusDrift(coverage())).not.toThrow()
  })

  it('GUARANTEE: recall@10 === 1 for every gold query WITH the pin; meets the committed baseline', async () => {
    const withPin = await recalls(true)
    for (const [i, r] of withPin.entries()) {
      expect(r, `${GOLD[i]?.symbol} body must be in top-${K}`).toBe(1)
    }
    const meanRecall = withPin.reduce((a, b) => a + b, 0) / withPin.length
    assertNonRegression({ recallAtK_withPin: meanRecall }, BASELINE.metrics) // the committed gate
    expect(meanRecall).toBe(1)
  })

  it('NON-VACUITY: WITHOUT the pin the body drops for >= 1 gold query (the gate is not vacuous)', async () => {
    const withPin = await recalls(true)
    const withoutPin = await recalls(false)
    const dropped = GOLD.filter((_, i) => withPin[i] === 1 && withoutPin[i] === 0)
    // remove the pin and the guarantee collapses — proof the pin is load-bearing, not decorative.
    expect(dropped.length).toBeGreaterThanOrEqual(1)
    const meanWith = withPin.reduce((a, b) => a + b, 0) / withPin.length
    const meanWithout = withoutPin.reduce((a, b) => a + b, 0) / withoutPin.length
    expect(meanWithout).toBeLessThan(meanWith)
    console.log(
      `[definition-boost] recall@${K} with pin=${meanWith.toFixed(3)} without=${meanWithout.toFixed(3)}; ${dropped.length}/${GOLD.length} bodies dropped without the pin`,
    )
  })

  describe.skipIf(!RUN_SLOW)('full tier (RUN_SLOW, real ONNX dense leg)', () => {
    it('the pin still guarantees recall@10 === 1 with the dense leg present', async () => {
      const embedder: Embedder = createOnnxEmbedder()
      const denseStore = new SqliteStore()
      await denseStore.index(chunks, { embedder })
      const deps = denseStore.retrievalDeps(embedder)
      for (const g of GOLD) {
        const result = await retrieve(queryFor(g), deps, { k: K })
        expect(recallAtK(result, bodyOf(g), K, chunks.filter(bodyOf(g)).length)).toBe(1)
      }
      denseStore.close()
    }, 300_000)
  })
})
