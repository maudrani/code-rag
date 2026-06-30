/**
 * L1 ingest telemetry (TKT-107, FTR-12) — a pure projection of the ingest result onto
 * the master-owned `IngestTelemetry` contract (`src/contracts/telemetry.ts`). The
 * membrane holds it in `Observable.telemetry().ingest`; surface reads it via
 * `code-rag stats --layer ingest`. Pure — the caller (membrane) measures `durationMs`.
 *
 * The contract invariant `filesWalked === filesIndexed + skipped + errors.length` holds
 * BY CONSTRUCTION here, and equals the true candidate total the walker considered:
 *  - `errors`  = the `read-error` entries (a file the walker or the parse-loop could
 *    not read). `read-error`s among the included `files` reduce `filesIndexed`.
 *  - `skipped` = the deliberate non-error exclusions (too-large / binary / declaration).
 *  - `filesIndexed` = included files minus the read-errors among them.
 *  - `byLang` counts the INDEXED files by language (Σ byLang === filesIndexed).
 */
import { extname } from 'node:path'
import type { IngestTelemetry } from '../contracts/telemetry.js'
import { langForExtension } from './defaults.js'
import type { SkippedFile } from './walker.js'

export interface IngestTelemetryInput {
  /** walker-included candidate files (repo-relative), as `ingestAndChunk` returns. */
  files: readonly string[]
  /** walker skips + parse read-errors — the merged `ingestAndChunk` `skipped`. */
  skipped: readonly SkippedFile[]
  /** total chunks emitted (L2). */
  chunkCount: number
  /** wall time of the walk + parse + chunk pass (measured by the caller). */
  durationMs: number
}

export function collectIngestTelemetry(input: IngestTelemetryInput): IngestTelemetry {
  const included = new Set(input.files)
  const readErrors = input.skipped.filter((s) => s.reason === 'read-error')
  const nonErrorSkips = input.skipped.filter((s) => s.reason !== 'read-error')
  // Only read-errors among the INCLUDED files reduce filesIndexed (walker-stage
  // read-errors were never included), keeping filesWalked equal to the true total.
  const includedReadErrors = readErrors.filter((s) => included.has(s.path)).length
  const filesIndexed = input.files.length - includedReadErrors
  const erroredPaths = new Set(readErrors.map((s) => s.path))
  const errors = readErrors.map((s) => `${s.path}: ${s.reason}`).sort()

  const byLang: Record<string, number> = {}
  for (const f of input.files) {
    if (erroredPaths.has(f)) continue // a read-error among files is not indexed
    const lang = langForExtension(extname(f))
    byLang[lang] = (byLang[lang] ?? 0) + 1
  }

  const skipped = nonErrorSkips.length
  return {
    filesWalked: filesIndexed + skipped + errors.length,
    filesIndexed,
    skipped,
    chunks: input.chunkCount,
    byLang,
    errors,
    durationMs: input.durationMs,
  }
}
