import { describe, expect, it } from 'vitest'
import { repoLabel } from '../src/lib/repoLabel'

describe('repoLabel — owner/repo from a git URL (chip label, TKT-533)', () => {
  it('derives owner/repo from an https URL, dropping a .git suffix', () => {
    expect(repoLabel('https://github.com/foo/bar.git')).toBe('foo/bar')
    expect(repoLabel('https://github.com/foo/bar')).toBe('foo/bar')
  })

  it('derives owner/repo from an scp-like git@host:owner/repo URL', () => {
    expect(repoLabel('git@github.com:foo/bar.git')).toBe('foo/bar')
  })

  it('keeps the LAST two path segments for a nested (gitlab-style) path', () => {
    expect(repoLabel('https://gitlab.com/group/subgroup/repo.git')).toBe('subgroup/repo')
  })

  it('falls back to the raw url when it cannot parse an owner/repo', () => {
    expect(repoLabel('not-a-url')).toBe('not-a-url')
  })
})
