import { describe, expect, it } from 'vitest'
import { assertDenseAskSafe, DENSE_COLD_FILE_CAP } from '../../../src/consume/index.js'

// Dense is OPT-IN (default OFF). The heat guard is the backstop for the ONE remaining footgun: an
// EXPLICIT CODE_RAG_DENSE=true that then cold-embeds a whole repo and freezes the machine. walkFn is
// injected so these run offline + deterministically (no real fs walk, no engine, no ONNX).
const withFiles = (n: number) => () => ({
  files: Array.from({ length: n }, (_, i) => `f${i}.ts`),
})
const WHOLE_REPO = withFiles(DENSE_COLD_FILE_CAP + 50) // over the cap (the footgun)
const KY_SIZED = withFiles(52) // a deliberate demo corpus, under the cap
const ON = { CODE_RAG_DENSE: 'true' } // dense explicitly enabled

describe('assertDenseAskSafe — backstop for an EXPLICIT dense-on cold-embed of a whole repo', () => {
  it('THROWS above the cap ONLY when dense is explicitly on, with an ACTIONABLE message', () => {
    expect(() => assertDenseAskSafe('.', ON, WHOLE_REPO)).toThrow(/refusing to dense-embed/i)
    // the message names every safe way forward
    expect(() => assertDenseAskSafe('.', ON, WHOLE_REPO)).toThrow(/unset CODE_RAG_DENSE/)
    expect(() => assertDenseAskSafe('.', ON, WHOLE_REPO)).toThrow(/--repo/)
    expect(() => assertDenseAskSafe('.', ON, WHOLE_REPO)).toThrow(/CODE_RAG_ALLOW_BIG_DENSE/)
  })

  it('is a NO-OP by DEFAULT (dense unset) even over a whole repo — a bare `ask` runs safe BM25', () => {
    // THE T1 behaviour: with dense opt-in, the default never dense-embeds, so it must never be blocked
    expect(() => assertDenseAskSafe('.', {}, WHOLE_REPO)).not.toThrow()
  })

  it('ALLOWS an explicit dense-on run on a corpus at or under the cap (a ky-sized demo repo)', () => {
    expect(() => assertDenseAskSafe('.', ON, KY_SIZED)).not.toThrow()
  })

  it('is a NO-OP when dense is explicitly OFF — BM25 + structural run no ONNX, so no heat', () => {
    expect(() => assertDenseAskSafe('.', { CODE_RAG_DENSE: 'false' }, WHOLE_REPO)).not.toThrow()
  })

  it('is a NO-OP when dense-on is explicitly overridden (the operator accepts the load)', () => {
    expect(() =>
      assertDenseAskSafe('.', { ...ON, CODE_RAG_ALLOW_BIG_DENSE: '1' }, WHOLE_REPO),
    ).not.toThrow()
  })

  it('degrades to a no-op (never masks the real error) when the corpus cannot be walked', () => {
    const walkThrows = () => {
      throw new Error('ENOENT')
    }
    expect(() => assertDenseAskSafe('/does/not/exist', ON, walkThrows)).not.toThrow()
  })
})
