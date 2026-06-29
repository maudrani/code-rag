/**
 * L4 structural leg — the code-specific third RRF leg (ADR-003).
 *
 * Pure semantic similarity misses what matters most for code: the call graph and
 * the import graph. This leg surfaces chunks that are ONE-HOP call/import neighbours
 * of query-matched "seed" symbols — chunks BM25 + dense would not rank on their own.
 *
 * Two pure, deterministic units (no I/O — unit-assertable):
 *   buildStructuralIndex(chunks)        → the call/import graph derived from `structuralRefs`
 *   structuralExpand(seeds, index, opts) → ranked one-hop neighbours of the seeds
 *
 * Edges (GAP-S1):
 *   - calls:   a chunk's `structuralRefs.calls` (callee SYMBOL names) resolve precisely to the
 *              chunk(s) that DEFINE each symbol — the precise call graph.
 *   - imports: `structuralRefs.imports` (module STRINGS). RELATIVE specifiers (./ ../) resolve to
 *              in-corpus chunks by path; BARE specifiers (`better-sqlite3`) are external ⇒ no edge
 *              (ADR-004: no cross-file resolver at M1).
 * Edges are UNDIRECTED one-hop (GAP-S4): callees+callers, imported+importers.
 */
import type { Chunk } from '../contracts/chunk.js'
import type { LegCandidate } from './fuse.js'

/** In-memory structural index over a Chunk[] corpus (the call + import graph). */
export interface StructuralIndex {
  /** chunk id → Chunk. */
  readonly byId: ReadonlyMap<string, Chunk>
  /** symbol name → chunk ids that DEFINE that symbol (a symbol may be defined more than once). */
  readonly definers: ReadonlyMap<string, readonly string[]>
  /** chunk id → its one-hop neighbour chunk ids (undirected, deduped, self excluded). */
  readonly neighbours: ReadonlyMap<string, ReadonlySet<string>>
}

export interface StructuralExpandOptions {
  /** include the seed chunks themselves in the output. Default false (the leg surfaces NEIGHBOURS). */
  includeSeeds?: boolean
}

const CODE_EXT = /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/

/** Drop a trailing code extension so `src/b.ts` and an import `./b.js` resolve to one key. */
function stripExt(path: string): string {
  return path.replace(CODE_EXT, '')
}

/** Normalise a POSIX-style path, collapsing `.` and `..` segments. */
function normalizePosix(path: string): string {
  const out: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join('/')
}

/**
 * Resolve a relative import specifier against the importer's path to an extension-less key.
 * Bare/external specifiers (`better-sqlite3`, `@scope/pkg`) return undefined — no in-corpus edge.
 */
function resolveRelativeImport(importerPath: string, spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined
  const slash = importerPath.lastIndexOf('/')
  const dir = slash >= 0 ? importerPath.slice(0, slash) : ''
  return stripExt(normalizePosix(`${dir}/${spec}`))
}

/** Build the structural index (call + import graph) from a Chunk[] corpus. */
export function buildStructuralIndex(chunks: readonly Chunk[]): StructuralIndex {
  const byId = new Map<string, Chunk>()
  const definers = new Map<string, string[]>()
  const byPathNoExt = new Map<string, string[]>() // file (ext-less) → its chunk ids

  for (const chunk of chunks) {
    byId.set(chunk.id, chunk)
    const defs = definers.get(chunk.symbol)
    if (defs === undefined) definers.set(chunk.symbol, [chunk.id])
    else defs.push(chunk.id)
    const key = stripExt(chunk.path)
    const sameFile = byPathNoExt.get(key)
    if (sameFile === undefined) byPathNoExt.set(key, [chunk.id])
    else sameFile.push(chunk.id)
  }

  const neighbours = new Map<string, Set<string>>()
  const link = (a: string, b: string): void => {
    if (a === b) return // never a self-edge
    let sa = neighbours.get(a)
    if (sa === undefined) {
      sa = new Set<string>()
      neighbours.set(a, sa)
    }
    sa.add(b)
    let sb = neighbours.get(b)
    if (sb === undefined) {
      sb = new Set<string>()
      neighbours.set(b, sb)
    }
    sb.add(a)
  }

  for (const chunk of chunks) {
    // call edges: callee symbol name → the chunk(s) that define it (precise within the corpus)
    for (const callee of chunk.structuralRefs.calls) {
      const targets = definers.get(callee)
      if (targets === undefined) continue // dangling / external symbol — no edge
      for (const target of targets) link(chunk.id, target)
    }
    // import edges: relative module specifier → the imported file's chunks (bare = external, skipped)
    for (const spec of chunk.structuralRefs.imports) {
      const key = resolveRelativeImport(chunk.path, spec)
      if (key === undefined) continue
      const targets = byPathNoExt.get(key)
      if (targets === undefined) continue
      for (const target of targets) link(chunk.id, target)
    }
  }

  return { byId, definers, neighbours }
}

/**
 * Rank the one-hop neighbours of the seed chunks.
 * Score = number of distinct seeds that reference the neighbour (structural centrality).
 * Returns LegCandidate[] sorted desc by score, ties broken by chunk id asc (deterministic).
 */
export function structuralExpand(
  seedChunkIds: readonly string[],
  index: StructuralIndex,
  options: StructuralExpandOptions = {},
): LegCandidate[] {
  const includeSeeds = options.includeSeeds ?? false
  const seeds = new Set<string>()
  for (const id of seedChunkIds) if (index.byId.has(id)) seeds.add(id) // dedup + drop unknown seeds

  const counts = new Map<string, number>()
  for (const seed of seeds) {
    const ns = index.neighbours.get(seed)
    if (ns === undefined) continue
    for (const neighbour of ns) {
      if (!includeSeeds && seeds.has(neighbour)) continue
      counts.set(neighbour, (counts.get(neighbour) ?? 0) + 1)
    }
  }

  const candidates: LegCandidate[] = []
  for (const [chunkId, score] of counts) candidates.push({ chunkId, score })
  candidates.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
  return candidates
}
