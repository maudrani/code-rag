import { describe, expect, it } from 'vitest'
import type { Citation } from '../src/contract'
import { resolveCitation } from '../src/lib/resolveCitation'
import { answerProjection } from '../src/mocks/fixtures'

describe('resolveCitation', () => {
  it('returns the matching chunk for a present chunkId', () => {
    const citation = answerProjection.citations[0]
    const chunk = resolveCitation(citation, answerProjection.results)
    expect(chunk).not.toBeNull()
    expect(chunk?.id).toBe(citation.chunkId)
    expect(chunk?.code.length).toBeGreaterThan(0)
  })

  it('returns null when the chunkId is absent from results', () => {
    const bogus: Citation = {
      chunkId: 'does/not/exist.ts#nope@1-2',
      path: 'does/not/exist.ts',
      span: { startLine: 1, endLine: 2 },
      label: 'nope',
    }
    expect(resolveCitation(bogus, answerProjection.results)).toBeNull()
  })

  it('matches the id exactly (not by prefix)', () => {
    const citation = answerProjection.citations[0]
    const prefix: Citation = { ...citation, chunkId: citation.chunkId.slice(0, 10) }
    expect(resolveCitation(prefix, answerProjection.results)).toBeNull()
  })
})
