# Embedder choice — the dense semantic leg (ADR-003, TKT-204)

The dense leg turns text into a vector that brute-force cosine ranks against. It is the **de-weighted
leg** of the hybrid (RRF weight **0.4**, behind BM25 0.6 + structural 0.3): for code, exact
identifiers and the call/import graph dominate semantic similarity, so the dense leg is the
_semantic safety-net_ that catches NL-phrased / zero-BM25 queries — sized accordingly, not premium.

## Decision

| Knob | Value | Why |
|---|---|---|
| **Model (default)** | `Xenova/all-MiniLM-L6-v2` | Verified-clean transformers.js ONNX build (the mentor's local default); Apache-2.0; runs offline in-process. |
| **Dimension** | **384** | Right-sized for a de-weighted leg; 4 KB/vector at fp32, 384 B at int8 BLOB. |
| **Quantization (`dtype`)** | **`q8` (int8)** | ≤ 2% NDCG@10 vs fp32 (mentor TKT-412 bench: Δ = 0% / −1.18%); 4× smaller download + RAM. |
| **Pooling / norm** | mean-pool + L2-normalise | Sentence embedding; unit vectors so cosine = dot. |
| **Runtime** | `@huggingface/transformers` (v3, ONNX) | Local/offline ⇒ clone-and-run needs **only the LLM key**; zero embedding-API cost. |

**Verified (RUN_SLOW):** the default model loads via `@huggingface/transformers@3.8.1`, emits 384-dim
normalised vectors, and ranks a code snippet about auth closer to _"how does authentication work"_
than to _"matrix multiplication"_ — the dense leg does its job. See `tests/index/embed.test.ts`
(`RUN_SLOW=1`).

## Why not a code-specific model by default

ADR-003 names `jina-embeddings-v2-base-code` as a candidate, and code-trained embeddings would lift
the semantic leg. Two reasons the **default** is MiniLM, with code models as a one-line upgrade:

1. **Verifiability / clone-and-run (a scored criterion).** Not every HF model has a clean Xenova
   ONNX int8 export — the mentor's own reranker spike found `bge-reranker-v2-m3` `401`s under
   `Xenova/`. MiniLM is the proven build; "verify which runs cleanly" was the explicit steer.
2. **The dense leg is de-weighted (0.4).** Code-exactness is already carried by BM25 (0.6) + the
   structural leg (0.3). Over-investing the weakest leg is the wrong trade at M1.

The model + dtype are **config, never baked in** (`OnnxEmbedderConfig`), so the swap is one line.

## Upgrade path (productionize)

```ts
// Code-specific local (offline, Apache-2.0, 768-dim) — when the semantic-code leg must matter more:
createOnnxEmbedder({ model: CODE_EMBED_MODEL, dimension: CODE_EMBED_DIMENSION }) // jina-v2-base-code
// Premium managed (needs a key) — prose / NL-heavy corpora:
//   Voyage-code-3 (code, +13.8% vs OpenAI-3-large) · OpenAI text-embedding-3.
```

Storage scale path (also documented in ADR-003): **brute-force cosine → `sqlite-vec` → `pgvector`/
Qdrant**. Brute-force is O(n)/query — sub-ms at M1 (a few thousand vectors), the first thing to swap
at scale.

## Seam with the L3 store (TKT-205)

This ticket ships the **leg** (`src/retrieve/dense.ts` — cosine + ranking → `LegCandidate[]`) and the
**BLOB codec** (`encodeVector` / `decodeVector`, little-endian float32, lossless round-trip).
TKT-205 wires the codec into the file-backed SQLite store (vectors persisted as BLOB); the dense leg
reads the decoded vectors. The leg is injected into `retrieve()`'s `deps.dense` with **no wiring
change** (proven in `tests/retrieve/dense.test.ts`).
