import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * FTR-4 TKT-006 — run-it smoke. Guards the out-of-box run path (operator I-7: `code-rag` was
 * "command not found" and examples/mcp.json cold-started the WHOLE repo). The config check always
 * runs; the built-bin check runs when dist exists (the CI run-it step builds first; locally after
 * `pnpm build`). The CI step (.github/workflows/ci.yml) builds + runs the bin so a broken bin fails CI.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const BIN = join(ROOT, 'dist/src/cli/index.js')

describe('run-it smoke (FTR-4 TKT-006)', () => {
  it('examples/mcp.json ships a scoped CORPUS_PATH + a warm index (no whole-repo cold-start)', () => {
    const raw = readFileSync(join(ROOT, 'examples/mcp.json'), 'utf8')
    expect(raw).toContain('CORPUS_PATH') // scoped -> the first MCP call does not cold-start the whole repo
    expect(raw).toContain('CODE_RAG_INDEX') // warm-restart
  })

  it.runIf(existsSync(BIN))('the built code-rag bin prints usage on --help (exit 0)', () => {
    const out = execFileSync('node', [BIN, '--help'], { encoding: 'utf8' })
    expect(out).toContain('usage:')
    expect(out).toContain('code-rag ask')
  })
})
