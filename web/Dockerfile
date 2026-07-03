# The web UI image — so `docker compose up --build` builds the frontend IN-IMAGE (no manual
# `npm --prefix web run build` first). Build CONTEXT is the repo ROOT so the root .dockerignore
# (which strips web/node_modules + web/dist) keeps the host's platform-specific esbuild/vite
# binaries out — `npm ci` fetches the correct linux binary inside the image.

# ── build: Vite -> static web/dist (pure JS bundling, no ONNX, heat-free) ──
FROM node:20-slim AS build
WORKDIR /web

# VITE_API_BASE is baked into the bundle at build time (web/src/lib/config.ts). Default to the server's
# host-published port: the browser runs on the HOST, so it must reach http://localhost:8787 (NOT the
# compose-internal `server` hostname). The permissive CORS on the API already allows the cross-origin call.
ARG VITE_API_BASE=http://localhost:8787
ENV VITE_API_BASE=$VITE_API_BASE

# Layer caching: manifests first, then the source.
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ── runtime: nginx serves the static bundle ──
FROM nginx:alpine AS runtime
COPY --from=build /web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
