/**
 * L1 ingest walker (TKT-104, ADR-001) — agnostic recursive walk + domain
 * filter (globs/langs in `defaults.ts`). Safe by construction: per-file size
 * cap, binary sniff, skips ignored dirs (node_modules/.git/dist/…), declaration
 * files, and NEVER follows symlinks (loop + escape-root guard). Output is
 * deterministic (sorted) and repo-relative (posix), so downstream chunk ids are
 * stable across runs and machines.
 *
 * Returns an internal {@link WalkResult}, NOT the contract `IngestReport`
 * (`src/contracts/engine.ts`) — that summary (filesIndexed/chunks/durationMs)
 * spans L1→L3 and is assembled by the master-owned membrane.
 */
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import {
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE_DIRS,
  DEFAULT_MAX_FILE_BYTES,
  isDeclarationFile,
} from './defaults.js'

export type SkipReason = 'too-large' | 'binary' | 'declaration' | 'read-error'

export interface SkippedFile {
  path: string
  reason: SkipReason
}

export interface WalkStats {
  filesConsidered: number
  dirsWalked: number
  included: number
  skipped: number
}

export interface WalkResult {
  /** repo-relative posix paths of included code files, sorted */
  files: string[]
  /** candidate files (matched extension) excluded, with reason, sorted */
  skipped: SkippedFile[]
  stats: WalkStats
}

export interface WalkOptions {
  extensions?: readonly string[]
  ignoreDirs?: Iterable<string>
  maxFileBytes?: number
  /** include `*.d.ts` declaration files (default false) */
  includeDeclarations?: boolean
}

const BINARY_SNIFF_BYTES = 8192

/** A NUL byte in the first 8 KB marks a binary file (defence-in-depth beyond the extension filter). */
function looksBinary(absPath: string): boolean {
  const buffer = Buffer.allocUnsafe(BINARY_SNIFF_BYTES)
  const fd = openSync(absPath, 'r')
  try {
    const bytesRead = readSync(fd, buffer, 0, BINARY_SNIFF_BYTES, 0)
    return buffer.subarray(0, bytesRead).includes(0)
  } finally {
    closeSync(fd)
  }
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Walk `root`, enumerating code files per the (domain) options. Synchronous + deterministic. */
export function walk(root: string, options: WalkOptions = {}): WalkResult {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS)
  const ignoreDirs = new Set(options.ignoreDirs ?? DEFAULT_IGNORE_DIRS)
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const includeDeclarations = options.includeDeclarations ?? false

  const files: string[] = []
  const skipped: SkippedFile[] = []
  let filesConsidered = 0
  let dirsWalked = 0

  const toRel = (abs: string): string => relative(root, abs).split(sep).join('/')

  const visitDir = (dir: string): void => {
    dirsWalked++
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      byString(a.name, b.name),
    )
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue // never follow symlinks
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) visitDir(abs)
        continue
      }
      if (!entry.isFile()) continue
      if (!extensions.has(extname(entry.name))) continue // not a candidate → no noise in skipped[]
      filesConsidered++
      const rel = toRel(abs)
      if (!includeDeclarations && isDeclarationFile(entry.name)) {
        skipped.push({ path: rel, reason: 'declaration' })
        continue
      }
      try {
        if (statSync(abs).size > maxFileBytes) {
          skipped.push({ path: rel, reason: 'too-large' })
          continue
        }
        if (looksBinary(abs)) {
          skipped.push({ path: rel, reason: 'binary' })
          continue
        }
      } catch {
        skipped.push({ path: rel, reason: 'read-error' })
        continue
      }
      files.push(rel)
    }
  }

  visitDir(root)
  files.sort(byString)
  skipped.sort((a, b) => byString(a.path, b.path))
  return {
    files,
    skipped,
    stats: { filesConsidered, dirsWalked, included: files.length, skipped: skipped.length },
  }
}
