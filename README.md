# code-rag — a code documentation assistant

Conversational RAG over a codebase. Ask how the code works, where something is
implemented, what an endpoint does, what depends on what — and get an answer
**grounded in retrieved code, with clickable citations**, or an honest refusal when
the code doesn't support one.

Built for the NewPage FDE take-home (Option 2). The product name is a placeholder.

---

## The one idea: a determinism gradient

Most of a RAG system can be computed **exactly**. Walking the repo, chunking by
symbol, retrieval, ranking, building citations, deciding whether there's even enough
evidence to answer — none of that needs a language model, and all of it can be
unit-tested. So I pushed the LLM to be the **last and smallest** step: it writes the
final prose, from a context it cannot deviate from, and nothing else.

That gives a pipeline that runs left-to-right from fully deterministic to probabilistic:

```
   deterministic  ───────────────────────────────────────────▶  probabilistic
   L0          L1         L2         L3            L4          ·          L5
   resolve  →  ingest  →  chunk   →  index      →  retrieve →  project →  answer
   anaphora    walk       by-symbol  BM25+dense    hybrid      cite +     stream
   gate        the repo   tree-      +structural   RRF fusion  score-     (the ONLY
   (+rewrite)             sitter     (1 SQLite)    parallel    gate       LLM call)
```

Everything up to L5 is exact and tested (333 tests). **L5 is the only place a model
runs**, and even there a deterministic score-gate decides *whether* it runs at all and
*which* model. The payoff: answers are reproducible up to the generation step,
ungrounded questions are refused instead of hallucinated, and every query emits a
per-layer event trace you can watch.

---

## Architecture

**The membrane is the seam.** A single `createEngine()` composes the otherwise-pure
layers, holds the retrieval index in memory, and owns the cross-cutting concerns no
single layer should: it assembles the context + citations, mints the query id, runs
the event bus, and computes cost. The layers don't import each other — the membrane
wires them behind one `Projection` (the single source of truth for a query).

**Contracts-first.** Every layer is written against a shared set of TypeScript
contracts (`Chunk`, `RankedChunk`, `Projection`, `Provider`, `Event`). The contracts
*are* the test surface — layers are tested against behaviour and invariants, not each
other's internals — which is what let the layers be built in parallel and still
integrate cleanly.

**Consumer-agnostic.** That one `Projection` feeds every consumer unchanged: the Node
package (in-process), the HTTP/SSE server, and the browser UI — with MCP and a
`--dry` CLI designed to drop in behind the same projection (see *Productionize*).

**No orchestration framework, on purpose.** No LangChain / LlamaIndex. The gradient
*is* the orchestration — explicit, typed, and testable control flow. A framework would
have hidden the one thing this design is about.

```
src/
  contracts/   the SSOT types every layer builds against
  ingest/      L1 — deterministic repo walk
  chunk/       L2 — tree-sitter chunk-by-symbol + structural refs
  index/       L3 — BM25 (FTS5) · local-ONNX dense vectors · unified SQLite store
  retrieve/    L4 — hybrid RRF fusion + the gold-query eval harness
  answer/      score-gate · cost · prompt assembly · guardrails
  provider/    the Claude provider (streamed answer + anaphora rewrite)
  membrane/    createEngine — the master-owned seam that composes it all
  http/        the surface: SSE /query, JSON /search, WS /ws/trace
  bus/ package/ event bus + the package Consumer API
web/           standalone React UI (chat · citations · live trace · manual search)
```

---

## Retrieval — hybrid, and measured

Three legs run **in parallel** (not a cascade) and are fused with Reciprocal Rank
Fusion (`k=60`, code-tuned weights `bm25:0.6 / dense:0.4 / structural:0.3`):

- **BM25** (SQLite FTS5) — exact lexical match, with index-time identifier splitting
  (`getUserById` → `get user by id`) so partial-word queries land.
- **Dense** — local ONNX embeddings (`all-MiniLM-L6-v2`, int8), **run on-device** —
  there is no embedding API and no key for it.
- **Structural** — the call/import graph, expanded one hop from the lexical + dense
  seeds, so a strong hit pulls in its neighbours.

I measured it on the assistant's **own `src/`** (the repo documenting itself), with a
22-query gold set across four buckets:

| bucket   | recall@10 | what it probes                         |
|----------|-----------|----------------------------------------|
| keyword  | **1.00**  | exact identifier in the query          |
| mixed    | **0.80**  | identifier + natural language          |
| semantic | 0.20      | pure NL, identifier absent             |
| zero-id  | 0.00      | NL the lexical leg can't latch onto    |
| **overall** | **0.50** | (BM25 + structural *alone* = 0.273) |

**The dense leg lifts overall recall +83%** (0.273 → 0.50) and takes exact-identifier
search from 0.50 → **1.00** — the empirical case for parallel-not-cascade, each leg
recovering what the others miss. The common code-doc queries (identifier / identifier
+ NL) are where it's strong; **semantic 0.20 is the honest ceiling of a general-purpose
embedder**, and the documented one-line upgrade to `jina-embeddings-v2-base-code` is
exactly for raising it. The de-weighted (0.4) MiniLM default is right-sized for
clone-and-run reliability, not for pure NL↔code recall. Full table + reproduction:
[`src/retrieve/eval.md`](src/retrieve/eval.md).

---

## Answer, refuse, and cost — one deterministic gate

Before any model runs, a pure score-gate reads two signals:

- **Grounding** (lexical overlap — do the query's terms actually appear in the retrieved
  code?) → a `refuse` / `answer` band. If the code doesn't support an answer, the assistant
  **refuses** rather than invent one. (A real-corpus dogfood proved the RRF fused score is
  a poor grounding signal — rank-based, no calibrated magnitude — so the gate scores lexical
  overlap instead.)
- **Complexity** (distinct files + query intent) → a model **tier** (`cheap` haiku vs
  `strong` sonnet) — cost routing.

Only on `answer` does the provider stream tokens; the final `L5` event carries the
**real** token usage from the SDK and the estimated cost. Guardrails: a system policy
to answer only from the retrieved context, deterministic citations built from the
retrieval (with a post-check available), and the refuse path.

---

## Run it

The only key is `ANTHROPIC_API_KEY` — **embeddings run locally**. `query`, `search`,
and the trace work without it; streamed *answers* need it.

```bash
# 1. backend — HTTP server on :8787, self-indexes the repo on first request
npm install
ANTHROPIC_API_KEY=sk-... npm run serve

# 2. web UI — point it at the backend (the only wiring needed)
cd web && npm install
VITE_API_BASE=http://localhost:8787 npm run dev
```

Open the printed Vite URL: streaming chat with a grounding/cost badge, clickable
citations into a source viewer, a live L0→L5 trace rail, and a manual-search tab that
shows the per-leg scores. The whole pipeline is also usable in-process via the package
(`createEngine`).

---

## Engineering standards

- **TypeScript strict**, **Biome** (lint + format), **vitest** (TDD, red→green).
  **333 tests**; the critical paths — membrane, retrieval fusion, the score-gate, the
  guardrails, the wire — get edge + negative coverage.
- **CI** gates the backend (Biome + tsc + vitest) and the web build, on every push.
- **A commit pipeline built for AI-authored commits** (husky + commitlint + Biome on
  staged files): Conventional Commits with per-layer scopes, and a hard line on
  `--no-verify` — because the lesson from running coding agents at scale is that
  enforcement has to live *outside* the agent, with CI as the real backstop. The git
  history is the curated, attributed record.

---

## How I used AI tools

I built this with a **master / specialist multi-instance method**, not a single chat.
One *master* instance owned the architecture, the shared contracts, and the
integration seam (the membrane); five *specialist* instances each owned one layer and
built it **test-first against the contracts, in parallel**. The contracts were the
coordination surface — because everyone targets the same typed boundary, independent
work integrates without a big-bang merge. The master serialized every commit, so the
history stays a clean, attributed, per-layer narrative.

- **Do:** make the typed contract the single coordination point; force TDD so the
  determinism is *measured*, not asserted; keep humans/agents honest with a CI gate
  no one can `--no-verify` past; write the eval and read it honestly.
- **Don't:** let an orchestration framework hide the control flow; let an agent mark
  work "done" without a green slice; ship a number you didn't measure.

---

## Cost & productionize (the scale path)

- **Cost** is score-gated (refuse / cheap / strong) and metered per query via the L5
  event. A metered API key suits a self-hosted deploy; an MCP-subscription surface
  (designed, see below) suits an editor-embedded one.
- **Retrieval** scales brute-force cosine → `sqlite-vec` → `pgvector` / Qdrant without
  touching the membrane (the legs are injected).
- **Embeddings** upgrade MiniLM → `jina-v2-base-code` / Voyage-code-3 in one config line.
- **Surface** — the consumer-agnostic `Projection` means **MCP** (M2) and a **`--dry`
  CLI** (M3, full pipeline, zero LLM cost) drop in behind it; the HTTP path packages
  as a `dist` build + Docker (copying the tree-sitter grammar into `dist`).

---

## Limitations & what's next

- **`.tsx` deferred** — M1 indexes `.ts/.mts/.cts`; the chunker generalises to other
  tree-sitter grammars.
- **Semantic recall** is capped by the general embedder — the `jina-v2-base-code`
  upgrade is wired and one line away.
- **Structural eval is a floor** — the gold set targets symbol *definitions*, so it
  under-counts the structural leg's real value on "where is X used / how does this
  subsystem work" queries.
- **M2 MCP + M3 CLI** are designed against the projection but not built.
- **Grounding is lexical** — the next precision lever is a raw-cosine or cross-encoder
  **reranker** signal applied after fusion on the top-K (the dogfood showed RRF ranks
  can't ground).
- **Productionise the embedder out-of-process** — `onnxruntime-node` can abort the host
  process, so the local embedder belongs in a child process, not in-band.
- **FTS5 morphology** — Porter stemming so `upsert` / `upserted` match lexically.

## License

MIT.
