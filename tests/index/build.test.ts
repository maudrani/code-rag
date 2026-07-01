/**
 * buildIndexedStore — the dense-enabled store/deps builder (FTR-22 dense-wiring).
 *
 * The live createEngine wired {bm25, structural, chunks} with NO dense leg (observability caught it:
 * live recall ~0.273 vs the eval's 0.50). The root footgun: you can index WITH an embedder but call
 * retrievalDeps() WITHOUT it (or vice-versa). buildIndexedStore threads ONE embedder through BOTH —
 * so dense is all-or-nothing, never half-wired.
 */
import { describe, expect, it } from 'vitest'
import type { Chunk } from '../../src/contracts/chunk.js'
import { buildIndexedStore } from '../../src/index/build.js'
import type { Embedder } from '../../src/index/embed.js'
import { retrieve } from '../../src/retrieve/retrieve.js'

const mk = (symbol: string, code: string, calls: string[] = []): Chunk => ({
  id: `src/${symbol}.ts#${symbol}@1-3`,
  path: `src/${symbol}.ts`,
  lang: 'ts',
  symbol,
  kind: 'function',
  span: { startLine: 1, endLine: 3 },
  code,
  structuralRefs: { calls, imports: [] },
})
const CHUNKS: Chunk[] = [
  mk('alpha', 'export function alpha() { return beta() }', ['beta']),
  mk('beta', 'export function beta() { return 1 }'),
  mk('gamma', 'export function gamma() { return alpha() }', ['alpha']),
]

/** A deterministic, model-free embedder (dim 4) — char-code buckets, L2-normalised. */
const mockEmbedder: Embedder = {
  dimension: 4,
  embed: async (texts) =>
    texts.map((t) => {
      const v = new Float32Array(4)
      for (let i = 0; i < t.length; i++) {
        const idx = i % 4
        v[idx] = (v[idx] ?? 0) + t.charCodeAt(i)
      }
      const norm = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0) || 1
      return v.map((x) => x / norm)
    }),
}

describe('buildIndexedStore', () => {
  it('without an embedder: BM25 + structural only, no dense leg, no stored vectors', async () => {
    const { store, deps } = await buildIndexedStore(CHUNKS)
    expect(deps.dense).toBeUndefined()
    expect(deps.bm25).toBeDefined()
    expect(deps.structural).toBeDefined()
    expect(store.count().chunks).toBe(CHUNKS.length)
    expect(store.vectors()).toHaveLength(0) // embedding column stayed NULL
    const r = await retrieve('alpha', deps)
    expect(r.length).toBeGreaterThan(0)
    store.close()
  })

  it('with an embedder: threads it through BOTH index() and retrievalDeps() — the dense leg is wired', async () => {
    const { store, deps } = await buildIndexedStore(CHUNKS, { embedder: mockEmbedder })
    expect(deps.dense).toBeDefined() // the leg the live createEngine was missing
    expect(store.vectors()).toHaveLength(CHUNKS.length) // chunk vectors actually stored
    const r = await retrieve('alpha', deps)
    expect(r.length).toBeGreaterThan(0)
    expect(r.some((x) => x.scores.dense > 0)).toBe(true) // the dense leg contributes to the fusion
    store.close()
  })

  it('forwards store options (defaults to in-memory) and returns a usable store handle', async () => {
    const { store } = await buildIndexedStore(CHUNKS, { store: { path: ':memory:' } })
    expect(store.count().chunks).toBe(CHUNKS.length)
    expect(store.journalMode()).toBeDefined()
    store.close()
  })
})
