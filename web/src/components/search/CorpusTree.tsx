import { ChevronDown, ChevronRight, FileCode, Folder, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import type { SymbolEntry } from '../../contract'
import { buildCorpusTree, type TreeNode } from './treeModel'

interface CorpusTreeProps {
  symbols: SymbolEntry[]
  onSelect: (entry: SymbolEntry) => void
}

/**
 * CorpusTree — a filesystem browser over the indexed corpus (FTR-56 P4). Derives the directory tree
 * from the flat GET /symbols list (buildCorpusTree) so the operator can EXPLORE before searching.
 * Directories start expanded (the shape is the point); files start collapsed and reveal their
 * symbols on demand; selecting a symbol prefills + runs the deterministic search.
 *
 * WAI-ARIA tree pattern: neutral <div> elements carry role=tree / role=treeitem / role=group (a <ul>
 * would collide with the ARIA roles). Each interactive affordance is a real <button> (keyboard-
 * focusable, Enter/Space); treeitems are tabIndex=-1 wrappers.
 */
export function CorpusTree({ symbols, onSelect }: CorpusTreeProps) {
  const nodes = buildCorpusTree(symbols)
  if (nodes.length === 0) {
    return <p className="px-1 py-2 text-sm text-muted-foreground">No files in the corpus index.</p>
  }
  return (
    <div role="tree" aria-label="Corpus files" className="text-sm">
      {nodes.map((node) => (
        <TreeNodeItem key={node.path} node={node} depth={0} onSelect={onSelect} />
      ))}
    </div>
  )
}

function TreeNodeItem({
  node,
  depth,
  onSelect,
}: {
  node: TreeNode
  depth: number
  onSelect: (entry: SymbolEntry) => void
}) {
  // Directories default open (reveal the structure); files default closed (drill in on demand).
  const [expanded, setExpanded] = useState(node.type === 'dir')
  const indent = { paddingLeft: `${depth * 0.85 + 0.25}rem` }
  const Chevron = expanded ? ChevronDown : ChevronRight

  if (node.type === 'dir') {
    const FolderIcon = expanded ? FolderOpen : Folder
    return (
      <div role="treeitem" aria-expanded={expanded} aria-label={node.name} tabIndex={-1}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={indent}
          className="flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left hover:bg-accent/60"
        >
          <Chevron className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {expanded ? (
          // biome-ignore lint/a11y/useSemanticElements: role=group is the ARIA tree nested-itemset container; <fieldset> is for form controls, not tree nodes
          <div role="group">
            {node.children.map((child) => (
              <TreeNodeItem key={child.path} node={child} depth={depth + 1} onSelect={onSelect} />
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  // file node — expands to its symbols
  return (
    <div role="treeitem" aria-expanded={expanded} aria-label={node.name} tabIndex={-1}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={indent}
        className="flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left hover:bg-accent/60"
      >
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <FileCode className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{node.name}</span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {node.symbols.length}
        </span>
      </button>
      {expanded ? (
        // biome-ignore lint/a11y/useSemanticElements: role=group is the ARIA tree nested-itemset container; <fieldset> is for form controls, not tree nodes
        <div role="group">
          {node.symbols.map((entry) => (
            <div
              key={`${entry.path}#${entry.symbol}@${entry.span.startLine}`}
              role="treeitem"
              tabIndex={-1}
            >
              <button
                type="button"
                onClick={() => onSelect(entry)}
                style={{ paddingLeft: `${(depth + 1) * 0.85 + 0.25}rem` }}
                className="flex w-full items-center justify-between gap-3 rounded-sm py-1 pr-2 text-left hover:bg-accent"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate font-mono text-[13px]">{entry.symbol}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    :{entry.span.startLine}
                  </span>
                </span>
                <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-secondary-foreground">
                  {entry.kind}
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
