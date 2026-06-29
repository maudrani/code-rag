# L1 Ingest + L2 Chunk

Deterministic front of the pipeline (ADR-001): walk a repo, parse with
tree-sitter, and emit one **`Chunk` per symbol** with a structural signal —
**before** any embedding or LLM runs. Owned by the `ingest-chunk` specialist.
Emits the `Chunk` contract (`src/contracts/chunk.ts`, ADR-002), consumed by
`retrieval` (ADR-003).

## Why this shape

For code, relations are **structural** (call-graph / imports), not semantic
(ADR-001). Two consequences drive every decision here:

1. **A symbol is the honest unit of a citation.** We chunk by symbol and never
   split a function mid-body — a citation must open a real unit of code.
2. **`structuralRefs` is a retrieval signal, not metadata.** It feeds the third
   RRF leg (ADR-003): chunks that are one-hop call / import neighbours of a
   query-matched symbol get fused in. So extraction is solid, not superficial.

## Layout

| File | Layer | Role |
|---|---|---|
| `../ingest/walker.ts` | L1 | safe recursive repo walk → file list (+ skips) |
| `../ingest/defaults.ts` | L1 | domain plug-in: extensions, ignore dirs, size cap |
| `parser.ts` | L2 | web-tree-sitter init + load grammar + `parse()` |
| `chunker.ts` | L2 | AST → `Chunk[]` (chunk-by-symbol) |
| `structural-refs.ts` | L2 | `{ calls, imports }` extraction |
| `id.ts` | L2 | stable id `path#symbol@start-end` |
| `index.ts` | L1+L2 | `ingestAndChunk(root)` — the composed entry |

## Public API

```ts
import { initParser, ingestAndChunk } from './chunk/index.js'

await initParser()                       // load runtime + TS grammar (once)
const { chunks, files, skipped } = ingestAndChunk('src')   // walk → parse → chunk
```

Also exported: `chunkSource` / `chunkTree` (single source), `parse`,
`buildImportTable` / `extractStructuralRefs`. `ingestAndChunk` is synchronous and
deterministic (sorted walk → stable ids); the master-owned membrane wraps it to
produce the contract `IngestReport` (filesIndexed / chunks / durationMs, spanning
L1→L3).

## L1 — ingest walker

Agnostic recursion + injected domain filter. Safe by construction: per-file size
cap (1 MB), binary sniff (NUL byte in first 8 KB), skips `node_modules` / `.git`
/ `dist` / … and `*.d.ts`, and **never follows symlinks** (loop + escape-root
guard). Output is repo-relative posix paths, sorted. Non-matching extensions are
not candidates (no noise); excluded candidates are reported in `skipped[]` with a
reason (`too-large` / `binary` / `declaration` / `read-error`).

## L2 — chunk by symbol

One chunk per top-level `function` / `class` (+ its `method`s) /
`interface`·`type`·`enum` (as `other`), plus a `module` chunk for contiguous
loose top-level code. Decisions (resolved against the real grammar):

- **export unwrap** — `export function f(){}` parses as an `export_statement`
  wrapping the declaration; we name the inner symbol but span the whole statement
  so the citation includes `export`.
- **overload signatures** — a body-less declaration is module glue, never an
  empty function chunk.
- **class + method overlap is intentional** — both granularities are useful to
  retrieval (class-level and method-level citations).
- **oversized symbols are kept whole** in M1 (windowed splitting is future work).

### structuralRefs `{ calls, imports }`

- **calls** — callee names in the body: direct `f()`, method `o.m()` (property
  name), `new C()`, every callee in a chain `a.b().c()`. De-duplicated, sorted.
- **imports** — module specifiers the chunk depends on: import / export-from
  statements it contains, dynamic `import()` / `require()` it runs, and the
  modules of any imported bindings it references (so a fn using `helper` →
  `./helper`). `require` / `import` are import edges, not calls.

## Fixtures

`tests/chunk/fixtures/chunks.fixture.json` is the committed `Chunk[]` the
`retrieval` specialist mocks against (stable contract). Regenerate after an
intentional chunker change:

```
UPDATE_FIXTURES=1 npx vitest run tests/chunk/fixtures.gen.test.ts && npx biome check --write tests/chunk
```

CI validates it against the chunker via parsed deep-equal (drift fails the test).

## Grammar (vendored)

`grammars/typescript.wasm` — prebuilt tree-sitter-typescript grammar (MIT),
language ABI 14, verified against `web-tree-sitter@0.24.7`. Vendored so
clone-and-run needs **no native build and no postinstall download** (ADR-003 /
ADR-006). sha256 `8515404dceed38e1ed86aa34b09fcf3379fff1b4ff9dd3967bcd6d1eb5ac3d8f`.

> Build note (surface/build owner): `tsc` does not copy `.wasm` to `dist/`. The
> package build must copy `src/chunk/grammars/*.wasm` (or resolve from the
> package root) so the shipped artifact loads the grammar.

## Minimal vs production (IP discipline — 0% proprietary)

Pattern extracted read-only from peripheral-hub's shipped codegraph (SCIP-style
identity, a two-pass 6-strategy cross-file resolver, 5-language extractors, 27k
symbols / 49k edges in production). M1 reimplements a **minimal, original**
slice: `path#symbol@span` identity, **one-hop** raw-name extraction, **TypeScript
only**. The production version is cited honestly in the README.

**M1 limits / next:** `.tsx` (needs the tsx grammar) and `.d.ts` are skipped;
no scope/shadow resolution (a local named like an import resolves to the import);
one-hop structural only (no transitive resolver); multi-language is the
production path. None affect the contract — they are documented scope-downs.
