import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_MAX_FILE_BYTES, langForExtension } from '../../src/ingest/defaults.js'
import { walk } from '../../src/ingest/walker.js'

// TKT-104 — L1 ingest walker. Test-first (RULE-PROD-001): inclusion, ignore
// dirs, size cap, binary + declaration skips, determinism, relative paths,
// symlink safety, empty/no-code edges. The tree is built at runtime in a temp
// dir so we don't commit .ts fixtures that fight the strict root tsconfig/biome.

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'walker-'))
  mkdirSync(join(root, 'sub'))
  mkdirSync(join(root, 'empty'))
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(root, 'b.mts'), 'export const b = 2\n')
  writeFileSync(join(root, 'sub', 'c.ts'), 'export const c = 3\n')
  writeFileSync(join(root, 'ignore.d.ts'), 'export declare const d: number\n') // declaration → skip
  writeFileSync(join(root, 'big.ts'), 'x'.repeat(DEFAULT_MAX_FILE_BYTES + 1)) // too-large → skip
  writeFileSync(join(root, 'bin.ts'), Buffer.from([108, 101, 116, 0, 49, 10])) // null byte → binary skip
  writeFileSync(join(root, 'notes.md'), '# not code\n') // non-ext → not a candidate
  writeFileSync(join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47])) // non-ext → not a candidate
  writeFileSync(join(root, 'node_modules', 'dep.ts'), 'export const dep = 0\n') // ignored dir
  // a symlink that points back to root → must NOT be followed (loop guard)
  try {
    symlinkSync(root, join(root, 'loop'), 'dir')
  } catch {
    // some environments disallow symlinks; the loop-guard assertion is skipped then
  }
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('ingest walker (TKT-104)', () => {
  it('includes only matched code files, as repo-relative posix paths', () => {
    const { files } = walk(root)
    expect(files).toContain('a.ts')
    expect(files).toContain('b.mts')
    expect(files).toContain('sub/c.ts')
  })

  it('returns a deterministic (sorted) file list', () => {
    expect(walk(root).files).toEqual([...walk(root).files].sort())
  })

  it('skips node_modules contents entirely', () => {
    expect(walk(root).files.some((f) => f.includes('node_modules'))).toBe(false)
  })

  it('records declaration / too-large / binary skips with a reason', () => {
    const { skipped } = walk(root)
    const reasonFor = (p: string) => skipped.find((s) => s.path === p)?.reason
    expect(reasonFor('ignore.d.ts')).toBe('declaration')
    expect(reasonFor('big.ts')).toBe('too-large')
    expect(reasonFor('bin.ts')).toBe('binary')
  })

  it('does not enumerate non-code files (md / png) as candidates', () => {
    const { files, skipped } = walk(root)
    const paths = [...files, ...skipped.map((s) => s.path)]
    expect(paths).not.toContain('notes.md')
    expect(paths).not.toContain('image.png')
  })

  it('emits only repo-relative paths (no absolute leakage)', () => {
    const { files, skipped } = walk(root)
    expect(files.every((f) => !f.startsWith('/'))).toBe(true)
    expect(skipped.every((s) => !s.path.startsWith('/'))).toBe(true)
  })

  it('does not follow symlinks (loop guard) and terminates', () => {
    // If the loop symlink were followed, files would contain a 'loop/...' path.
    expect(walk(root).files.some((f) => f.startsWith('loop/'))).toBe(false)
  })

  it('handles an empty subtree without crashing', () => {
    expect(walk(join(root, 'empty')).files).toEqual([])
  })

  it('respects a custom extension filter', () => {
    const { files } = walk(root, { extensions: ['.mts'] })
    expect(files).toEqual(['b.mts'])
  })

  // perms don't apply as root / on Windows → skip there
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'records read-error for an unreadable candidate file',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'walker-perm-'))
      const file = join(dir, 'locked.ts')
      writeFileSync(file, 'export const x = 1\n')
      chmodSync(file, 0o000)
      try {
        expect(walk(dir).skipped.find((s) => s.path === 'locked.ts')?.reason).toBe('read-error')
      } finally {
        chmodSync(file, 0o644)
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})

describe('ingest defaults (TKT-104)', () => {
  it('maps TS extensions to the typescript lang', () => {
    expect(langForExtension('.ts')).toBe('typescript')
    expect(langForExtension('.mts')).toBe('typescript')
    expect(langForExtension('.cts')).toBe('typescript')
  })

  it('maps a non-TS extension to "unknown"', () => {
    expect(langForExtension('.py')).toBe('unknown')
    expect(langForExtension('')).toBe('unknown')
  })
})
