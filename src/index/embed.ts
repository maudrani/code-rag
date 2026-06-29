/**
 * Local-ONNX embedder — the semantic-leg encoder (ADR-003, TKT-204).
 *
 * Turns text into a dense vector via a LOCAL ONNX model (@huggingface/transformers, int8/`q8`),
 * mean-pooled + L2-normalised. Embeddings run offline ⇒ clone-and-run needs only the LLM key.
 *
 * Model pick (resolves FTR-21 GAP-3): the DEFAULT is the mentor's verified-clean transformers.js
 * build — `Xenova/all-MiniLM-L6-v2` (384-dim, Apache-2.0). It is right-sized for the DE-WEIGHTED
 * (0.4) dense leg and carries zero supply risk (some HF models have no Xenova ONNX export and 401 —
 * "verify which runs cleanly"). Code-specific upgrades are one config line: `jina-embeddings-v2-
 * base-code` (768-dim, code-trained — ADR-003's named candidate) → `voyage-code-3` (API) "when
 * dense matters more". Model + dtype are config, never baked in.
 *
 * Testability (mentor pattern): the heavy ONNX pipeline is loaded LAZILY behind an INJECTABLE
 * `loadPipeline`, so the deterministic logic here (reshape, dimension guard, the BLOB codec, the
 * pure normaliser) is unit-tested model-free; the real model load is a separate RUN_SLOW gate.
 */

/** Text → dense vector(s). Batched: embedding is amortised over many texts. */
export interface Embedder {
  /** the fixed output dimensionality (e.g. 384 for MiniLM, 768 for jina-v2-base-code). */
  readonly dimension: number
  /** embed a batch; returns one L2-normalised Float32Array per input (empty in ⇒ empty out). */
  embed(texts: readonly string[]): Promise<Float32Array[]>
}

/** transformers.js dtype (load-time precision). `q8` = int8 — the ADR-003 default (≤2% NDCG@10). */
export type EmbedDtype = 'fp32' | 'fp16' | 'q8' | 'q4'

/** ADR-003 default: the verified-clean, right-sized local build. */
export const DEFAULT_EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2'
export const DEFAULT_EMBED_DIMENSION = 384
export const DEFAULT_EMBED_DTYPE: EmbedDtype = 'q8'

/** Documented code-specific upgrade (config swap, not the default — see the module note). */
export const CODE_EMBED_MODEL = 'Xenova/jina-embeddings-v2-base-code'
export const CODE_EMBED_DIMENSION = 768

/** The transformers.js feature-extraction Tensor shape this adapter consumes. */
export interface EmbedTensor {
  data: Float32Array | number[]
  /** `[batch, dimension]` after mean-pooling. */
  dims: number[]
}

/** A pooled+normalised feature-extraction call (the slice of the pipeline this adapter uses). */
export type FeatureExtractionFn = (
  texts: readonly string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<EmbedTensor>

/** Loads (once) a feature-extraction pipeline for a model+dtype. Injectable for tests. */
export type PipelineLoader = (model: string, dtype: EmbedDtype) => Promise<FeatureExtractionFn>

export interface OnnxEmbedderConfig {
  /** HF model id (default: the verified MiniLM build). */
  model?: string
  /** load-time precision (default: `q8` int8). */
  dtype?: EmbedDtype
  /** expected output dimension; guarded against the model's actual output (default: 384). */
  dimension?: number
  /** pass `pooling:'mean', normalize` to the pipeline (default: true → unit vectors). */
  normalize?: boolean
  /** inject a fake pipeline in tests; defaults to the lazy @huggingface/transformers loader. */
  loadPipeline?: PipelineLoader
}

const TRANSFORMERS_PKG = '@huggingface/transformers'

/**
 * Default loader: lazily import @huggingface/transformers and build a feature-extraction pipeline.
 * The specifier is a variable so the heavy dep stays out of the module-load path (and the unit
 * suite, which always injects a fake, never resolves it).
 */
const defaultLoadPipeline: PipelineLoader = async (model, dtype) => {
  const specifier = TRANSFORMERS_PKG
  const mod = await import(specifier)
  const pipeline = mod.pipeline as (
    task: 'feature-extraction',
    model: string,
    opts: { dtype: EmbedDtype },
  ) => Promise<FeatureExtractionFn>
  const extractor = await pipeline('feature-extraction', model, { dtype })
  return (texts, opts) => extractor(texts, opts)
}

/**
 * Build an {@link Embedder} over a local ONNX model. The pipeline is loaded lazily and cached
 * (cold-start amortised once per process — excluded from warm latency, mentor TKT-412 §A.2).
 */
export function createOnnxEmbedder(config: OnnxEmbedderConfig = {}): Embedder {
  const model = config.model ?? DEFAULT_EMBED_MODEL
  const dtype = config.dtype ?? DEFAULT_EMBED_DTYPE
  const dimension = config.dimension ?? DEFAULT_EMBED_DIMENSION
  const normalize = config.normalize ?? true
  const load = config.loadPipeline ?? defaultLoadPipeline

  let pipe: Promise<FeatureExtractionFn> | undefined
  const ensurePipeline = (): Promise<FeatureExtractionFn> => {
    pipe ??= load(model, dtype)
    return pipe
  }

  return {
    dimension,
    async embed(texts) {
      if (texts.length === 0) return [] // no model call for an empty batch
      const extractor = await ensurePipeline()
      const out = await extractor(texts, { pooling: 'mean', normalize })
      const flat = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data)
      const rows = out.dims[0] ?? texts.length
      const dim = out.dims[1] ?? flat.length / rows
      if (dim !== dimension) {
        throw new Error(
          `Embedder dimension mismatch: model "${model}" returned ${dim}-dim vectors, expected ${dimension}.`,
        )
      }
      const vectors: Float32Array[] = []
      for (let i = 0; i < rows; i++) vectors.push(flat.slice(i * dim, (i + 1) * dim))
      return vectors
    },
  }
}

/** L2-normalise a vector to unit length. The all-zero vector maps to zeros (never NaN). */
export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0
  for (let i = 0; i < vec.length; i++) {
    const x = vec[i] ?? 0
    sumSq += x * x
  }
  const out = new Float32Array(vec.length)
  const norm = Math.sqrt(sumSq)
  if (norm === 0) return out
  for (let i = 0; i < vec.length; i++) out[i] = (vec[i] ?? 0) / norm
  return out
}

/**
 * Encode a vector to its BLOB form (little-endian float32) for the L3 SQLite store (TKT-205).
 * LE is forced so the on-disk bytes are platform-independent.
 */
export function encodeVector(vec: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4)
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i] ?? 0, i * 4)
  return buf
}

/** Decode a BLOB (little-endian float32) back to a Float32Array. Round-trips {@link encodeVector}. */
export function decodeVector(blob: Uint8Array): Float32Array {
  if (blob.byteLength % 4 !== 0) {
    throw new Error(`decodeVector: blob length ${blob.byteLength} is not a multiple of 4 bytes.`)
  }
  const buf = Buffer.isBuffer(blob)
    ? blob
    : Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength)
  const out = new Float32Array(blob.byteLength / 4)
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4)
  return out
}
