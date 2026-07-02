import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
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

/** every .ts under a dir — the discovery gate walks all of src/, not a hardcoded list. */
function walkTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walkTs(p))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

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

  it('DISCOVERY: no src/ file touches process.argv[1] outside the shared isDirectRun guard', () => {
    // Future-proofs the class beyond the hardcoded list above: a NEW entrypoint that reads
    // process.argv[1] without the realpath-safe helper is caught here automatically. mainModule.ts
    // is the guard's DEFINITION (it documents process.argv[1] in prose), so it is exempt.
    const guardHelper = join('src', 'consume', 'mainModule.ts')
    const offenders: string[] = []
    for (const file of walkTs(join(repoRoot, 'src'))) {
      const rel = relative(repoRoot, file)
      if (rel === guardHelper) continue
      const src = readFileSync(file, 'utf8')
      if (!src.includes('process.argv[1]')) continue
      const withoutGuard = src.replaceAll('isDirectRun(process.argv[1], import.meta.url)', '')
      if (withoutGuard.includes('process.argv[1]')) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
