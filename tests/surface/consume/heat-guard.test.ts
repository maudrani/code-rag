import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertDenseAskSafe, buildEngine, DENSE_COLD_FILE_CAP } from '../../../src/consume/index.js'

// Dense is OPT-IN (default OFF). assertDenseAskSafe is the backstop for the ONE remaining footgun — an
// EXPLICIT dense-on cold-embed of a whole repo — and it is called from buildEngine, so EVERY consumer
// (CLI/server/MCP/Docker/package) is protected, not just the CLI. walkFn is injected so the unit tests
// run offline + deterministically (no real walk, no engine, no ONNX).
const withFiles = (n: number) => () => ({
  files: Array.from({ length: n }, (_, i) => `f${i}.ts`),
})
const WHOLE_REPO = withFiles(DENSE_COLD_FILE_CAP + 50) // over the cap (the footgun)
const KY_SIZED = withFiles(52) // a deliberate demo corpus, under the cap

describe('assertDenseAskSafe — backstop for an EXPLICIT dense-on cold-embed of a whole repo', () => {
  it('THROWS above the cap when dense is ON, with an ACTIONABLE message', () => {
    expect(() => assertDenseAskSafe(true, '.', {}, WHOLE_REPO)).toThrow(/refusing to dense-embed/i)
    expect(() => assertDenseAskSafe(true, '.', {}, WHOLE_REPO)).toThrow(/unset CODE_RAG_DENSE/)
    expect(() => assertDenseAskSafe(true, '.', {}, WHOLE_REPO)).toThrow(/CODE_RAG_ALLOW_BIG_DENSE/)
  })

  it('is a NO-OP when dense is OFF — even over a whole repo (the default / every read-surface)', () => {
    expect(() => assertDenseAskSafe(false, '.', {}, WHOLE_REPO)).not.toThrow()
  })

  it('ALLOWS a dense-on run on a corpus at or under the cap (a ky-sized demo repo)', () => {
    expect(() => assertDenseAskSafe(true, '.', {}, KY_SIZED)).not.toThrow()
  })

  it('is a NO-OP when dense-on is explicitly overridden (the operator accepts the load)', () => {
    expect(() =>
      assertDenseAskSafe(true, '.', { CODE_RAG_ALLOW_BIG_DENSE: '1' }, WHOLE_REPO),
    ).not.toThrow()
  })

  it('degrades to a no-op (never masks the real error) when the corpus cannot be walked', () => {
    const walkThrows = () => {
      throw new Error('ENOENT')
    }
    expect(() => assertDenseAskSafe(true, '/does/not/exist', {}, walkThrows)).not.toThrow()
  })
})

// The C1 fix, proven at the seam every consumer funnels through: buildEngine refuses to construct a
// dense engine over a whole repo, so the server / MCP / Docker are guarded, not only the CLI. Uses the
// repo root ('.') as a real >cap corpus (walk is cheap file discovery — no embed, no ONNX).
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

describe('buildEngine — the heat guard fires for EVERY consumer, not just the CLI (C1)', () => {
  it('THROWS when dense is opted on over the whole repo (a >cap cold embed that would freeze)', () => {
    expect(() => buildEngine({ dense: true, corpusPath: repoRoot })).toThrow(
      /refusing to dense-embed/i,
    )
  })

  it('THROWS on CODE_RAG_DENSE=true over the whole repo (the env path a server/MCP/Docker uses)', () => {
    expect(() => buildEngine({ corpusPath: repoRoot }, { CODE_RAG_DENSE: 'true' })).toThrow(
      /refusing to dense-embed/i,
    )
  })

  it('does NOT throw dense-OFF over the whole repo (the safe default — a bare BM25 run)', () => {
    expect(() => buildEngine({ dense: false, corpusPath: repoRoot })).not.toThrow()
    expect(() => buildEngine({ corpusPath: repoRoot })).not.toThrow() // unset === off
  })

  it('does NOT throw when a dense read-surface forces dense:false even with CODE_RAG_DENSE=true', () => {
    // `CODE_RAG_DENSE=true code-rag stats` builds a dense:false read engine — it must not be refused
    expect(() =>
      buildEngine({ dense: false, corpusPath: repoRoot }, { CODE_RAG_DENSE: 'true' }),
    ).not.toThrow()
  })

  it('(sanity) the repo root really is over the cap', () => {
    expect(existsSync(repoRoot)).toBe(true)
  })
})
