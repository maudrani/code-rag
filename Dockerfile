# syntax=docker/dockerfile:1
#
# code-rag — multi-stage image (adopts the docker-node skill: multi-stage, non-root, healthcheck,
# layer caching, pinned base). ADAPTED: base is node:20-slim (Debian / glibc), NOT alpine —
# onnxruntime-node + better-sqlite3 ship glibc prebuilds; musl (alpine) would fail to load the
# native binaries at runtime. Packaging only, no behaviour change (FTR-58).

# ── build: install all deps, compile the dist (tsc + the grammar-wasm copy), prune to prod ──
FROM node:20-slim AS build
WORKDIR /app

# Build toolchain — a fallback for any native dep lacking a prebuild for the target arch.
# (better-sqlite3 / onnxruntime-node normally ship prebuilds, so this is belt-and-suspenders.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Layer caching: the dependency manifests change less often than src, so copy + install first.
COPY package.json package-lock.json ./
RUN npm ci

# Compile: tsc -> dist, then the build copies src/chunk/grammars/*.wasm -> dist (TKT-429, the
# README-flagged gap). tsconfig includes tests/**, but only src is present so tsc emits dist/src.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop devDeps (tsx / tsc / vitest); the prod native binaries (onnxruntime, sqlite) are kept.
RUN npm prune --omit=dev

# ── runtime: slim image — the compiled dist + prod node_modules only, run as non-root ──
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# The official node image ships a non-root `node` user (uid 1000) — run as it (docker-node: non-root).
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node

EXPOSE 8787

# Readiness: GET /health returns 200 (ok/degraded) or 503 (down). Node 20 ships a global fetch.
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The clone-and-run HTTP server (ADR-008). CORPUS_PATH / ANTHROPIC_API_KEY / CODE_RAG_LEDGER via env.
CMD ["node", "dist/src/http/server.js"]
