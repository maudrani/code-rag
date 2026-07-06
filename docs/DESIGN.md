# Design decisions

The entire design starts on the system that I use to develop software with AI assistance (coding agents). And my method is to use a Master/Specialists/Executor strategy, where:
  - Master instance is the one that has direct contact to the user in both vague and technichal way, helping taking macro desicions, creating documentations and more. 
  - A Specialist is an instance that has 100% technichal knowledge in an area that will require major focus, like "Retrieval strategy" for example, or "Embeddings". The idea is to limit the scope of an instance to something that will scale, following the single responsability principle, and eventually if the scope of a scpecialist grows too much, that specialist takes a Master position on its scope and creates its owns specialists. 
  - The Executor is a lower model (sonnet in this case) that is in charge of just materialize plans/code to preserve the context of the most reasoning capable models.
  - And inside the strategy, there are enforcing procedures that will ensure a much better code/software quality based on non by-passable gates (deterministic gates) that the agents must follow in order to go to the next task. Like forcing a CI with coverage or really strict scenarios. Forcing TDD with adversing tests in order to find gaps and secure the code (it's also a way to design code based on non deterministic approaches, start with a declarative strategy like writing the tests and then validate with code).

The idea was to reuse and recycle not just the data, but the processes. Like I said on the video, the "Deterministic Gradient" creates layers with metrics, and each specialists refines the layers their scope needs and they work/observe around them. So it's not just about building code for the software's solution, but also on the software's maintainment.

The Deterministic Gradient method:
  *Peal the intent into many layers that performs deterministic tasks, until the intent is the smallest substract that will only require a probabilistic (reasoning/judgement/thinking) process to solve it.*

---

## Why this design

I've picked the code-doc assistant since it's one of the most useful kind of software in an AI/agentic era. And many devs doesn't know how to approach a RAG system, they threat them more like a black box, rather than a workflow of deterministic processes, where the LLM only appears in the last step, giving the reasoning enrichment that you need.
For convenience, the pipeline ended up having 6 layers: Resolve, Ingest, Chunk, Index, Retrieve and Answer (the one with the LLM), that the Master instance helped me to design before we started implementing. And building agnostically on each one of them helped us to secure them with as testing as we wanted, which are around 900. And the good side of having the processes controlled is that features like the score-gate (the one that decides which model to use, or refuses the query) where really easy to add.  

---

## Architecture

The layer architecture can also be pictured like a DAG, centralizing the idea of a Contract-first node. This helps a lot into building every layer in parallel and integrate all of them without a big-bang merge. 
The result is the "createEngine()" function, that composes everything, holding the index, giving the query an id, runs the event bus, computes the cost, etc. This creates an agnostic strategy that results a single source of truth that can work for every needed consumer (see in depth in the src/membrane/createEngine).

---

## Decisions

Every software solution using AI/LLMs in todays world is focused on try to have as much contact with the LLMs in the different processes. But I think that having the control on every step gives us the most advantage, and that's not an "AI approach", but a good software development practice. And good software works great with AI/probabilistic processes. And structuring them is where the advantage starts emerging, for example:

| Component | Chose | Considered | Why |
|---|---|---|---|
| **Chunking** (L2) | tree-sitter, by symbol | recursive / fixed-size / char-window | keeps functions & classes intact, preserves boundaries, feeds the structural (call/import) leg |
| **Embeddings** (L3/L4) | MiniLM int8, on-device (ONNX) | OpenAI, Voyage, Jina-code, CodeBERT | plug-and-play, offline, $0, deterministic; the dense leg is **+83% recall** and exact-identifier **×2**; jina-code upgrade is one config line |
| **LLM** (L5) | Claude, tiered (haiku ⁄ sonnet) | always-strong, other providers | cost follows difficulty — cheap on trivial, strong on complex, **refuse** when ungrounded |
| **Vector store** | SQLite (FTS5 + in-mem cosine) | Pinecone, pgvector, Qdrant, Chroma | zero infra, one file, fits the corpus; scale path without touching the membrane |
| **Retrieval** (L4) | hybrid RRF, 3 legs in parallel | BM25-only, cascade / rerank-first | each leg recovers what the others miss (+83% over BM25+structural alone) |
| **Orchestration** | none — the typed gradient | LangChain, LlamaIndex | a framework would hide the control flow this whole design is about |

---

## Prompt, guardrails, quality & observability

The blueprint on the LLM prompt is really simple since the magic happens on the content/context that reaches the LLM. Since it only sees the already mechanically retrieved content, it'll not hallucinate/deviate over it. Then the query plugs in based on all the already retrieved context, looking all the substract semantically effitient. 
The quality of the answer relys on the quality of the context, and the quality of the context relys on the deterministic layers, and the deterministic layers are completely observed and trackable since they're that = deterministic/mechanical. Giving also the chance to add the guardrails mechanically driven to refuse or route based on the calculated grounding value.

---

## Engineering standards — kept, and skipped

**Kept:** TypeScript strict · Biome (lint + format) · vitest TDD (~900 tests, edge + negative on the critical paths) · CI gates backend + web on every push · a commit pipeline no agent can `--no-verify` past.

**Skipped (on purpose, for the time box):**
- No auth / rate-limiting / multi-tenancy.
- E2E in CI is a smoke only (no browser E2E).
- Index is single-node, in-memory by default (persistence is opt-in).
- `.tsx` chunking deferred (`.ts/.mts/.cts` only).
- No metrics export (Prometheus / OTel) — observability is in-app.

Despite the list, one of the biggest architectural advantages of the layering, is that they can grow horizontally in order to scale/include as much standars/features as we want. Not breaking the architecture, but enhancing it.

---

## Productionizing it (AWS / GCP / Azure / Cloudflare)

The engine is already stateless and containerised. So productionizing is mostly two moves: pick a container host, and push out the state that today lives in-process.

- **Compute.** The server is one stateless container -> Cloud Run / ECS Fargate / Azure Container Apps (autoscale on RPS, scale-to-zero when idle). The web is a static Vite build -> a CDN / object store: S3 + CloudFront, Cloudflare Pages, or served behind the same gateway.
- **State.** Two things live in-process today and would move out: the retrieval index -> a managed vector DB (`pgvector` on RDS / Cloud SQL, or Qdrant / Pinecone) — the legs are injected, so this never touches the membrane; and the query ledger -> Postgres / object storage (or a log pipeline) instead of a local JSONL file.
- **Indexing.** The cold dense-embed becomes an offline build/index job (re-index on repo change, persist the artifact), so no request ever pays for embedding and the engine boots warm.
- **Secrets & config.** `ANTHROPIC_API_KEY` via Secrets Manager / Secret Manager / Cloudflare KV; everything else is already env-driven.
- **Observability.** The L0->L5 event trace + the ledger ship to a real backend (OpenTelemetry -> CloudWatch / Datadog) — the per-layer telemetry that runs locally becomes the production dashboard.
- **Cost.** A metered API key for a self-hosted deploy; or ship the built MCP server as the surface for an editor-embedded deploy, where an agent runs `search` / `ask` on its own subscription at no per-call API cost.

---

## What I'd do differently / add next
- Caching first strategy should have been a good axis on taking a lot of the desicions, but it can be applied naturally to the already existing structure
- Swap MiniLM -> `jina-embeddings-v2-base-code` (raise semantic recall past the ~0.20 ceiling).
- A cross-encoder reranker after fusion on the top-K (the remaining precision lever).
- Wire index-persistence into the server's lazy self-index (the CLI already warm-restarts).
- `.tsx` + more tree-sitter grammars.
