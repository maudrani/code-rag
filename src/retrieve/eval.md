# Retrieval eval — recall@10 / MRR / nDCG@10 (ADR-003, TKT-206)

A gold-query IR eval that scores `retrieve()`'s **ranking** alone (retrieval metrics kept separate
from generation). 22 gold queries across 4 buckets, run over the **real self-indexed `src/` corpus**
(the repo documents itself, ADR-006 — via ingest-chunk's `ingestAndChunk`). Reproduce:

```bash
npx vitest run tests/retrieve/eval.test.ts            # offline tier (BM25 + structural), CI-safe
RUN_SLOW=1 npx vitest run tests/retrieve/eval.test.ts # full tier (+ real ONNX dense leg)
```

## Results (self-indexed `src/`, k=10)

| bucket   | n  | recall@10 | MRR   | nDCG@10 | what it probes |
|----------|----|-----------|-------|---------|----------------|
| keyword  | 6  | **1.000** | 0.326 | 0.480   | exact identifier in the query |
| mixed    | 5  | **0.800** | 0.362 | 0.464   | identifier + natural language |
| semantic | 5  | 0.200     | 0.067 | 0.100   | pure NL, identifier absent |
| zero-id  | 6  | 0.000     | 0.000 | 0.000   | NL the BM25 leg can't latch onto |
| **overall** | 22 | **0.500** | 0.186 | 0.259 | |

**BM25 + structural only (no dense): overall recall@10 = 0.273.** The dense leg lifts overall recall
**+83% (0.273 → 0.500)** and takes exact-identifier search from 0.50 → **1.00** — the empirical case
for **parallel-not-cascade** (each leg recovers what the others miss).

## Reading the numbers (honest findings)

- **keyword 1.00 / mixed 0.80** — BM25 (exact) + dense (the target is a strong semantic hit too →
  a 2-leg hit) nail identifier and identifier+NL queries. This **validated the M1 seeding decision**
  (structural seeds = BM25 ∪ dense top-N ∪ exact symbol-match): dropping BM25 seeding only helped the
  degraded no-dense mode and *slightly hurt* the shipped one — measured, then kept.
- **zero-id 0.00** — the **general-purpose MiniLM ceiling on NL↔code**: a query like _"how close in
  direction are two numeric arrays"_ does not align (in MiniLM's space) with the `cosineSimilarity`
  function body. This is exactly the documented trade-off ([embedder.md](../index/embedder.md)) and
  the quantified case for the **`jina-embeddings-v2-base-code` upgrade** (one config line) when the
  semantic-code leg must matter more — the de-weighted (0.4) MiniLM default is right-sized for
  clone-and-run, not for pure NL↔code recall.
- The eval is **deterministic** (deterministic ingest + retrieve + embedder) — the numbers are a
  regression guard, not a one-off. The harness (`eval.ts`) is reusable: point it at any corpus +
  gold set.

> Caveat: the gold set targets symbol **definitions** (so structural expansion is, for this set,
> noise rather than signal — it shines on "where is X used / how does X's subsystem work" queries,
> which a definition-recall metric doesn't capture). The numbers are a floor for the structural leg's
> real value.
