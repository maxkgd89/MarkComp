import { useMemo, useState } from 'react'
import type { HeadingNode, ParsedDocument } from '../lib/markdown'
import type { MatchResult } from '../lib/matching'

interface StructurePanelProps {
  document: ParsedDocument
  matches: Map<string, MatchResult>
  selectedId: string | null
  onSelect: (node: HeadingNode) => void
}

export function StructurePanel({ document, matches, selectedId, onSelect }: StructurePanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const duplicates = useMemo(() => {
    const counts = new Map<string, number>()
    for (const heading of document.headings) {
      const key = heading.displayText.toLowerCase()
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const occurrence = new Map<string, number>()
    const result = new Map<string, { count: number; index: number }>()
    for (const heading of document.headings) {
      const key = heading.displayText.toLowerCase()
      if (!key) continue
      const count = counts.get(key) ?? 0
      if (count <= 1) continue
      const index = (occurrence.get(key) ?? 0) + 1
      occurrence.set(key, index)
      result.set(heading.id, { count, index })
    }
    return result
  }, [document])

  const documentWarnings = useMemo(
    () => document.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning'),
    [document]
  )

  const warningCount = useMemo(() => {
    let total = documentWarnings.length
    for (const heading of document.headings) {
      total += heading.diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'warning'
      ).length
    }
    return total
  }, [document, documentWarnings])

  const toggle = (id: string): void => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside className="structure-panel">
      <div className="panel-title">
        <span>Structure</span>
        {warningCount > 0 ? (
          <span
            className="diag-count"
            title={documentWarnings.map((diagnostic) => diagnostic.message).join('\n')}
          >
            {'\u26A0'} {warningCount}
          </span>
        ) : null}
      </div>

      {documentWarnings.length > 0 ? (
        <div
          className="structure-diagnostics"
          title={documentWarnings.map((diagnostic) => diagnostic.message).join('\n')}
        >
          {documentWarnings[0].message}
          {documentWarnings.length > 1 ? ` (+${documentWarnings.length - 1})` : ''}
        </div>
      ) : null}

      {document.headings.length === 0 ? (
        <div className="empty">Open a Markdown file to see its headings.</div>
      ) : (
        <div className="tree">
          {document.roots.map((heading) => (
            <TreeRow
              key={heading.id}
              node={heading}
              depth={0}
              collapsed={collapsed}
              selectedId={selectedId}
              duplicates={duplicates}
              matches={matches}
              onToggle={toggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </aside>
  )
}

interface TreeRowProps {
  node: HeadingNode
  depth: number
  collapsed: Set<string>
  selectedId: string | null
  duplicates: Map<string, { count: number; index: number }>
  matches: Map<string, MatchResult>
  onToggle: (id: string) => void
  onSelect: (node: HeadingNode) => void
}

function TreeRow({
  node,
  depth,
  collapsed,
  selectedId,
  duplicates,
  matches,
  onToggle,
  onSelect
}: TreeRowProps) {
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(node.id)
  const isSelected = selectedId === node.id
  const duplicate = duplicates.get(node.id)
  const match = matches.get(node.id)
  const unmatched = match ? match.revisionId === null : true

  const rowTitle = [
    `H${node.level} · line ${node.startLine + 1}`,
    unmatched ? 'No matching section in the revision' : '',
    ...node.diagnostics.map((diagnostic) => diagnostic.message)
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <>
      <div
        className={`tree-row level-${node.level}${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node)}
        title={rowTitle}
      >
        {hasChildren ? (
          <button
            type="button"
            className="twisty"
            aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
            onClick={(event) => {
              event.stopPropagation()
              onToggle(node.id)
            }}
          >
            {isCollapsed ? '\u25B8' : '\u25BE'}
          </button>
        ) : (
          <span className="twisty placeholder" />
        )}
        <span className="h-level">H{node.level}</span>
        <span className="h-text">{node.displayText || '(empty heading)'}</span>
        {duplicate ? (
          <span
            className="h-dup"
            title={`Duplicate heading ${duplicate.index} of ${duplicate.count}`}
          >
            {duplicate.index}
          </span>
        ) : null}
        {unmatched ? (
          <span className="h-unmatched" title="No matching section in the revision">
            {'\u25CC'}
          </span>
        ) : null}
        {node.diagnostics.length > 0 ? (
          <span
            className="h-warn"
            title={node.diagnostics.map((diagnostic) => diagnostic.message).join('\n')}
          >
            {'\u26A0'}
          </span>
        ) : null}
      </div>
      {hasChildren && !isCollapsed
        ? node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              selectedId={selectedId}
              duplicates={duplicates}
              matches={matches}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))
        : null}
    </>
  )
}
