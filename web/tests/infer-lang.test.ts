import { describe, expect, it } from 'vitest'
import { inferLang } from '../src/lib/inferLang'

describe('inferLang()', () => {
  it('maps known file extensions to Shiki language ids', () => {
    expect(inferLang('src/membrane/index.ts')).toBe('typescript')
    expect(inferLang('web/src/App.tsx')).toBe('tsx')
    expect(inferLang('scripts/run.js')).toBe('javascript')
    expect(inferLang('web/src/main.jsx')).toBe('jsx')
    expect(inferLang('data/config.json')).toBe('json')
    expect(inferLang('scripts/deploy.sh')).toBe('bash')
    expect(inferLang('README.md')).toBe('markdown')
    expect(inferLang('tools/gen.py')).toBe('python')
  })

  it('falls back to text for an unknown or missing extension (no throw)', () => {
    expect(inferLang('Makefile')).toBe('text')
    expect(inferLang('weird.xyz')).toBe('text')
    expect(inferLang('')).toBe('text')
  })
})
