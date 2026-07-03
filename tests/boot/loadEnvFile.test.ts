import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadEnvFile } from '../../src/boot/loadEnvFile.js'

// The entrypoint .env loader — auto-loads a project-root .env so a stranger configures ONCE in a file.
// Fully offline (fs + strings): no engine, no ONNX. Every call injects a fresh env object (never
// process.env) so a test can't leak into another or pick up the repo's real .env.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'loadenv-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadEnvFile', () => {
  it('reads values from .env into the passed env object', () => {
    writeFileSync(join(dir, '.env'), 'ANTHROPIC_API_KEY=sk-123\nCORPUS_PATH=src\n')
    const env: NodeJS.ProcessEnv = {}
    const loaded = loadEnvFile({ startDir: dir, env })
    expect(loaded).toBe(join(dir, '.env'))
    expect(env.ANTHROPIC_API_KEY).toBe('sk-123')
    expect(env.CORPUS_PATH).toBe('src')
  })

  it('NEVER overrides an already-set var (real exports / compose win)', () => {
    writeFileSync(join(dir, '.env'), 'CORPUS_PATH=.\n')
    const env: NodeJS.ProcessEnv = { CORPUS_PATH: 'src/contracts' }
    loadEnvFile({ startDir: dir, env })
    expect(env.CORPUS_PATH).toBe('src/contracts') // the pre-set value stands
  })

  it('finds a .env in a PARENT dir when started from a nested subdir (upward walk)', () => {
    writeFileSync(join(dir, '.env'), 'CORPUS_PATH=root\n')
    const nested = join(dir, 'a', 'b')
    mkdirSync(nested, { recursive: true })
    const env: NodeJS.ProcessEnv = {}
    loadEnvFile({ startDir: nested, env })
    expect(env.CORPUS_PATH).toBe('root')
  })

  it('a missing .env returns undefined and mutates nothing', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(loadEnvFile({ startDir: dir, env })).toBeUndefined()
    expect(Object.keys(env)).toHaveLength(0)
  })

  it('parses comments, blanks, `export ` prefix, and quoted + CRLF values', () => {
    // CRLF (C7): a Windows-checked-out .env has trailing \r — trim() must strip it before parsing.
    writeFileSync(
      join(dir, '.env'),
      ['# a comment', '', 'export EXPORTED=yes', 'QUOTED="a b c"', "SINGLE='x'", 'CRLF=win\r'].join(
        '\n',
      ),
    )
    const env: NodeJS.ProcessEnv = {}
    loadEnvFile({ startDir: dir, env })
    expect(env.EXPORTED).toBe('yes')
    expect(env.QUOTED).toBe('a b c')
    expect(env.SINGLE).toBe('x')
    expect(env.CRLF).toBe('win') // no trailing \r
  })

  it('does NOT escape the repo: a .env ABOVE a .git ceiling is never loaded (C8)', () => {
    // .env sits at `dir`; a repo with its own .git sits at dir/repo. Running from dir/repo must NOT
    // walk up past the .git and load the outer .env (a stray $HOME/.env foot-gun).
    writeFileSync(join(dir, '.env'), 'CORPUS_PATH=OUTSIDE\n')
    const repo = join(dir, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const env: NodeJS.ProcessEnv = {}
    expect(loadEnvFile({ startDir: repo, env })).toBeUndefined()
    expect(env.CORPUS_PATH).toBeUndefined()
  })

  it('is a NO-OP under VITEST so a test/subprocess never picks up the real .env', () => {
    writeFileSync(join(dir, '.env'), 'ANTHROPIC_API_KEY=sk-real\n')
    const env: NodeJS.ProcessEnv = { VITEST: 'true' }
    expect(loadEnvFile({ startDir: dir, env })).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})
