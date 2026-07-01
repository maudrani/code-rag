/**
 * COS_FLOOR — the corpus-tuned semantic grounding floor (FTR-55 Fase 3, RUN_SLOW).
 *
 * Sets + gates COS_FLOOR empirically (design §5, "do not guess") over the LIVE dense leg. The floor
 * is for the pure-NL RESCUE band: a semantically-strong query whose target IDENTIFIER is absent, that
 * the lexical floor would false-refuse. It must clear those AND stay below off-topic / gibberish.
 *
 * Measured (this corpus, MiniLM-q8, top-3 cosine):
 *   rescue (pure-NL, id absent): createOnnxEmbedder 0.300 · SqliteStore 0.456 · buildStructuralIndex 0.566
 *   off-topic: ≤0.153   gibberish: ≤0.233
 * COS_FLOOR = 0.27 sits in (0.233, 0.300). NOTE: raw cosine alone does NOT separate every gold from
 * gibberish — the exact-identifier gold (rrfFuse 0.257, structural 0.199) fall below the floor but are
 * lexically grounded; the lexical-OR-cosine gate separates them. Deterministic (fixed model + inputs).
 */
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { ingestAndChunk, initParser } from '../../src/chunk/index.js'
import type { Chunk } from '../../src/contracts/chunk.js'
import { buildIndexedStore } from '../../src/index/build.js'
import { createOnnxEmbedder } from '../../src/index/embed.js'
import { COS_FLOOR, topCosine } from '../../src/retrieve/grounding.js'
import { type RetrieveDeps, retrieve } from '../../src/retrieve/retrieve.js'

const RUN_SLOW = process.env.RUN_SLOW === '1'
const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url))

/** Pure-NL rescue queries: the target identifier is ABSENT — lexical would miss, cosine must rescue. */
const RESCUE = [
  'load a local model and turn text into a vector', // createOnnxEmbedder
  'keep search data in a single sqlite file', // SqliteStore
  'build a call graph and import graph from code', // buildStructuralIndex
]
const NOISE = [
  'how to bake sourdough bread at home',
  'what is the capital of France',
  'best exercises for lower back pain',
  'chocolate cake recipe with frosting',
  'asdf qwerty zxcv hjkl',
  'florb glorp nizzle wug',
]

describe.skipIf(!RUN_SLOW)(
  'COS_FLOOR — corpus-tuned semantic grounding floor (RUN_SLOW, live dense)',
  () => {
    let deps: RetrieveDeps
    beforeAll(async () => {
      await initParser()
      const chunks: Chunk[] = ingestAndChunk(SRC_ROOT).chunks
      deps = (await buildIndexedStore(chunks, { embedder: createOnnxEmbedder() })).deps
    }, 300_000)

    const topCosOf = async (q: string): Promise<number> =>
      topCosine(await retrieve(q, deps, { k: 10 }))

    it('a semantically-strong pure-NL query clears COS_FLOOR (the rescue the lexical floor would miss)', async () => {
      for (const q of RESCUE) {
        expect(await topCosOf(q), q).toBeGreaterThanOrEqual(COS_FLOOR)
      }
    }, 300_000)

    it('off-topic + gibberish stay strictly BELOW COS_FLOOR (no false semantic grounding)', async () => {
      for (const q of NOISE) {
        expect(await topCosOf(q), q).toBeLessThan(COS_FLOOR)
      }
    }, 300_000)

    it('COS_FLOOR sits strictly between the noise band and the rescue band (non-vacuous separation)', async () => {
      const rescueMin = Math.min(...(await Promise.all(RESCUE.map(topCosOf))))
      const noiseMax = Math.max(...(await Promise.all(NOISE.map(topCosOf))))
      // the floor is a REAL separator, derived from the distribution — not a value that trivially passes.
      expect(noiseMax).toBeLessThan(COS_FLOOR)
      expect(COS_FLOOR).toBeLessThanOrEqual(rescueMin)
      expect(noiseMax).toBeLessThan(rescueMin) // the bands are separable at all
    }, 300_000)
  },
)
