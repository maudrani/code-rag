import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Class-gate for TKT-447. The three SHIPPED entrypoints must all guard "run only when executed
 * directly" through the ONE realpath-safe helper (isDirectRun) — never a hand-rolled
 * `argv[1] === import.meta.url`, which silently no-op'd the npm-linked `code-rag` bin (exit 0, 0
 * bytes). This fails the moment any entrypoint (now or in future) reintroduces the raw form, so the
 * bug can't come back by word-of-mouth review — a deterministic test catches it.
 */
const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const ENTRYPOINTS = ['src/cli/index.ts', 'src/http/server.ts', 'src/mcp/serve.ts']

describe('entrypoint direct-run guards use the shared realpath-safe helper (TKT-447 class-gate)', () => {
  for (const rel of ENTRYPOINTS) {
    const src = readFileSync(join(repoRoot, rel), 'utf8')

    it(`${rel} calls isDirectRun(process.argv[1], import.meta.url)`, () => {
      expect(src).toContain('isDirectRun(process.argv[1], import.meta.url)')
    })

    it(`${rel} does NOT hand-roll the fragile raw guard (skipping realpath)`, () => {
      // the two raw forms that skip realpath — exactly what no-op'd through the symlink.
      expect(src).not.toMatch(
        /===\s*pathToFileURL\(\s*(?:invokedPath|process\.argv\[1\])\s*\)\.href/,
      )
      expect(src).not.toMatch(/process\.argv\[1\]\s*===\s*fileURLToPath\(import\.meta\.url\)/)
    })
  }
})
