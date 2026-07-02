import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { isDirectRun } from '../../../src/consume/mainModule.js'

/**
 * isDirectRun (TKT-447) — the realpath-safe direct-run guard shared by every entrypoint. The behaviour
 * the class-bug hinged on: when process.argv[1] is a SYMLINK (npm link) whose realpath is the module,
 * the guard MUST still fire. Deterministic (real temp symlinks), no engine / no ONNX.
 */
let dir: string
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('isDirectRun — realpath-safe entrypoint guard (TKT-447)', () => {
  it('true when argv1 IS the module (real path — node dist/… / tsx src/…)', () => {
    dir = mkdtempSync(join(tmpdir(), 'idr-real-'))
    const file = join(dir, 'entry.js')
    writeFileSync(file, '')
    // import.meta.url is always the realpath of the module — mirror that for moduleUrl (macOS
    // tmpdir is itself a /var -> /private/var symlink, so a non-realpath'd url would never match).
    expect(isDirectRun(file, pathToFileURL(realpathSync(file)).href)).toBe(true)
  })

  it('true when argv1 is a SYMLINK whose realpath is the module (the npm-link case)', () => {
    dir = mkdtempSync(join(tmpdir(), 'idr-link-'))
    const file = join(dir, 'entry.js')
    writeFileSync(file, '')
    const link = join(dir, 'code-rag-link')
    symlinkSync(file, link)
    // moduleUrl is the realpath (node resolves symlinks for import.meta.url); argv1 is the symlink.
    expect(isDirectRun(link, pathToFileURL(realpathSync(file)).href)).toBe(true)
  })

  it('false when argv1 is a DIFFERENT module (imported, not the entry)', () => {
    dir = mkdtempSync(join(tmpdir(), 'idr-diff-'))
    const a = join(dir, 'a.js')
    const b = join(dir, 'b.js')
    writeFileSync(a, '')
    writeFileSync(b, '')
    expect(isDirectRun(a, pathToFileURL(b).href)).toBe(false)
  })

  it('false when argv1 is undefined', () => {
    expect(isDirectRun(undefined, 'file:///whatever.js')).toBe(false)
  })

  it('false (no throw) when argv1 does not exist on disk', () => {
    expect(isDirectRun(join(tmpdir(), 'idr-nope-does-not-exist.js'), 'file:///x.js')).toBe(false)
  })
})
