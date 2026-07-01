import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

const LANG_RE = /language-(\w+)/

/** Allow http(s), mailto, anchors, and relative URLs; drop any other scheme (javascript:, data:, …). */
function safeUrl(url: string): string {
  if (/^(https?:|mailto:|#|\/|\.)/i.test(url)) return url
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return ''
  return url
}

const components: Components = {
  // Unwrap react-markdown's default <pre> so a fenced CodeBlock is not double-wrapped in a <pre>.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children ?? '')
    const match = LANG_RE.exec(className ?? '')
    const isBlock = match !== null || text.includes('\n')
    if (isBlock) {
      return <CodeBlock code={text.replace(/\n$/, '')} lang={match?.[1] ?? 'text'} />
    }
    return <code className="md-inline-code">{children}</code>
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
}

/**
 * Render the assistant's markdown answer (TKT-510): GFM via remark-gfm, fenced code through the
 * Shiki CodeBlock (TKT-509), links sanitized + opened safely. XSS-safe BY CONSTRUCTION — there is
 * NO rehype-raw, so raw HTML in the (LLM-generated) answer stays escaped, and urlTransform drops
 * dangerous URL schemes. The only trusted innerHTML in the app is Shiki's own token output (D7).
 */
export function AnswerMarkdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <Markdown remarkPlugins={[remarkGfm]} urlTransform={safeUrl} components={components}>
        {content}
      </Markdown>
    </div>
  )
}
