import { memo, useEffect, useState } from 'react'
import { type HighlightOptions, highlight } from '../lib/highlighter'

export interface CodeBlockProps {
  code: string
  lang: string
  /** 1-based [start, end] line range to mark as the cited span (source viewer, TKT-511). */
  highlightLines?: [number, number]
}

/**
 * One code block: plaintext first-paint, then the Shiki-highlighted markup once it resolves
 * (no Suspense; never shows a blank). Memoized BY VALUE — incl. the highlightLines tuple — so a
 * streaming re-render never re-highlights an unchanged block. Used by the markdown answer
 * (TKT-510, fenced code) and the source viewer (TKT-511, cited chunk).
 */
function CodeBlockBase({ code, lang, highlightLines }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)
  const hlStart = highlightLines?.[0]
  const hlEnd = highlightLines?.[1]

  useEffect(() => {
    let alive = true
    const options: HighlightOptions | undefined =
      hlStart !== undefined && hlEnd !== undefined
        ? { highlightLines: [hlStart, hlEnd] }
        : undefined
    highlight(code, lang, options)
      .then((output) => {
        if (alive) setHtml(output)
      })
      .catch(() => {
        if (alive) setHtml(null)
      })
    return () => {
      alive = false
    }
  }, [code, lang, hlStart, hlEnd])

  if (html !== null) {
    // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output is trusted, escaped token markup — we own the theme + transformers (TKT-509 D7). The LLM answer's raw HTML stays escaped by react-markdown (TKT-510), a separate boundary.
    return <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return (
    <pre className="code-block code-block--plain">
      <code>{code}</code>
    </pre>
  )
}

function arePropsEqual(a: CodeBlockProps, b: CodeBlockProps): boolean {
  return (
    a.code === b.code &&
    a.lang === b.lang &&
    a.highlightLines?.[0] === b.highlightLines?.[0] &&
    a.highlightLines?.[1] === b.highlightLines?.[1]
  )
}

export const CodeBlock = memo(CodeBlockBase, arePropsEqual)
