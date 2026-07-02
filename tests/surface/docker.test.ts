import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// A config-lock over the Docker packaging: `docker build`/`compose up` need Docker (not in the CI
// sandbox — it's the manual verification_command), so this guards the STRUCTURE that makes the image
// correct (the class of regression a reviewer at 3am would want caught: alpine, root, wrong CMD, a
// missing native/wasm copy).
const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (f: string): string => readFileSync(join(repoRoot, f), 'utf8')

describe('Dockerfile — multi-stage, glibc, non-root (TKT-430 / SC-2)', () => {
  const dockerfile = read('Dockerfile')

  it('is multi-stage on node:20-slim — NOT alpine (musl breaks the onnxruntime/sqlite prebuilds)', () => {
    expect(dockerfile).toMatch(/FROM node:20-slim AS build/)
    expect(dockerfile).toMatch(/FROM node:20-slim AS runtime/)
    // no stage uses an alpine BASE (the comment may explain why not — check FROM lines only)
    expect(dockerfile).not.toMatch(/^FROM\s+\S*alpine/m)
  })

  it('builds the dist and ships dist + prod node_modules to the runtime stage', () => {
    expect(dockerfile).toContain('npm run build') // tsc + the grammar-wasm copy (TKT-429)
    expect(dockerfile).toMatch(/COPY --from=build[^\n]*\/app\/dist/)
    expect(dockerfile).toMatch(/COPY --from=build[^\n]*\/app\/node_modules/)
    expect(dockerfile).toContain('npm prune --omit=dev') // devDeps out; native prod binaries kept
  })

  it('runs as the non-root node user, with a healthcheck, and starts the server', () => {
    expect(dockerfile).toContain('USER node')
    expect(dockerfile).toContain('HEALTHCHECK')
    expect(dockerfile).toContain('/health')
    expect(dockerfile).toContain('"dist/src/http/server.js"') // the compiled entry (no tsx)
  })
})

describe('docker-compose.yml — server (+ web) with the env contract (TKT-430 / SC-2)', () => {
  const compose = read('docker-compose.yml')

  it('brings up the server on 8787 with the three env vars', () => {
    expect(compose).toMatch(/server:/)
    expect(compose).toMatch(/8787:8787/)
    expect(compose).toContain('ANTHROPIC_API_KEY')
    expect(compose).toContain('CORPUS_PATH')
    expect(compose).toContain('CODE_RAG_LEDGER')
  })

  it('serves the web static + persists the shared ledger', () => {
    expect(compose).toMatch(/web:/)
    expect(compose).toContain('web/dist')
    expect(compose).toMatch(/ledger:/) // a named volume for the cross-consumer ledger
  })

  it('persists the warm-restart index (FTR-57) via CODE_RAG_INDEX + a named volume', () => {
    // the demo-snappy leg: a second run re-embeds only changed files; the index must survive restarts.
    expect(compose).toContain('CODE_RAG_INDEX')
    expect(compose).toMatch(/index:/) // a named volume for the warm-restart index (like ledger:)
  })

  it('defaults CORPUS_PATH to the mounted repo — a REAL corpus, not a toy subset (TKT-438 / I-1)', () => {
    // ${CORPUS_PATH:-./} → the whole repo by default; the demo must not silently index a 9-file subset.
    expect(compose).toMatch(/\$\{CORPUS_PATH:-\.\/?\}:\/corpus/)
    expect(compose).toContain('CORPUS_PATH=/corpus') // the container indexes the mounted root
  })

  it('wires a git-repo source: CODE_RAG_REPO + a private-repo token (FTR-5 / TKT-445)', () => {
    expect(compose).toContain('CODE_RAG_REPO') // index a repo URL instead of the mounted corpus
    expect(compose).toContain('CODE_RAG_GITHUB_TOKEN') // optional private-repo auth
  })
})

describe('.dockerignore keeps the context small', () => {
  const dockerignore = read('.dockerignore')
  it('excludes node_modules, the frontend deps, the trinity workspace, and git', () => {
    for (const p of ['node_modules', 'web/node_modules', '_workspace', '.git']) {
      expect(dockerignore).toContain(p)
    }
  })
})
