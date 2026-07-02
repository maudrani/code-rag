import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  assertSafeRepoUrl,
  isRepoUrl,
  redactUrl,
  repoCacheDir,
  resolveCorpus,
  resolveCorpusSource,
} from '../../../src/consume/corpus.js'

// resolveCorpus: a repo URL clones to a local dir (injectable, deterministic); a local path passes
// through. The clone is an INJECTED seam so the suite never touches the network (TKT-005 determinism);
// the real clone is a RUN_SLOW variant. Injection-safety (GAP-E) is the load-bearing negative here.

describe('resolveCorpus — repo URL → local dir via an injectable clone (TKT-444)', () => {
  it('a repo URL → clone(url, dest) is called once and the dest is returned', async () => {
    const clone = vi.fn(async (_url: string, _dest: string) => {})
    const url = 'https://github.com/owner/repo.git'
    const dest = await resolveCorpus(url, { clone })
    expect(clone).toHaveBeenCalledTimes(1)
    expect(clone.mock.calls[0]?.[0]).toBe(url) // the URL is passed as an ARG (never a shell string)
    expect(clone.mock.calls[0]?.[1]).toBe(dest) // clones INTO the dest it returns
    expect(typeof dest).toBe('string')
    expect(dest.length).toBeGreaterThan(0)
  })

  it('a local path passes through UNCHANGED — clone is never called', async () => {
    const clone = vi.fn(async () => {})
    expect(await resolveCorpus('./src', { clone })).toBe('./src')
    expect(await resolveCorpus('/abs/path/repo', { clone })).toBe('/abs/path/repo')
    expect(clone).not.toHaveBeenCalled()
  })

  it('EDGE: a URL-ish local path (a colon, no scheme) is NOT mis-routed to clone', async () => {
    const clone = vi.fn(async () => {})
    expect(await resolveCorpus('C:\\Users\\me\\repo', { clone })).toBe('C:\\Users\\me\\repo')
    expect(await resolveCorpus('./weird:dir', { clone })).toBe('./weird:dir')
    expect(clone).not.toHaveBeenCalled()
  })

  describe('isRepoUrl — detection', () => {
    it('detects allowlisted git URLs', () => {
      expect(isRepoUrl('https://github.com/a/b.git')).toBe(true)
      expect(isRepoUrl('http://host/a/b')).toBe(true)
      expect(isRepoUrl('git://host/a/b')).toBe(true)
      expect(isRepoUrl('ssh://git@host/a/b')).toBe(true)
      expect(isRepoUrl('git@github.com:a/b.git')).toBe(true)
    })
    it('rejects local paths (not URLs)', () => {
      expect(isRepoUrl('./src')).toBe(false)
      expect(isRepoUrl('/abs/repo')).toBe(false)
      expect(isRepoUrl('C:\\Users\\repo')).toBe(false)
    })
  })

  describe('NEGATIVE — injection-safety (GAP-E)', () => {
    it('rejects shell metacharacters in a URL, and clone is NEVER called', async () => {
      const clone = vi.fn(async () => {})
      for (const bad of [
        'https://github.com/a/b;rm -rf /',
        'https://github.com/a/b`whoami`',
        'https://github.com/a/b$(touch pwned)',
        'https://github.com/a/b|cat',
      ]) {
        await expect(resolveCorpus(bad, { clone })).rejects.toThrow()
      }
      expect(clone).not.toHaveBeenCalled()
    })

    it('rejects URL-ish non-git transports (ext::/file:///fd::/ftp://) — git-level RCE vector; clone NEVER called', async () => {
      const clone = vi.fn(async () => {})
      for (const bad of ['ext::sh -c id', 'file:///etc/passwd', 'fd::17', 'ftp://host/x']) {
        await expect(resolveCorpus(bad, { clone })).rejects.toThrow()
      }
      expect(clone).not.toHaveBeenCalled()
    })

    it('rejects a leading-dash URL (git argument injection)', () => {
      expect(() => assertSafeRepoUrl('--upload-pack=payload')).toThrow()
    })
  })
})

describe('resolveCorpusSource — env/flag wiring + token (TKT-445)', () => {
  it('explicit repo (--repo) beats CODE_RAG_REPO; both resolve via resolveCorpus', async () => {
    const clone = vi.fn(async (_url: string, _dest: string) => {})
    const dir = await resolveCorpusSource({
      repo: 'https://github.com/a/flag.git',
      env: { CODE_RAG_REPO: 'https://github.com/a/env.git' },
      deps: { clone },
    })
    expect(clone.mock.calls[0]?.[0]).toBe('https://github.com/a/flag.git') // the flag wins
    expect(dir).toBeDefined()
  })

  it('falls back to CODE_RAG_REPO when no --repo', async () => {
    const clone = vi.fn(async (_url: string, _dest: string) => {})
    await resolveCorpusSource({
      env: { CODE_RAG_REPO: 'https://github.com/a/env.git' },
      deps: { clone },
    })
    expect(clone.mock.calls[0]?.[0]).toBe('https://github.com/a/env.git')
  })

  it('no repo set → undefined (falls through to CORPUS_PATH); clone never called', async () => {
    const clone = vi.fn(async (_url: string, _dest: string) => {})
    expect(await resolveCorpusSource({ env: {}, deps: { clone } })).toBeUndefined()
    expect(clone).not.toHaveBeenCalled()
  })

  it('CODE_RAG_GITHUB_TOKEN is injected into the https clone URL (private repo)', async () => {
    const clone = vi.fn(async (_url: string, _dest: string) => {})
    await resolveCorpusSource({
      repo: 'https://github.com/a/private.git',
      env: { CODE_RAG_GITHUB_TOKEN: 'secret123' },
      deps: { clone },
    })
    expect(clone.mock.calls[0]?.[0]).toBe('https://secret123@github.com/a/private.git')
  })
})

describe('repoCacheDir — stable, URL-hashed (TKT-445 / warm-restart)', () => {
  it('the same URL → the same dir; different URLs → different dirs', () => {
    const a = repoCacheDir('https://github.com/a/b.git')
    expect(repoCacheDir('https://github.com/a/b.git')).toBe(a) // stable across runs
    expect(repoCacheDir('https://github.com/a/c.git')).not.toBe(a)
  })
})

describe('resolveCorpus — reuse: pull on repeat, not re-clone (TKT-445)', () => {
  it('an existing cached clone → pull (NOT a second clone)', async () => {
    const url = 'https://github.com/reuse/pull-marker-unique.git'
    const dest = repoCacheDir(url)
    mkdirSync(join(dest, '.git'), { recursive: true }) // simulate an already-cloned cache dir
    try {
      const clone = vi.fn(async (_url: string, _dest: string) => {})
      const pull = vi.fn(async (_dest: string) => {})
      const result = await resolveCorpus(url, { clone, pull })
      expect(pull).toHaveBeenCalledTimes(1)
      expect(clone).not.toHaveBeenCalled()
      expect(result).toBe(dest)
    } finally {
      rmSync(dest, { recursive: true, force: true })
    }
  })

  it('NEGATIVE (secret-leak): redactUrl strips the token from a URL — never logged', () => {
    expect(redactUrl('https://secret123@github.com/a/b.git')).toBe('https://***@github.com/a/b.git')
    expect(redactUrl('https://secret123@github.com/a/b.git')).not.toContain('secret123')
  })
})

const RUN_SLOW = process.env.RUN_SLOW === '1'
describe.skipIf(!RUN_SLOW)('resolveCorpus — REAL shallow git clone (RUN_SLOW, network)', () => {
  it('clones a tiny public repo to a local dir containing its files', async () => {
    const dir = await resolveCorpus('https://github.com/octocat/Hello-World.git')
    expect(existsSync(dir)).toBe(true)
    expect(readdirSync(dir).length).toBeGreaterThan(0)
  }, 60000)
})
