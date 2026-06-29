/**
 * Dense semantic leg — brute-force cosine over local-ONNX embeddings (ADR-003, TKT-204).
 *
 * The de-weighted (0.4) RRF leg: embed the query once, score every stored chunk vector by cosine,
 * return the top-`limit` best-first. At M1 scale (one repo, a few thousand vectors) brute-force is
 * sub-millisecond and needs zero native extension (ADR-003); the scale path (sqlite-vec → pgvector)
 * is documented, not built. The vector collection is injected — in-memory here, BLOB-backed by the
 * L3 store (TKT-205) later; both feed the SAME `cosineSimilarity`.
 *
 * Implements {@link LexicalLeg} so it drops into `retrieve()`'s `deps.dense` with no wiring change.
 */
import type { Embedder } from '../index/embed.js'
import type { LegCandidate } from './fuse.js'
import type { LexicalLeg } from './retrieve.js'

/** A stored chunk vector. (The L3 store decodes its BLOB to the Float32Array, TKT-205.) */
export interface VectorEntry {
  chunkId: string
  vector: Float32Array
}

export interface DenseLegConfig {
  /** encodes the query into the same space as the stored vectors. */
  embedder: Embedder
  /** the corpus vectors to rank (in-memory at M1; BLOB-backed via TKT-205). */
  vectors: readonly VectorEntry[]
}

/** The dense leg: an async {@link LexicalLeg} returning cosine-ranked candidates. */
export interface DenseLeg extends LexicalLeg {
  search(query: string, limit: number): Promise<LegCandidate[]>
}

/**
 * Cosine similarity of two equal-length vectors, in [-1, 1]. Throws on a dimension mismatch (a
 * silent wrong ranking is worse than a loud failure). An all-zero vector yields 0, never NaN.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dimension mismatch ${a.length} vs ${b.length}.`)
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / Math.sqrt(normA * normB)
}

/**
 * Build the dense leg over an injected vector collection. `search(query, limit)` embeds the query,
 * scores every stored vector by cosine, and returns the top-`limit` best-first with a deterministic
 * tie-break (chunkId ascending) for reproducible citations.
 */
export function createDenseLeg(config: DenseLegConfig): DenseLeg {
  const { embedder, vectors } = config
  return {
    async search(query, limit) {
      if (query.trim() === '' || vectors.length === 0 || limit <= 0) return []
      const [queryVector] = await embedder.embed([query])
      if (queryVector === undefined) return []
      const scored: LegCandidate[] = vectors.map((entry) => ({
        chunkId: entry.chunkId,
        score: cosineSimilarity(queryVector, entry.vector),
      }))
      scored.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
      return scored.slice(0, limit)
    },
  }
}
