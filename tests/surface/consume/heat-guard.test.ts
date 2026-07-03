import { describe, expect, it } from 'vitest'
import { assertDenseAskSafe, DENSE_COLD_FILE_CAP } from '../../../src/consume/index.js'

// The heat guard against `code-rag ask`'s worst footgun: a bare invocation self-indexes the WHOLE repo
// and, dense ON by default, cold-embeds every chunk — which can freeze the machine. walkFn is injected
// so these run offline + deterministically (no real fs walk, no engine, no ONNX).
const withFiles = (n: number) => () => ({
  files: Array.from({ length: n }, (_, i) => `f${i}.ts`),
})
const WHOLE_REPO = withFiles(DENSE_COLD_FILE_CAP + 50) // over the cap (the footgun)
const KY_SIZED = withFiles(52) // a deliberate demo corpus, under the cap

describe('assertDenseAskSafe — refuse a cold dense-embed of a whole repo (heat guard)', () => {
  it('THROWS above the cap, with an ACTIONABLE message (the escape hatches)', () => {
    expect(() => assertDenseAskSafe('.', {}, WHOLE_REPO)).toThrow(/refusing to dense-embed/i)
    // the message names every safe way forward
    expect(() => assertDenseAskSafe('.', {}, WHOLE_REPO)).toThrow(/CODE_RAG_DENSE=false/)
    expect(() => assertDenseAskSafe('.', {}, WHOLE_REPO)).toThrow(/--repo/)
    expect(() => assertDenseAskSafe('.', {}, WHOLE_REPO)).toThrow(/CODE_RAG_ALLOW_BIG_DENSE/)
  })

  it('ALLOWS a corpus at or under the cap (a ky-sized demo repo)', () => {
    expect(() => assertDenseAskSafe('.', {}, KY_SIZED)).not.toThrow()
  })

  it('is a NO-OP when the dense leg is OFF — BM25 + structural run no ONNX, so no heat', () => {
    expect(() => assertDenseAskSafe('.', { CODE_RAG_DENSE: 'false' }, WHOLE_REPO)).not.toThrow()
  })

  it('is a NO-OP when explicitly overridden (the operator accepts the load)', () => {
    expect(() =>
      assertDenseAskSafe('.', { CODE_RAG_ALLOW_BIG_DENSE: '1' }, WHOLE_REPO),
    ).not.toThrow()
  })

  it('degrades to a no-op (never masks the real error) when the corpus cannot be walked', () => {
    const walkThrows = () => {
      throw new Error('ENOENT')
    }
    expect(() => assertDenseAskSafe('/does/not/exist', {}, walkThrows)).not.toThrow()
  })
})
