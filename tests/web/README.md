# Frontend tests live in `web/tests/`

The web UI (FTR-51) is a **standalone Vite + React + TS app** under `web/` with its
own `package.json` / `node_modules` / toolchain. Its tests are co-located at
**`web/tests/`** (and run via `cd web && npm test`), not here.

Why not this directory:

- The browser app resolves dependencies from `web/node_modules`; test files outside
  `web/` cannot resolve React / Testing Library.
- The repo-root `tsconfig.json` (`include: ["src/**", "tests/**"]`) and
  `vitest.config.ts` (`include: ["tests/**/*.test.ts"]`, **node** env) scan this
  directory. Browser/JSX test files here would break the Node-side `tsc` + `vitest`
  (a cross-timeline breakage of the master's CI).

`web/` is excluded from the root `tsconfig`, so the frontend toolchain is fully
isolated. **Coherence note for master:** consider dropping `tests/web/` from the
frontend ALLOCATIONS entry (the frontend owns `web/` end-to-end, tests included), or
keep this pointer.
