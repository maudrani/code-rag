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
import { isCodeShaped, shortNameOf } from './symbols.js'

/** In-memory structural index over a Chunk[] corpus (the call + import graph). */
export interface StructuralIndex {
  /** chunk id → Chunk. */
  readonly byId: ReadonlyMap<string, Chunk>
  /** symbol name → chunk ids that DEFINE that symbol (a symbol may be defined more than once). */
  readonly definers: ReadonlyMap<string, readonly string[]>
  /**
   * SHORT name (last descriptor) → defining chunk ids. The method-call resolution bucket (a method
   * `o.m()` is keyed `Class.m` by the chunker but called as the bare `m`). Exposed so the
   * definition-boost (FTR-22) can resolve a query's symbol by short name, reusing the same map the
   * call graph already builds. (peripheral codegraph resolver.ts `byName`/`byQualifiedName` cascade.)
   */
  readonly byName: ReadonlyMap<string, readonly string[]>
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

/** The in-corpus files (ext-less paths) a chunk imports via RELATIVE specifiers (bare = external). */
function importedPaths(chunk: Chunk): Set<string> {
  const paths = new Set<string>()
  for (const spec of chunk.structuralRefs.imports) {
    const key = resolveRelativeImport(chunk.path, spec)
    if (key !== undefined) paths.add(key)
  }
  return paths
}

/** Build the structural index (call + import graph) from a Chunk[] corpus. */
export function buildStructuralIndex(chunks: readonly Chunk[]): StructuralIndex {
  const byId = new Map<string, Chunk>()
  const definers = new Map<string, string[]>()
  const byName = new Map<string, string[]>() // SHORT name (last descriptor) → defining chunk ids (A1)
  const byPathNoExt = new Map<string, string[]>() // file (ext-less) → its chunk ids

  for (const chunk of chunks) {
    byId.set(chunk.id, chunk)
    const defs = definers.get(chunk.symbol)
    if (defs === undefined) definers.set(chunk.symbol, [chunk.id])
    else defs.push(chunk.id)
    const short = shortNameOf(chunk.symbol)
    const named = byName.get(short)
    if (named === undefined) byName.set(short, [chunk.id])
    else named.push(chunk.id)
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
    // call edges: resolve a callee SYMBOL name to its defining chunk(s) —
    //   1. exact full-symbol match: a direct call `f()` whose captured name IS the symbol; else
    //   2. short-name match: a method call `o.m()` captures the bare property `m`, while the chunker
    //      keys the definer as `Class.m` (peripheral codegraph short-name resolution, GAP A1).
    // A multi-definer name is disambiguated against the importer's import table, keeping only the
    // imported definer; with nothing to resolve it, all are kept (peripheral `exact`/`probable`/
    // `ambiguous` confidence — codegraph 05-API-SURFACE §E.4, GAP A3).
    const imported = importedPaths(chunk)
    for (const callee of chunk.structuralRefs.calls) {
      let targets = definers.get(callee) ?? byName.get(callee)
      if (targets === undefined) continue // dangling / external symbol — no edge
      if (targets.length > 1) {
        const disambiguated = targets.filter((id) => {
          const def = byId.get(id)
          return def !== undefined && imported.has(stripExt(def.path))
        })
        if (disambiguated.length > 0) targets = disambiguated // import table pruned to the import
      }
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

  return { byId, definers, byName, neighbours }
}

/**
 * Resolve captured query symbols (symbols.ts) to their defining chunk ids — the NL->definition
 * bridge for the definition-boost (FTR-22). Cascade per token:
 *   1. EXACT full-symbol match (`definers`) — `useChatStream`, `Auth.login`, `rrfFuse`. Always
 *      trusted: the query literally names a defined symbol. Overloads (>1 definer) pin all.
 *   2. else, for a CODE-SHAPED token only (isCodeShaped), an UNAMBIGUOUS short-name match
 *      (`byName`, exactly one definer) — covers a naming mismatch like `db.prepare` -> the method
 *      keyed `Database.prepare`. Ambiguous short names (≥2 definers) pin NONE — honesty over recall.
 * A slash-path token is skipped (path->chunk resolution is deferred past M1). A plain word resolves
 * ONLY by the exact path, so prose ("how does login happen") never fuzzily pins a method.
 */
export function resolveDefinitions(symbols: readonly string[], index: StructuralIndex): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const add = (id: string): void => {
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  for (const token of symbols) {
    const exact = index.definers.get(token)
    if (exact !== undefined && exact.length > 0) {
      for (const id of exact) add(id)
      continue
    }
    if (token.includes('/') || !isCodeShaped(token)) continue
    const short = index.byName.get(shortNameOf(token))
    if (short !== undefined && short.length === 1) {
      const only = short[0]
      if (only !== undefined) add(only)
    }
  }
  return ids
}

/**
 * Pin resolved definition chunks at the FRONT (rank 0..) of the structural leg's candidate list —
 * the distance-0 "anchor leads" injection (FTR-22; peripheral codegraph-lens adapter.ts:172-174).
 * At rank 0 the definition earns the structural leg's largest RRF term (`w/(k+1)`) and leads its
 * own deps, so it survives fusion into top-k without a contract change (it rides the structural
 * leg, not a new score).
 *
 * - DEDUPES: a pinned id already present among `candidates` is removed from the tail, so rrfFuse
 *   (which accumulates per-occurrence within a leg) counts it ONCE, at rank 0.
 * - Pins score strictly above every existing candidate, keeping the list a valid score-desc order.
 * - Defensive: a definition id absent from the corpus is dropped. No definitions -> a no-op copy.
 */
export function pinDefinitions(
  candidates: readonly LegCandidate[],
  defChunkIds: readonly string[],
  index: StructuralIndex,
): LegCandidate[] {
  const pins = defChunkIds.filter((id) => index.byId.has(id))
  if (pins.length === 0) return [...candidates]
  const pinSet = new Set(pins)
  const topScore = candidates.reduce((max, c) => Math.max(max, c.score), 0)
  const pinned: LegCandidate[] = pins.map((id, i) => ({
    chunkId: id,
    score: topScore + pins.length - i, // strictly > every candidate; preserves pin order
  }))
  const rest = candidates.filter((c) => !pinSet.has(c.chunkId))
  return [...pinned, ...rest]
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
