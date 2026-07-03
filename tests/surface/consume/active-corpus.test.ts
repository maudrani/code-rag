import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type ActiveCorpus,
  activeCorpusFile,
  readActiveCorpus,
  writeActiveCorpus,
} from '../../../src/consume/index.js'

// activeCorpus (shared "active corpus" pointer): opt-in via CODE_RAG_STATE (exactly like CODE_RAG_LEDGER).
// UNSET → read undefined + write no-op (EXACTLY today's independent behaviour — the no-regression guard).
// SET → an atomic JSON round-trip that every consumer reads on startup. Deterministic, no network.

let work: string
afterEach(() => {
  if (work !== undefined) rmSync(work, { recursive: true, force: true })
})
/** A fresh temp workspace: a state-file path, an EXISTING clone dir, and an env pointing CODE_RAG_STATE at it. */
function setup(): { stateFile: string; cloneDir: string; env: NodeJS.ProcessEnv } {
  work = mkdtempSync(join(tmpdir(), 'active-corpus-'))
  const stateFile = join(work, 'nested', 'state.json') // nested → proves mkdirSync recursive parent
  const cloneDir = join(work, 'clone')
  mkdirSync(cloneDir, { recursive: true }) // readActiveCorpus requires the path dir to EXIST
  return { stateFile, cloneDir, env: { CODE_RAG_STATE: stateFile } }
}

describe('activeCorpusFile — the CODE_RAG_STATE path (opt-in, trimmed)', () => {
  it('returns the trimmed path when set; undefined when unset or empty', () => {
    expect(activeCorpusFile({ CODE_RAG_STATE: '/x/state.json' })).toBe('/x/state.json')
    expect(activeCorpusFile({ CODE_RAG_STATE: '  /x/state.json  ' })).toBe('/x/state.json')
    expect(activeCorpusFile({})).toBeUndefined()
    expect(activeCorpusFile({ CODE_RAG_STATE: '   ' })).toBeUndefined()
  })
})

describe('readActiveCorpus / writeActiveCorpus — round-trip + graceful degradation', () => {
  it('write then read → the same {url, path} (round-trip through a temp file)', () => {
    const { stateFile, cloneDir, env } = setup()
    const corpus: ActiveCorpus = { url: 'https://github.com/a/b.git', path: cloneDir }
    writeActiveCorpus(corpus, env)
    expect(existsSync(stateFile)).toBe(true) // parent dir was created recursively
    expect(readActiveCorpus(env)).toEqual(corpus)
  })

  it('CODE_RAG_STATE UNSET → read undefined AND write is a no-op (the no-regression guard)', () => {
    const { cloneDir } = setup()
    const env: NodeJS.ProcessEnv = {} // unset
    expect(readActiveCorpus(env)).toBeUndefined()
    // write must not create anything, anywhere — behaviour is EXACTLY today (independent consumers).
    writeActiveCorpus({ url: 'https://github.com/a/b.git', path: cloneDir }, env)
    expect(existsSync(join(work, 'nested'))).toBe(false) // nothing was written
  })

  it('missing file → undefined (no throw)', () => {
    const { env } = setup() // CODE_RAG_STATE points at a file that was never written
    expect(readActiveCorpus(env)).toBeUndefined()
  })

  it('invalid JSON → undefined, never throws', () => {
    const { stateFile, env } = setup()
    mkdirSync(join(work, 'nested'), { recursive: true })
    writeFileSync(stateFile, '{ this is not: valid json ')
    expect(() => readActiveCorpus(env)).not.toThrow()
    expect(readActiveCorpus(env)).toBeUndefined()
  })

  it('non-string url/path (structurally wrong JSON) → undefined', () => {
    const { stateFile, env } = setup()
    mkdirSync(join(work, 'nested'), { recursive: true })
    writeFileSync(stateFile, JSON.stringify({ url: 42, path: ['nope'] }))
    expect(readActiveCorpus(env)).toBeUndefined()
  })

  it('a state whose recorded path dir was REMOVED → undefined (stale pointer is dropped)', () => {
    const { cloneDir, env } = setup()
    writeActiveCorpus({ url: 'https://github.com/a/b.git', path: cloneDir }, env)
    expect(readActiveCorpus(env)).toBeDefined() // still there
    rmSync(cloneDir, { recursive: true, force: true }) // the clone dir is gone
    expect(readActiveCorpus(env)).toBeUndefined() // → no shared pointer to follow
  })

  it('the write is ATOMIC — no leftover .tmp, and the file is always complete JSON', () => {
    const { stateFile, cloneDir, env } = setup()
    const corpus: ActiveCorpus = { url: 'https://github.com/a/b.git', path: cloneDir }
    writeActiveCorpus(corpus, env)
    // the .tmp sibling was renamed onto the final file → it must not survive.
    expect(existsSync(`${stateFile}.tmp`)).toBe(false)
    // whatever a concurrent reader would open is either absent or fully-formed — never a torn write.
    expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toEqual(corpus)
    // a second write overwrites cleanly and still leaves no .tmp behind.
    const next: ActiveCorpus = { url: 'https://github.com/a/c.git', path: cloneDir }
    writeActiveCorpus(next, env)
    expect(existsSync(`${stateFile}.tmp`)).toBe(false)
    expect(readActiveCorpus(env)).toEqual(next)
  })
})
