/**
 * L1 + L2 public entry (TKT-105) — walk a repo → parse → chunk-by-symbol →
 * `Chunk[]`. Composes the ingest walker (L1) with the tree-sitter chunker +
 * structuralRefs (L2). Synchronous + deterministic: the walker's sorted file
 * order yields stable chunk ids across runs and machines.
 *
 * `path` on each chunk is relative to `root` (the caller's ingest root), so the
 * self-index corpus (ADR-006) reads as `src/contracts/engine.ts` etc. when the
 * repo root is passed. A file that fails to read is recorded in `skipped`
 * (reason 'read-error') and never aborts the run; tree-sitter is error-tolerant,
 * so a syntactically broken file still yields its best-effort chunks.
 *
 * The master-owned membrane composes the contract `IngestReport`
 * (filesIndexed/chunks/durationMs, `src/contracts/engine.ts`) from this result
 * plus L3 indexing; `ingest()` there can wrap this sync call in a Promise.
 */
import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Chunk } from '../contracts/chunk.js'
import { langForExtension } from '../ingest/defaults.js'
import { type SkippedFile, type WalkOptions, walk } from '../ingest/walker.js'
import { chunkTree } from './chunker.js'
import { createParser } from './parser.js'

export { chunkSource, chunkTree } from './chunker.js'
export { createParser, initParser, parse } from './parser.js'
export {
  buildImportTable,
  extractStructuralRefs,
} from './structural-refs.js'

export interface IngestChunkResult {
  chunks: Chunk[]
  files: string[]
  skipped: SkippedFile[]
}

/** Walk + parse + chunk a repo (L1+L2). Requires {@link initParser} first. */
export function ingestAndChunk(root: string, options?: WalkOptions): IngestChunkResult {
  const { files, skipped } = walk(root, options)
  const parser = createParser() // init-once / parse-many
  const chunks: Chunk[] = []
  const errors: SkippedFile[] = []

  for (const rel of files) {
    try {
      const source = readFileSync(join(root, rel), 'utf8')
      const tree = parser.parse(source)
      chunks.push(...chunkTree(tree, source, rel, langForExtension(extname(rel))))
    } catch {
      errors.push({ path: rel, reason: 'read-error' })
    }
  }

  return { chunks, files, skipped: [...skipped, ...errors] }
}
