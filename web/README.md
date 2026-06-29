# web — code-rag UI (M1)

The browser UI for the code-doc RAG assistant: **streaming chat** with clickable `file:line`
**citations**, a live per-layer **trace panel**, and a deterministic **manual-search** tab.

It is a standalone **Vite + React + TypeScript** app. It consumes the **HTTP wire contract
(ADR-008)** only — it never imports the Node package (it's a browser). Types are sourced
**type-only** from `../src/contracts/*`, so the UI stays in exact sync with the contract.

## Run

```bash
cd web
npm install
npm run dev      # http://localhost:5173 — the whole UI against the in-repo mock wire
```

`npm run dev` serves the UI against a **mock dev-server** (`src/mocks/devServer.ts`, a Vite
plugin) that speaks the exact ADR-008 wire — so the UI runs end-to-end **without `surface`**
(`frontend ⊥ surface`). At M1 assembly, point it at the real server by setting the base URL:

```bash
VITE_API_BASE="http://localhost:3000" npm run dev    # the only swap point (src/lib/config.ts)
```

## The wire it consumes (ADR-008)

| Surface | Transport | Shape |
|---|---|---|
| Chat | `POST /query` → SSE | `meta` (WireProjection) → `token`×N (answer band only) → `done`. Refuse → `meta`+`done`, no tokens. |
| Manual search | `POST /search` → JSON | `WireProjection` (results + citations + decision, no answer). |
| Trace | `GET /ws/trace` → WS | `Event` (ADR-006), filtered client-side by `queryId`. |

## Scripts

| Script | What |
|---|---|
| `npm run dev` | Vite dev server + mock wire |
| `npm run build` | `vite build` (production bundle) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | `biome check .` |
| `npm test` | `vitest run` |
| `npm run ci` | lint + typecheck + test + build |

## CI

The web build is wired into CI by the **master** (the base CI in `.github/` is master-owned,
ADR-009). The `npm run ci` script above is the entry point a CI step runs from `web/`.

## Layout

```
web/
├── src/
│   ├── contract.ts        # type-only bridge to ../src/contracts (ADR-008 wire)
│   ├── lib/config.ts      # API_BASE — the M1-assembly swap point
│   ├── clients/           # sseClient + useChatStream, traceSocket + useTraceSocket, searchClient
│   ├── components/        # ChatView, MessageBubble, Composer, DecisionBadge, StatusPill,
│   │                      # Citations, SourceViewer, TracePanel, ResultsList, ManualSearchTab
│   ├── mocks/             # exact wire mock + Vite dev-server (dev only, never bundled)
│   ├── App.tsx            # shell: tabs (Chat | Manual search) + live trace rail
│   └── main.tsx
└── tests/                 # vitest + React Testing Library (behavior, not implementation)
```
