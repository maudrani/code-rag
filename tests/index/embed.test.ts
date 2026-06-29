/**
 * Local-ONNX embedder — whole-suite tests (ADR-003, TKT-204).
 *
 * The DETERMINISM that matters for fusion lives in the pure helpers (l2Normalize, the BLOB
 * codec) and the adapter's reshape/guard logic — all unit-tested model-free by INJECTING a fake
 * pipeline (the mentor's runtime-injection pattern: real ONNX is never loaded in the default suite,
 * per the "no real network/LLM in tests" rule). The real model load is a separate RUN_SLOW gate
 * (cold-start ~23-90MB download, excluded from the every-push suite — mentor TKT-412 §A.2).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createOnnxEmbedder,
  DEFAULT_EMBED_DIMENSION,
  DEFAULT_EMBED_MODEL,
  decodeVector,
  type EmbedTensor,
  encodeVector,
  type FeatureExtractionFn,
  l2Normalize,
} from '../../src/index/embed.js'

const RUN_SLOW = process.env.RUN_SLOW === '1'

/** A deterministic fake pipeline: maps each input text to a fixed vector, so embed() is testable
 *  with zero model download. Returns the transformers.js Tensor shape { data, dims }. */
function fakePipeline(
  table: Record<string, readonly number[]>,
  dim: number,
): { load: ReturnType<typeof vi.fn>; calls: { model: string; dtype: string }[] } {
  const calls: { model: string; dtype: string }[] = []
  const load = vi.fn(async (model: string, dtype: string): Promise<FeatureExtractionFn> => {
    calls.push({ model, dtype })
    return async (texts: readonly string[]): Promise<EmbedTensor> => {
      const data = new Float32Array(texts.length * dim)
      texts.forEach((t, i) => {
        const v = table[t] ?? new Array(dim).fill(0)
        data.set(v.slice(0, dim), i * dim)
      })
      return { data, dims: [texts.length, dim] }
    }
  })
  return { load, calls }
}

describe('l2Normalize', () => {
  it('returns a unit-length vector', () => {
    const out = l2Normalize(new Float32Array([3, 4]))
    expect(Math.hypot(out[0] ?? 0, out[1] ?? 0)).toBeCloseTo(1, 6)
    expect(out[0]).toBeCloseTo(0.6, 6)
    expect(out[1]).toBeCloseTo(0.8, 6)
  })

  it('maps the zero vector to zeros (no NaN)', () => {
    const out = l2Normalize(new Float32Array([0, 0, 0]))
    expect([...out]).toEqual([0, 0, 0])
    expect([...out].some(Number.isNaN)).toBe(false)
  })

  it('does not mutate its input', () => {
    const input = new Float32Array([3, 4])
    l2Normalize(input)
    expect([...input]).toEqual([3, 4])
  })
})

describe('encodeVector / decodeVector (BLOB codec for the L3 store, TKT-205)', () => {
  it('round-trips a Float32Array losslessly', () => {
    const vec = new Float32Array([0.1, -0.5, 0.333, 1, -1, 0])
    const restored = decodeVector(encodeVector(vec))
    expect([...restored]).toEqual([...vec]) // float32 write/read LE is exact
  })

  it('produces exactly dimension*4 bytes', () => {
    expect(encodeVector(new Float32Array(384)).byteLength).toBe(384 * 4)
  })

  it('decodes a Uint8Array view (not only a Buffer)', () => {
    const vec = new Float32Array([0.25, -0.75])
    const blob = encodeVector(vec)
    const asU8 = new Uint8Array(blob) // copy into a plain Uint8Array
    expect([...decodeVector(asU8)]).toEqual([...vec])
  })

  it('throws on a byte length that is not a multiple of 4', () => {
    expect(() => decodeVector(new Uint8Array([1, 2, 3]))).toThrow()
  })
})

describe('createOnnxEmbedder (injected pipeline — model-free)', () => {
  const table = { foo: [1, 0, 0], bar: [0, 1, 0], baz: [0, 0, 1] }

  it('embeds a batch into one Float32Array per input, of the configured dimension', async () => {
    const { load } = fakePipeline(table, 3)
    const embedder = createOnnxEmbedder({ dimension: 3, loadPipeline: load })
    const vecs = await embedder.embed(['foo', 'bar'])
    expect(vecs).toHaveLength(2)
    expect(vecs[0]).toBeInstanceOf(Float32Array)
    expect([...(vecs[0] ?? [])]).toEqual([1, 0, 0])
    expect([...(vecs[1] ?? [])]).toEqual([0, 1, 0])
    expect(embedder.dimension).toBe(3)
  })

  it('returns [] for empty input WITHOUT loading the model', async () => {
    const { load } = fakePipeline(table, 3)
    const embedder = createOnnxEmbedder({ dimension: 3, loadPipeline: load })
    expect(await embedder.embed([])).toEqual([])
    expect(load).not.toHaveBeenCalled()
  })

  it('loads the pipeline once and caches it across calls (cold-start amortised)', async () => {
    const { load } = fakePipeline(table, 3)
    const embedder = createOnnxEmbedder({ dimension: 3, loadPipeline: load })
    await embedder.embed(['foo'])
    await embedder.embed(['bar'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('passes the configured model + dtype to the loader', async () => {
    const { load, calls } = fakePipeline(table, 3)
    const embedder = createOnnxEmbedder({
      dimension: 3,
      model: 'Xenova/all-MiniLM-L6-v2',
      dtype: 'q8',
      loadPipeline: load,
    })
    await embedder.embed(['foo'])
    expect(calls[0]).toEqual({ model: 'Xenova/all-MiniLM-L6-v2', dtype: 'q8' })
  })

  it('throws an explicit error when the model returns the wrong dimension', async () => {
    const { load } = fakePipeline(table, 3) // pipeline emits dim 3
    const embedder = createOnnxEmbedder({ dimension: 384, loadPipeline: load }) // expects 384
    await expect(embedder.embed(['foo'])).rejects.toThrow(/dimension/i)
  })

  it('defaults to the verified-clean MiniLM model at 384 dimensions', () => {
    expect(DEFAULT_EMBED_MODEL).toBe('Xenova/all-MiniLM-L6-v2')
    expect(DEFAULT_EMBED_DIMENSION).toBe(384)
  })
})

// Real ONNX round-trip — gated (one-time model download). Run: RUN_SLOW=1 vitest run tests/index/embed.test.ts
describe.skipIf(!RUN_SLOW)('createOnnxEmbedder (real ONNX, RUN_SLOW)', () => {
  it('loads the default model and embeds code-aware semantics', async () => {
    const embedder = createOnnxEmbedder()
    const [code, related, unrelated] = await embedder.embed([
      'function authenticate(user, password) { return verifyToken(user) }',
      'how does authentication work',
      'matrix multiplication of two tensors',
    ])
    expect(code).toHaveLength(DEFAULT_EMBED_DIMENSION)
    expect(Math.hypot(...(code ?? []))).toBeCloseTo(1, 2) // normalised
    const cos = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0)
    expect(cos(code as Float32Array, related as Float32Array)).toBeGreaterThan(
      cos(code as Float32Array, unrelated as Float32Array),
    )
  }, 120_000)
})
