/**
 * Warm-restart manifest (FTR-57, adopts peripheral-hub TKT-507 decision_2026_06_30).
 *
 * The freshness signal is STAT-ONLY — `(mtime, size)` — never a content hash. TKT-507's lesson: a
 * content hash needs to READ the file, and the read (+ tree-sitter parse + dense embed) is exactly the
 * dominant cost a warm restart must skip. So a file is UNCHANGED iff its stat matches the manifest; a
 * changed mtime OR size re-indexes it. `diffManifest` is PURE (unit-assertable without a filesystem);
 * `statFiles` is the thin fs adapter that produces `FileStat[]` from a discovered file list.
 */
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/** A file's stat-only freshness signal. */
export interface FileStat {
  path: string
  mtimeMs: number
  size: number
}

/** A persisted manifest row: the file's stat at index time + the chunk ids it produced. */
export interface ManifestEntry extends FileStat {
  chunkIds: string[]
}

/**
 * The freshness partition of the current file set against the persisted manifest.
 * - `unchanged` — stat matches; reuse the stored chunks+vectors (carries their ids).
 * - `changed`   — new (absent from the manifest) OR modified (mtime/size differ); re-chunk + re-embed.
 * - `deleted`   — in the manifest but no longer on disk; drop its chunks.
 */
export interface ManifestDiff {
  unchanged: ManifestEntry[]
  changed: FileStat[]
  deleted: ManifestEntry[]
}

/** Partition `current` against `manifest` by the stat-only signal. Pure + deterministic. */
export function diffManifest(
  current: readonly FileStat[],
  manifest: readonly ManifestEntry[],
): ManifestDiff {
  const byPath = new Map(manifest.map((e) => [e.path, e]))
  const unchanged: ManifestEntry[] = []
  const changed: FileStat[] = []
  const seen = new Set<string>()
  for (const file of current) {
    seen.add(file.path)
    const prev = byPath.get(file.path)
    if (prev !== undefined && prev.mtimeMs === file.mtimeMs && prev.size === file.size) {
      unchanged.push(prev)
    } else {
      changed.push(file) // new or modified — the stat differs (or there was no prior stat)
    }
  }
  const deleted = manifest.filter((e) => !seen.has(e.path))
  return { unchanged, changed, deleted }
}

/**
 * Stat a discovered file list into `FileStat[]` (mtimeMs + size). `paths` are the manifest KEYS
 * (kept verbatim on `FileStat.path` so they match `chunk.path`); when `root` is given the actual file
 * stat'd is `join(root, path)` — ingest-chunk emits ROOT-RELATIVE paths, so the caller passes the
 * ingest root to reach them. A path that cannot be stat'd (absent / unreadable) is skipped — a
 * manifest entry for it then falls to `deleted` in the diff. This is the ONLY touch of a source file
 * on the warm path, and it is a `stat`, never an open (stat-only signal, TKT-507).
 */
export async function statFiles(paths: readonly string[], root = ''): Promise<FileStat[]> {
  const out: FileStat[] = []
  for (const path of paths) {
    try {
      const s = await stat(root ? join(root, path) : path)
      out.push({ path, mtimeMs: s.mtimeMs, size: s.size })
    } catch {
      // absent / unreadable — omit; diffManifest treats a manifest entry for it as deleted
    }
  }
  return out
}
