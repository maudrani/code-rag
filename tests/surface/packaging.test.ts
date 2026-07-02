import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('.', import.meta.url)) // tests/surface/
const repoRoot = join(here, '..', '..')
const FIXTURE_CORPUS = join(here, 'cli', 'fixtures', 'corpus')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: { build: string }
  bin: Record<string, string>
}

// ── always-on config lock: the build MUST copy the wasm + the bin must be the compiled entry ──
describe('packaging: build script config lock (TKT-429 / SC-1, SC-3)', () => {
  it('the build compiles with tsc AND copies the tree-sitter grammar .wasm into dist', () => {
    expect(pkg.scripts.build).toContain('tsc')
    // the README-flagged gap: tsc does not copy .wasm — the build must.
    expect(pkg.scripts.build).toMatch(/grammars.*\.wasm/)
    expect(pkg.scripts.build).toContain('dist/src/chunk/grammars')
  })

  it('the bin points at the COMPILED entry (dist, not tsx/src)', () => {
    expect(pkg.bin['code-rag']).toBe('dist/src/cli/index.js')
    expect(pkg.bin['code-rag']).not.toContain('tsx')
    expect(pkg.bin['code-rag']).not.toMatch(/^src\//)
  })
})

// ── examples/mcp.json config lock: the product MCP must warm-start a sane corpus, not cold-start the repo ──
describe('examples/mcp.json — the product MCP ships a sane warm corpus (TKT-439 / I-7)', () => {
  const mcp = JSON.parse(readFileSync(join(repoRoot, 'examples', 'mcp.json'), 'utf8')) as {
    mcpServers: Record<string, { args: string[]; env: Record<string, string> }>
  }
  const server = mcp.mcpServers['code-rag']

  it('sets CORPUS_PATH + CODE_RAG_INDEX so a real MCP client warm-starts (not a whole-repo cold-start)', () => {
    expect(server).toBeDefined()
    // the bug this fixes: an unset/blank CORPUS_PATH or no warm index → the first tool call cold-embeds
    // the whole repo (minutes + heat). A sane scoped corpus + a persisted index keeps the first call fast.
    expect(server?.env.CORPUS_PATH?.trim()).toBeTruthy()
    expect(server?.env.CODE_RAG_INDEX?.trim()).toBeTruthy() // warm-restart (FTR-57)
  })

  it('runs the compiled dist bin (documents the `npm run build` prerequisite)', () => {
    expect(server?.args.join(' ')).toContain('dist/src/mcp/serve.js')
    expect(server?.args.join(' ')).not.toContain('tsx')
  })
})

// ── RUN_SLOW: prove the COMPILED dist actually runs (real build + spawn, no tsx) ──
const RUN_SLOW = process.env.RUN_SLOW === '1'
describe.skipIf(!RUN_SLOW)('packaging: the compiled dist runs without tsx (RUN_SLOW)', () => {
  it('npm run build -> the bin + grammar wasm land in dist -> `ask --dry` runs (no tsx, no key)', () => {
    const build = spawnSync('npm', ['run', 'build'], { cwd: repoRoot, encoding: 'utf8' })
    expect(build.status, build.stderr).toBe(0)

    // the compiled entry + the copied grammar are present in dist (the gap this closes)
    expect(existsSync(join(repoRoot, 'dist/src/cli/index.js'))).toBe(true)
    expect(existsSync(join(repoRoot, 'dist/src/mcp/serve.js'))).toBe(true)
    expect(existsSync(join(repoRoot, 'dist/src/chunk/grammars/typescript.wasm'))).toBe(true)

    // run the COMPILED bin over a small fixture corpus — no tsx, no API key
    const run = spawnSync(
      'node',
      ['dist/src/cli/index.js', 'ask', 'where is foo', '--dry', '--json'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, CORPUS_PATH: FIXTURE_CORPUS, ANTHROPIC_API_KEY: undefined },
      },
    )
    expect(run.status, run.stderr).toBe(0)
    const parsed = JSON.parse(run.stdout.trim()) as { queryId?: string }
    expect(parsed.queryId).toBeDefined() // the parser loaded the grammar from dist
  }, 180000)
})
