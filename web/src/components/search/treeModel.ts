import type { SymbolEntry } from '../../contract'

/**
 * Pure corpus-tree builder for the assisted-search browser (FTR-56 P4). Turns a FLAT list of
 * `SymbolEntry` (the GET /symbols wire) into a nested directory tree, deriving the filesystem shape
 * from each symbol's `path` (split on '/'). This is why the escalated endpoint is a flat array, not a
 * bespoke /tree: ONE payload powers both the tree browser (this) and the autocomplete (a flat filter).
 *
 * Deterministic + total: no I/O, no Date/random. Dirs sort before files, both alphabetical; a file's
 * symbols sort by start line. Shared path prefixes collapse into the same dir (never duplicated).
 */

export interface TreeFile {
  type: 'file'
  /** the leaf filename (last path segment). */
  name: string
  /** the full path (the SymbolEntry.path). */
  path: string
  /** every symbol indexed from this file. */
  symbols: SymbolEntry[]
}

export interface TreeDir {
  type: 'dir'
  /** this directory's own segment name. */
  name: string
  /** the path from the root to (and including) this directory. */
  path: string
  children: TreeNode[]
}

export type TreeNode = TreeDir | TreeFile

interface MutDir {
  dirs: Map<string, MutDir>
  files: Map<string, SymbolEntry[]>
}

function emptyDir(): MutDir {
  return { dirs: new Map(), files: new Map() }
}

/** Materialize a mutable dir into sorted, immutable tree nodes (dirs first, then files). */
function materialize(dir: MutDir, prefix: string): TreeNode[] {
  const dirNodes: TreeDir[] = [...dir.dirs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, child]) => {
      const path = prefix ? `${prefix}/${name}` : name
      return { type: 'dir', name, path, children: materialize(child, path) }
    })

  const fileNodes: TreeFile[] = [...dir.files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, symbols]) => {
      const path = prefix ? `${prefix}/${name}` : name
      const sorted = [...symbols].sort((x, y) => x.span.startLine - y.span.startLine)
      return { type: 'file', name, path, symbols: sorted }
    })

  return [...dirNodes, ...fileNodes]
}

/** Build the nested corpus tree from the flat symbol list. Empty in -> empty out. */
export function buildCorpusTree(symbols: SymbolEntry[]): TreeNode[] {
  const root = emptyDir()
  for (const entry of symbols) {
    const segments = entry.path.split('/').filter((s) => s.length > 0)
    if (segments.length === 0) {
      continue // a pathless/garbage entry never corrupts the tree
    }
    let dir = root
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]
      let next = dir.dirs.get(seg)
      if (!next) {
        next = emptyDir()
        dir.dirs.set(seg, next)
      }
      dir = next
    }
    const fileName = segments[segments.length - 1]
    const bucket = dir.files.get(fileName)
    if (bucket) {
      bucket.push(entry)
    } else {
      dir.files.set(fileName, [entry])
    }
  }
  return materialize(root, '')
}

/** Count the leaf files reachable in a tree (for the "N symbols · M files" summary). */
export function countFiles(nodes: TreeNode[]): number {
  let total = 0
  for (const node of nodes) {
    total += node.type === 'file' ? 1 : countFiles(node.children)
  }
  return total
}
