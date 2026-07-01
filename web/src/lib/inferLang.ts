/** Map a file-path extension to a Shiki language id, defaulting to 'text' (TKT-511). */
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
}

/**
 * Infer a syntax-highlighting language from a file path's extension. Used by the source viewer
 * when the chunk carries no explicit `lang`. Unknown extensions / dotfiles / no-extension paths
 * resolve to 'text' (the safe plaintext fallback — never throws).
 */
export function inferLang(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'text' // no extension, or a dotfile like `.gitignore`
  const ext = base.slice(dot + 1).toLowerCase()
  return EXT_TO_LANG[ext] ?? 'text'
}
