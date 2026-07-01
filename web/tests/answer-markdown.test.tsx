import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnswerMarkdown } from '../src/components/AnswerMarkdown'

describe('AnswerMarkdown', () => {
  it('renders GFM markdown as real DOM elements, NOT raw source text', () => {
    const md = '## Title\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nUse `query()` here.'
    const { container } = render(<AnswerMarkdown content={md} />)
    expect(container.querySelector('h2')?.textContent).toBe('Title')
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('code')?.textContent).toContain('query()')
    // NON-VACUOUS: the raw markdown markers are GONE — they rendered to elements, not literal text.
    expect(container.textContent).not.toContain('## Title')
    expect(container.textContent).not.toContain('| a | b |')
  })

  it('renders a fenced code block through CodeBlock (Shiki-highlighted)', async () => {
    const { container } = render(<AnswerMarkdown content={'```ts\nconst x = 1\n```'} />)
    expect(container.querySelector('.code-block')).not.toBeNull()
    await waitFor(() => expect(container.querySelector('pre.shiki')).not.toBeNull())
  })

  it('escapes raw HTML in the answer (XSS-safe — no rehype-raw)', () => {
    const md = 'before <script>window.__pwned = 1</script> and <img src=x onerror="boom()"> after'
    const { container } = render(<AnswerMarkdown content={md} />)
    // The dangerous tags do NOT become live elements.
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    // The surrounding prose still renders.
    expect(container.textContent).toContain('before')
    expect(container.textContent).toContain('after')
  })

  it('neutralizes a javascript: link URL', () => {
    const { container } = render(<AnswerMarkdown content={'[click me](javascript:alert(1))'} />)
    const anchor = container.querySelector('a')
    expect(anchor?.getAttribute('href') ?? '').not.toContain('javascript:')
  })

  it('renders inline code as <code>, not a block', () => {
    const { container } = render(<AnswerMarkdown content={'call `resolveCitation` now'} />)
    expect(container.querySelector('.code-block')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('resolveCitation')
  })
})
