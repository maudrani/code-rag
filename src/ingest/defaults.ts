/**
 * L1 ingest defaults (TKT-104) — the DOMAIN plug-in of the agnostic walker
 * (core mechanism + injected domain, ADR-001). M1 = TypeScript only.
 */

/** Extensions selected for indexing. `.tsx` deferred (needs the tsx grammar). */
export const DEFAULT_EXTENSIONS: readonly string[] = ['.ts', '.mts', '.cts']

/** Directories never recursed into (build output, vcs, deps). */
export const DEFAULT_IGNORE_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'out',
  '.next',
  '.cache',
  '.turbo',
])

/** 1 MB per-file cap — bounds memory; oversized files are skipped, not truncated. */
export const DEFAULT_MAX_FILE_BYTES = 1_000_000

const TS_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.mts', '.cts'])

/** Map a file extension to its tree-sitter language (M1: TypeScript only). */
export function langForExtension(ext: string): string {
  return TS_EXTENSIONS.has(ext) ? 'typescript' : 'unknown'
}

/** Declaration files (`*.d.ts` / `*.d.mts` / `*.d.cts`) — type-only, skipped by default. */
export function isDeclarationFile(name: string): boolean {
  return /\.d\.[mc]?ts$/.test(name)
}
