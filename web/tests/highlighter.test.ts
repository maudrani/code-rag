import { beforeEach, describe, expect, it } from 'vitest'
import { _highlighterInitCount, _resetHighlighterForTest, highlight } from '../src/lib/highlighter'

// The highlighter is a module-level singleton; reset between tests for isolation.
beforeEach(() => {
  _resetHighlighterForTest()
})

describe('highlight()', () => {
  it('tokenizes known code into colored token spans (NON-VACUOUS)', async () => {
    const html = await highlight('const answer = 42', 'ts')
    // Shiki wraps each token in <span style="color:...">. A raw passthrough (no
    // highlighting) produces ZERO colored spans — this assertion is the non-vacuity guard.
    const coloredTokens = html.match(/<span style="color:/g) ?? []
    expect(coloredTokens.length).toBeGreaterThan(1)
    expect(html).toContain('const')
  })

  it('falls back to escaped plaintext for an unknown language WITHOUT throwing', async () => {
    const html = await highlight('PROCEDURE DIVISION.', 'cobol-9000')
    expect(html).toContain('PROCEDURE DIVISION')
  })

  it('escapes HTML in the code (no raw injection through the highlighter)', async () => {
    const html = await highlight('<img src=x onerror="boom()">', 'text')
    // The dangerous tag is neutralized (the `<` is HTML-escaped, whatever the entity form)...
    expect(html).not.toContain('<img')
    // ...but the text content survives, escaped, as visible code.
    expect(html).toContain('img src=x onerror')
  })

  it('marks ONLY the cited line range (non-vacuous: 2 of 4 lines)', async () => {
    const code = ['alpha', 'bravo', 'charlie', 'delta'].join('\n')
    const html = await highlight(code, 'text', { highlightLines: [2, 3] })
    const cited = html.match(/line--cited/g) ?? []
    const allLines = html.match(/class="line/g) ?? []
    expect(cited.length).toBe(2) // bravo + charlie only
    expect(allLines.length).toBe(4) // the other 2 lines are NOT cited
  })

  it('clamps a highlight range that runs past the last line', async () => {
    const code = ['only', 'two'].join('\n')
    const html = await highlight(code, 'text', { highlightLines: [1, 99] })
    expect((html.match(/line--cited/g) ?? []).length).toBe(2)
  })

  it('uses a SINGLE highlighter instance across many calls (singleton)', async () => {
    await highlight('a', 'ts')
    await highlight('b', 'json')
    await highlight('c', 'bash')
    expect(_highlighterInitCount()).toBe(1)
  })

  it('memoizes identical (code, lang, range) calls — same promise, no re-highlight', () => {
    const p1 = highlight('const x = 1', 'ts')
    const p2 = highlight('const x = 1', 'ts')
    expect(p1).toBe(p2)
  })
})
