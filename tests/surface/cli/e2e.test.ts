import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

  it('runs when invoked through a SYMLINK (npm link / global bin), not a silent no-op', () => {
    // `npm link` puts a symlink on PATH; process.argv[1] is that symlink while import.meta.url is
    // its realpath, so a naive `argv[1] === import.meta.url` direct-run guard NEVER fires — the
    // command exits 0 with ZERO output (worse than command-not-found). Regression for that guard:
    // the shipped `code-rag` binary IS invoked through such a symlink.
    const linkDir = mkdtempSync(join(tmpdir(), 'code-rag-linkbin-'))
    const link = join(linkDir, 'code-rag-link.ts')
    symlinkSync(cliEntry, link)
    try {
      const res = spawnSync(tsxBin, [link, '--help'], { cwd: repoRoot, encoding: 'utf8' })
      expect(res.status).toBe(0)
      expect(res.stdout).toMatch(/usage:/i) // MUST actually run — catches the 0-byte no-op
    } finally {
      rmSync(linkDir, { recursive: true, force: true })
    }
  }, 30000)

  it('stats --json on a one-shot process reports REAL non-null telemetry, no ONNX (TKT-449)', () => {
    // I-9: a fresh `code-rag stats` never built the index, so ingest/chunk/index were null. The
    // read-surfaces now build dense-off (no model download / no ONNX) and force the index, so the
    // $0 read returns real counts. NO ANTHROPIC_API_KEY — a telemetry read needs no key.
    const res = runCli(['stats', '--json'], {
      CORPUS_PATH: corpusDir,
      ANTHROPIC_API_KEY: undefined,
    })
    expect(res.status).toBe(0)
    const t = JSON.parse(res.stdout.trim()) as {
      index: { docs: number } | null
      chunk: { count: number } | null
    }
    expect(t.index).not.toBeNull() // was null (cold per-process telemetry)
    expect(t.index?.docs).toBeGreaterThan(0)
    expect(t.chunk?.count).toBeGreaterThan(0)
  }, 30000)
})
