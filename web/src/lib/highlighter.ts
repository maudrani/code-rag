import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
  type ShikiTransformer,
} from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

/**
 * Browser-only syntax highlighter (TKT-509). One Shiki singleton on the JavaScript regex
 * engine (no WASM -> smaller bundle, faster startup; Shiki's own web guidance), built on the
 * fine-grained `shiki/core` so only the corpus's grammars ship — each is a dynamic import, so
 * Vite code-splits it into a lazy chunk. Shared by the markdown answer (TKT-510) and the
 * source viewer (TKT-511). An unknown language degrades to escaped plaintext — never throws.
 */

const THEME = 'github-dark'

// The corpus self-indexes this TS repo (ADR-006 G6); these are the languages its answers
// and cited files use. Each grammar is a dynamic import -> its own lazy Vite chunk.
const LANG_LOADERS: Record<string, () => Promise<{ default: LanguageRegistration[] }>> = {
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  bash: () => import('@shikijs/langs/bash'),
  markdown: () => import('@shikijs/langs/markdown'),
  python: () => import('@shikijs/langs/python'),
}

// Aliases the wire (chunk.lang, e.g. 'ts') and markdown fences use -> the canonical grammar id.
const ALIASES: Record<string, string> = {
  ts: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  javascript: 'javascript',
  jsx: 'jsx',
  tsx: 'tsx',
  json: 'json',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  bash: 'bash',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  python: 'python',
}

/** Resolve any language token to a registered grammar id, or 'text' (no grammar, safe fallback). */
function resolveLang(lang: string): string {
  return ALIASES[(lang ?? '').toLowerCase().trim()] ?? 'text'
}

export interface HighlightOptions {
  /** 1-based [start, end] line range to mark cited (adds the `line--cited` class to those lines). */
  highlightLines?: [number, number]
}

let highlighterP: Promise<HighlighterCore> | null = null
let initCount = 0
const loadedLangs = new Set<string>()
const cache = new Map<string, Promise<string>>()

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterP) {
    initCount += 1
    highlighterP = createHighlighterCore({
      themes: [import('@shikijs/themes/github-dark')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return highlighterP
}

/** Lazily load + cache a grammar; returns false for 'text' / unsupported (render as plaintext). */
async function ensureLang(hl: HighlighterCore, id: string): Promise<boolean> {
  if (id === 'text') return false
  if (loadedLangs.has(id)) return true
  const loader = LANG_LOADERS[id]
  if (!loader) return false
  await hl.loadLanguage(loader())
  loadedLangs.add(id)
  return true
}

/** A Shiki transformer that marks a 1-based [start, end] line range with the `line--cited` class. */
function citedLineTransformer([start, end]: [number, number]): ShikiTransformer {
  return {
    name: 'cited-lines',
    line(node, line) {
      if (line >= start && line <= end) {
        this.addClassToHast(node, 'line--cited')
      }
    },
  }
}

async function doHighlight(
  code: string,
  id: string,
  range: [number, number] | undefined,
): Promise<string> {
  const hl = await getHighlighter()
  const supported = await ensureLang(hl, id)
  const transformers = range ? [citedLineTransformer(range)] : []
  // Shiki escapes the code text; 'text' is a built-in no-grammar lang (the safe fallback).
  return hl.codeToHtml(code, { lang: supported ? id : 'text', theme: THEME, transformers })
}

/**
 * Highlight `code` as `lang` to Shiki token HTML. Memoized by (lang, range, code) so a streaming
 * re-render never re-highlights an unchanged block. An unknown language -> escaped plaintext.
 */
export function highlight(code: string, lang: string, options?: HighlightOptions): Promise<string> {
  const id = resolveLang(lang)
  const range = options?.highlightLines
  const key = JSON.stringify([id, range ?? null, code])
  const hit = cache.get(key)
  if (hit) return hit
  const result = doHighlight(code, id, range)
  cache.set(key, result)
  return result
}

/** Test-only: how many times the singleton highlighter was created (the single-init invariant). */
export function _highlighterInitCount(): number {
  return initCount
}

/** Test-only: reset the module singleton + caches so tests are isolated. */
export function _resetHighlighterForTest(): void {
  highlighterP = null
  initCount = 0
  loadedLangs.clear()
  cache.clear()
}
