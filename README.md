# code-rag — Code Documentation Assistant

> Conversational RAG over a codebase: ask how the code works, where functionality
> is implemented, endpoints, dependencies — grounded in retrieved code with
> clickable citations. NewPage FDE take-home.
>
> **This README is a scaffold.** The final version is synthesized at the end of the
> build, in the candidate's own voice (not LLM output) — from the architecture
> decisions and the running system.

## Quick start

```bash
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY — the only key needed (embeddings run locally)
npm run dev              # HTTP chat (surface wires the server)
# CLI dry run (full pipeline, no LLM, no cost):  npm run cli -- --dry "where is auth handled?"
```

## To synthesize (final README sections)

- **Architecture** — the deterministic gradient + layer map (L0→L5 + membrane)
- **RAG/LLM decisions** — chunking (by symbol) · embedding (local ONNX, de-weighted leg) · LLM selection (pluggable, score-gated) · vector store (SQLite + FTS5 + cosine) · retrieval (hybrid RRF, k=60, code-weights) · orchestration framework (**none, deliberately** — the gradient is the orchestration) · prompt & context management · guardrails (answer-only-from-context, cite, refuse) · quality · observability (per-layer event stream)
- **Cost** — score-gated routing (refuse / cheap / strong); metered API vs MCP-subscription
- **Productionize** on a hyperscaler (the scale path: brute-force cosine → sqlite-vec → pgvector/Qdrant; Docker)
- **Key technical decisions + why**
- **Engineering standards** followed (Biome + strict tsc + vitest TDD + CI) and skipped
- **How I used AI tools** — the master/specialist methodology, repeatable, do's & don'ts
- **What I'd do next**

## License

TBD
