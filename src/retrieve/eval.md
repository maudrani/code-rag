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

## Definition-boost gate (FTR-22) — "how does &lt;symbol&gt; work" recall@10

A second, symbol-chunk-granular gate (`tests/retrieve/definition-boost.eval.test.ts`) for the
reproduced gap: a "how does X work" question must retrieve X's own **body** chunk. The
definition-boost pins the resolved definition at structural rank 0 before RRF (it would otherwise
lose to its smaller deps + the BM25 length penalty). Offline tier (BM25 + structural), 8 gold
queries across kinds (function + class), each relevant = the symbol's body chunk:

| condition            | recall@10 | bodies in top-10 |
|----------------------|-----------|------------------|
| **with the pin**     | **1.000** | 8 / 8 (ranks 0–3) |
| without the pin      | 0.375     | 3 / 8 (5 drop OUT entirely) |

**The pin is load-bearing, not decorative:** remove it and 5 of 8 bodies fall out of top-10
(`buildStructuralIndex`, `rrfFuse`, `createOnnxEmbedder`, `structuralExpand`, `SqliteStore`), the
rest sinking to ranks 4–9. This is the **non-vacuity** property `demonstrate-deterministically`
requires: the gate fails by construction if the behaviour is removed. The 1.000 is held to a
committed byte-stable baseline (`fixtures/definition-boost.baseline.json`); a drop is a real
regression, NaN is a fail, and a gold target absent from the corpus errors (drift, not a silent 0).

**Why a pin AND a guaranteed slot (the eval drove the design).** The RRF pin alone is *not*
airtight: running the gate with the **real ONNX dense leg** (`RUN_SLOW`) showed the dense leg can
flood the top-k and push a pinned-but-otherwise-weak body back *out* (recall fell below 1). So the
pin earns the definition a high *rank* (0–3), and a final **guaranteed slot** rescues any resolved
definition that still falls past the cutoff — appending it at the tail, where its fused score is
lowest, so the `RetrievalResult` stays sorted desc by `fused` (no contract break). Two honest
layers: the pin decides the definition's **rank**, the slot decides its **inclusion**. A
deterministic test simulates the flood (a mock dense leg) so the guarantee is gated offline, not
only under `RUN_SLOW`.
