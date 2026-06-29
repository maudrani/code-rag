import { describe, expect, it } from 'vitest'
import type { Turn } from '../../src/contracts/index.js'
import { needsRewrite } from '../../src/membrane/resolve.js'

const H: Turn[] = [
  { role: 'user', content: 'How does retrieval work?' },
  { role: 'assistant', content: 'It fuses BM25 and structural legs.' },
]

describe('needsRewrite (L0 anaphora gate)', () => {
  it('treats the first turn as always standalone (no history to resolve)', () => {
    expect(needsRewrite('why does it fail?', [])).toBe(false)
  })

  it('flags a bare-pronoun follow-up', () => {
    expect(needsRewrite('why does it fail?', H)).toBe(true)
    expect(needsRewrite('how do they connect?', H)).toBe(true)
  })

  it('flags a leading-conjunction / fragment follow-up', () => {
    expect(needsRewrite('and the tests?', H)).toBe(true)
    expect(needsRewrite('what about errors?', H)).toBe(true)
  })

  it('flags a demonstrative bound to a generic noun', () => {
    expect(needsRewrite('how does this function work?', H)).toBe(true)
  })

  it('treats a question naming a concrete symbol as standalone', () => {
    expect(needsRewrite('where is getUserById defined?', H)).toBe(false)
    expect(needsRewrite('what does parseQuery return?', H)).toBe(false)
    expect(needsRewrite('explain RankedChunk', H)).toBe(false)
    expect(needsRewrite('what calls retrieve()?', H)).toBe(false)
  })

  it('treats a self-contained question (no anaphora) as standalone', () => {
    expect(needsRewrite('explain the retrieval fusion flow', H)).toBe(false)
  })

  it('ignores empty / whitespace input', () => {
    expect(needsRewrite('   ', H)).toBe(false)
  })
})
