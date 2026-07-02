import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EXIT } from '../../../src/cli/errors.js'
import { run } from '../../../src/cli/run.js'
import { buildEngine } from '../../../src/consume/index.js'
import type { EngineConfig } from '../../../src/contracts/engine.js'
import { makeMockEngine } from '../fixtures/mock-engine.js'

function capture() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    stdout: { write: (s: string) => out.push(s) > 0 },
    stderr: { write: (s: string) => err.push(s) > 0 },
  }
}

const corpusDir = fileURLToPath(new URL('./fixtures/corpus', import.meta.url))

describe('run — TKT-411', () => {
  it('NO-KEY --dry invariant: a REAL engine over a fixture corpus, no API key -> exit OK', async () => {
    const cap = capture()
    const code = await run(['ask', 'greet function', '--dry'], {
      buildEngine: () => buildEngine({ corpusPath: corpusDir }),
      stdout: cap.stdout,
      stderr: cap.stderr,
      env: {}, // no ANTHROPIC_API_KEY — the dry path never constructs the provider
    })
    expect(code).toBe(EXIT.OK)
    expect(cap.out.join('')).toMatch(/answer|refuse/) // a decision band was printed
    expect(cap.err.join('')).toBe('')
  }, 30000)

  it('--dry --json: stdout parses to a DTO with no context, exit OK', async () => {
    const cap = capture()
    const code = await run(['ask', 'greet', '--dry', '--json'], {
      buildEngine: () => buildEngine({ corpusPath: corpusDir }),
      stdout: cap.stdout,
      stderr: cap.stderr,
      env: {},
    })
    expect(code).toBe(EXIT.OK)
    const parsed = JSON.parse(cap.out.join('').trim()) as Record<string, unknown>
    expect(parsed.queryId).toBeDefined()
    expect('context' in parsed).toBe(false)
  }, 30000)

  it('answer path: streams the answer to stdout with the citations header FIRST, exit OK', async () => {
    const cap = capture()
    const code = await run(['ask', 'where is foo?'], {
      buildEngine: () => makeMockEngine({ tokens: ['foo ', 'lives'] }),
      stdout: cap.stdout,
      stderr: cap.stderr,
      env: {},
    })
    expect(code).toBe(EXIT.OK)
    const output = cap.out.join('')
    expect(output).toContain('foo lives') // streamed answer
    // header-first: a citation appears before the answer text
    expect(output.indexOf('src/foo.ts:1-3')).toBeLessThan(output.indexOf('foo lives'))
  })

  it('--help -> usage on stdout, exit OK', async () => {
    const cap = capture()
    const code = await run(['--help'], { stdout: cap.stdout, stderr: cap.stderr, env: {} })
    expect(code).toBe(EXIT.OK)
    expect(cap.out.join('')).toContain('code-rag ask')
  })

  it('--help lists EVERY command verb — the help-drift guard (TKT-441)', async () => {
    const cap = capture()
    const code = await run(['--help'], { stdout: cap.stdout, stderr: cap.stderr, env: {} })
    expect(code).toBe(EXIT.OK)
    const help = cap.out.join('')
    // the checklist: a command added to parseCli without a HELP line fails this.
    for (const verb of ['ask', 'stats', 'health', 'log', 'symbols']) {
      expect(help).toContain(`code-rag ${verb}`)
    }
  })

  it('--version -> a version on stdout, exit OK', async () => {
    const cap = capture()
    const code = await run(['--version'], { stdout: cap.stdout, stderr: cap.stderr, env: {} })
    expect(code).toBe(EXIT.OK)
    expect(cap.out.join('').trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('--repo resolves a corpus and threads it to buildEngine (FTR-5 / TKT-445)', async () => {
    const cap = capture()
    let received: EngineConfig | undefined = { corpusPath: 'sentinel' }
    const code = await run(['symbols', '--json', '--repo', 'https://github.com/a/b.git'], {
      buildEngine: (config) => {
        received = config
        return makeMockEngine()
      },
      resolveCorpusSource: async ({ repo }) =>
        repo === 'https://github.com/a/b.git' ? '/cache/clone-dir' : undefined,
      stdout: cap.stdout,
      stderr: cap.stderr,
      env: {},
    })
    expect(code).toBe(EXIT.OK)
    expect(received?.corpusPath).toBe('/cache/clone-dir')
  })

  it('CODE_RAG_REPO env routes the same as --repo (the shared resolver sees env)', async () => {
    const cap = capture()
    let received: EngineConfig | undefined
    await run(['symbols', '--json'], {
      buildEngine: (config) => {
        received = config
        return makeMockEngine()
      },
      resolveCorpusSource: async ({ repo, env }) =>
        (repo ?? env.CODE_RAG_REPO) !== undefined ? '/env/clone' : undefined,
      stdout: cap.stdout,
      stderr: cap.stderr,
      env: { CODE_RAG_REPO: 'https://github.com/a/b.git' },
    })
    expect(received?.corpusPath).toBe('/env/clone')
  })

  it('no repo -> buildEngine gets NO corpusPath override (real resolver, empty env, no clone)', async () => {
    const cap = capture()
    let received: EngineConfig | undefined = { corpusPath: 'sentinel' }
    await run(['symbols', '--json'], {
      buildEngine: (config) => {
        received = config
        return makeMockEngine()
      },
      stdout: cap.stdout,
      stderr: cap.stderr,
      env: {}, // no CODE_RAG_REPO → the real resolveCorpusSource returns undefined (never clones)
    })
    // a read-surface (symbols) builds DENSE-OFF (TKT-449); the invariant here is NO corpusPath override.
    expect(received?.corpusPath).toBeUndefined()
    expect(received?.dense).toBe(false)
  })

  it('NEGATIVE: unknown command -> EXIT.USAGE, message to STDERR (stdout stays clean)', async () => {
    const cap = capture()
    const code = await run(['bogus'], { stdout: cap.stdout, stderr: cap.stderr, env: {} })
    expect(code).toBe(EXIT.USAGE)
    expect(cap.err.join('')).toMatch(/unknown command|usage/i)
    expect(cap.out.join('')).toBe('') // nothing leaks to stdout
  })

  it('NEGATIVE: an engine error -> EXIT.ERROR, message to stderr (no raw stack)', async () => {
    const cap = capture()
    const boom = {
      ...makeMockEngine(),
      query: () => Promise.reject(new Error('index unavailable')),
    }
    const code = await run(['ask', 'foo', '--dry'], {
      buildEngine: () => boom,
      stdout: cap.stdout,
      stderr: cap.stderr,
      env: {},
    })
    expect(code).toBe(EXIT.ERROR)
    expect(cap.err.join('')).toContain('index unavailable')
  })

  it('NEGATIVE under --json: an engine error is emitted as JSON to stderr', async () => {
    const cap = capture()
    const boom = {
      ...makeMockEngine(),
      query: () => Promise.reject(new Error('boom')),
    }
    const code = await run(['ask', 'foo', '--dry', '--json'], {
      buildEngine: () => boom,
      stdout: cap.stdout,
      stderr: cap.stderr,
      env: {},
    })
    expect(code).toBe(EXIT.ERROR)
    const parsed = JSON.parse(cap.err.join('').trim()) as { error: string }
    expect(parsed.error).toContain('boom')
  })
})
