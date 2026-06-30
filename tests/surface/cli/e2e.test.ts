import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// A real subprocess e2e: run the actual CLI entry via tsx (a declared devDep),
// so node_modules resolves from the repo and we exercise the shipped wiring.
const here = fileURLToPath(new URL('.', import.meta.url)) // tests/surface/cli/
const repoRoot = join(here, '..', '..', '..')
const cliEntry = join(repoRoot, 'src', 'cli', 'index.ts')
const tsxBin = join(repoRoot, 'node_modules', '.bin', 'tsx')
const corpusDir = join(here, 'fixtures', 'corpus')

function runCli(args: string[], extraEnv: Record<string, string | undefined> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv }
  return spawnSync(tsxBin, [cliEntry, ...args], { cwd: repoRoot, encoding: 'utf8', env })
}

describe('CLI e2e (real subprocess via tsx) — TKT-412', () => {
  it('ask <q> --dry --json: exit 0 + DTO, with NO ANTHROPIC_API_KEY (the cost-story invariant)', () => {
    const res = runCli(['ask', 'greet', '--dry', '--json'], {
      CORPUS_PATH: corpusDir,
      ANTHROPIC_API_KEY: undefined, // unset — the dry path must not need a key
    })
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout.trim()) as Record<string, unknown>
    expect(parsed.queryId).toBeDefined()
    expect('context' in parsed).toBe(false)
  }, 30000)

  it('--version: exit 0 + semver on stdout', () => {
    const res = runCli(['--version'])
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  }, 30000)

  it('NEGATIVE: unknown command -> exit 2 (USAGE), message on stderr', () => {
    const res = runCli(['bogus'])
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/unknown command|usage/i)
  }, 30000)

  it('index.ts ships the node shebang as its first line', () => {
    expect(readFileSync(cliEntry, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true)
  })

  it('package.json#bin maps code-rag to the built CLI entry', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      bin?: Record<string, string>
    }
    expect(pkg.bin?.['code-rag']).toBe('dist/src/cli/index.js')
  })
})
