import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type * as Monaco from 'monaco-editor'
import { MonacoEditor } from './components/MonacoEditor'
import { StructurePanel } from './components/StructurePanel'
import { DiffView, type DiffViewMode } from './components/DiffView'
import { parseMarkdownDocument, type HeadingNode } from './lib/markdown'
import { matchHeadings } from './lib/matching'
import { computeDiff, resolveMappedLine } from './lib/diff'
import { attachScrollSync } from './lib/scrollSync'
import { useDebouncedValue } from './lib/useDebouncedValue'

type ViewMode = 'panes' | DiffViewMode

const MIN_LEFT = 180
const MIN_MID = 280

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function suggestRevisionName(originalPath: string | null): string {
  if (!originalPath) return 'revision.md'
  const base = originalPath.replace(/\.(md|markdown|txt)$/i, '')
  return `${base}.revised.md`
}

interface DragState {
  kind: 'left' | 'mid'
  startX: number
  leftW: number
  midW: number
}

export default function App() {
  const [originalPath, setOriginalPath] = useState<string | null>(null)
  const [originalContent, setOriginalContent] = useState('')
  const [revisionContent, setRevisionContent] = useState('')
  const [revisionPath, setRevisionPath] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState('Open a Markdown file to begin.')
  const [viewMode, setViewMode] = useState<ViewMode>('panes')
  const [syncEnabled, setSyncEnabled] = useState(true)

  const [leftW, setLeftW] = useState(280)
  const [midW, setMidW] = useState(520)

  const originalEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const revisionEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
  const changeIndexRef = useRef(-1)
  const modeRef = useRef<ViewMode>('panes')
  const dragRef = useRef<DragState | null>(null)
  const syncEnabledRef = useRef(true)

  const [paneEditors, setPaneEditors] = useState<{
    original: Monaco.editor.IStandaloneCodeEditor | null
    revision: Monaco.editor.IStandaloneCodeEditor | null
  }>({ original: null, revision: null })

  modeRef.current = viewMode
  syncEnabledRef.current = syncEnabled

  const originalDoc = useMemo(
    () => parseMarkdownDocument(originalContent, 'original'),
    [originalContent]
  )

  const debouncedRevision = useDebouncedValue(revisionContent, 200)
  // Right after a load the revision equals the original; use it directly so the
  // diff never flashes against the previous (stale) buffer during debounce.
  const effectiveRevision =
    revisionContent === originalContent ? revisionContent : debouncedRevision

  const revisionDoc = useMemo(
    () => parseMarkdownDocument(effectiveRevision, 'revision'),
    [effectiveRevision]
  )

  const matches = useMemo(
    () => matchHeadings(originalDoc, revisionDoc),
    [originalDoc, revisionDoc]
  )

  const revisionById = useMemo(() => {
    const map = new Map<string, HeadingNode>()
    for (const heading of revisionDoc.headings) map.set(heading.id, heading)
    return map
  }, [revisionDoc])

  const diff = useMemo(
    () => computeDiff(originalContent, effectiveRevision),
    [originalContent, effectiveRevision]
  )

  const warningCount = useMemo(() => {
    let total = originalDoc.diagnostics.filter((d) => d.severity === 'warning').length
    for (const heading of originalDoc.headings) {
      total += heading.diagnostics.filter((d) => d.severity === 'warning').length
    }
    return total
  }, [originalDoc])

  const unmatchedCount = useMemo(
    () =>
      originalDoc.headings.filter((heading) => matches.get(heading.id)?.revisionId == null)
        .length,
    [originalDoc, matches]
  )

  // Side-by-side resizing. Window listeners are registered once and read the
  // drag start snapshot from a ref, so state updates cannot go stale.
  useEffect(() => {
    function onPointerMove(event: PointerEvent): void {
      const drag = dragRef.current
      if (!drag) return
      const deltaX = event.clientX - drag.startX
      if (drag.kind === 'left') {
        const max =
          modeRef.current === 'panes'
            ? window.innerWidth - drag.midW - 300
            : window.innerWidth - 320
        setLeftW(clamp(drag.leftW + deltaX, MIN_LEFT, Math.max(MIN_LEFT, max)))
      } else {
        setMidW(clamp(drag.midW + deltaX, MIN_MID, window.innerWidth - drag.leftW - 300))
      }
    }
    function onPointerUp(): void {
      dragRef.current = null
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  // Leaving the editable panes disposes their editors; drop the stale refs.
  useEffect(() => {
    if (viewMode !== 'panes') {
      originalEditorRef.current = null
      revisionEditorRef.current = null
      setPaneEditors({ original: null, revision: null })
    }
    changeIndexRef.current = -1
  }, [viewMode])

  useEffect(() => {
    changeIndexRef.current = -1
  }, [originalContent, revisionContent])

  // Attach synchronized scrolling whenever both pane editors are available.
  useEffect(() => {
    const { original, revision } = paneEditors
    if (!original || !revision) return
    const handle = attachScrollSync(
      original,
      revision,
      (line) => resolveMappedLine(diff.originalToRevision, line),
      (line) => resolveMappedLine(diff.revisionToOriginal, line),
      () => syncEnabledRef.current
    )
    return () => handle.dispose()
  }, [paneEditors, diff])

  function startDrag(kind: 'left' | 'mid', event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    dragRef.current = { kind, startX: event.clientX, leftW, midW }
  }

  function loadDocument(path: string, content: string): void {
    setOriginalPath(path)
    setOriginalContent(content)
    setRevisionContent(content)
    setRevisionPath(null)
    setSelectedId(null)
    setStatus(`Opened ${path}`)
  }

  async function openFile(): Promise<void> {
    const result = await window.api.openFile()
    if (!result) return
    loadDocument(result.path, result.content)
  }

  async function loadSample(): Promise<void> {
    const result = await window.api.loadSample()
    if (!result) {
      setStatus('Sample document not found.')
      return
    }
    loadDocument(result.path, result.content)
  }

  async function saveRevision(): Promise<void> {
    if (!originalPath) return
    if (revisionPath) {
      await window.api.saveFile(revisionPath, revisionContent)
      setStatus(`Saved revision to ${revisionPath}`)
      return
    }
    await saveRevisionAs()
  }

  async function saveRevisionAs(): Promise<void> {
    if (!originalPath) return
    const result = await window.api.saveFileAs(revisionContent, suggestRevisionName(originalPath))
    if (!result) return
    setRevisionPath(result.path)
    setStatus(`Saved revision to ${result.path}`)
  }

  function navigateTo(node: HeadingNode): void {
    setSelectedId(node.id)
    const originalLine = node.startLine + 1
    const match = matches.get(node.id)
    const revisionNode = match?.revisionId ? revisionById.get(match.revisionId) : undefined
    const revisionLine = revisionNode ? revisionNode.startLine + 1 : null
    const label = node.displayText || 'untitled'

    if (viewMode !== 'panes' && diffEditorRef.current) {
      const targetLine = revisionLine ?? originalLine
      diffEditorRef.current.getModifiedEditor().revealLineInCenter(targetLine)
      diffEditorRef.current.getOriginalEditor().revealLineInCenter(originalLine)
      setStatus(
        revisionLine
          ? `Navigated to “${label}” (original ${originalLine}, revision ${revisionLine})`
          : `Navigated to “${label}” in the original (no matching revision section)`
      )
      return
    }

    const original = originalEditorRef.current
    if (original) {
      original.revealLineInCenter(originalLine)
      original.setPosition({ lineNumber: originalLine, column: 1 })
    }

    const revision = revisionEditorRef.current
    if (revision && revisionLine) {
      revision.revealLineInCenter(revisionLine)
      revision.setPosition({ lineNumber: revisionLine, column: 1 })
      setStatus(
        `Navigated to “${label}” (original ${originalLine}, revision ${revisionLine})`
      )
      return
    }

    if (revision) {
      setStatus(`Navigated to “${label}” in the original (no matching revision section)`)
      return
    }

    setStatus(`Navigated to “${label}” (line ${originalLine})`)
  }

  function goToChange(direction: 1 | -1, isRetry = false): void {
    const editor = diffEditorRef.current
    if (!editor) return

    const changes = editor.getLineChanges()
    if (!changes || changes.length === 0) {
      if (!isRetry) {
        window.setTimeout(() => goToChange(direction, true), 200)
      } else {
        setStatus('No changes to navigate.')
      }
      return
    }

    let index = changeIndexRef.current
    if (index < 0 || index >= changes.length) {
      index = direction === 1 ? 0 : changes.length - 1
    } else {
      index = (index + direction + changes.length) % changes.length
    }
    changeIndexRef.current = index

    const change = changes[index]
    const revisionLine = change.modifiedStartLineNumber || change.modifiedEndLineNumber || 1
    const originalLine = change.originalStartLineNumber || change.originalEndLineNumber || 1

    const modified = editor.getModifiedEditor()
    modified.revealLineInCenter(revisionLine)
    modified.setPosition({ lineNumber: revisionLine, column: 1 })
    editor.getOriginalEditor().revealLineInCenter(originalLine)

    setStatus(`Change ${index + 1} of ${changes.length}`)
  }

  function runEditorAction(actionId: string): void {
    for (const editor of [originalEditorRef.current, revisionEditorRef.current]) {
      if (editor) void editor.getAction(actionId)?.run()
    }
  }

  const gridColumns =
    viewMode === 'panes'
      ? `${leftW}px 6px ${midW}px 6px minmax(280px, 1fr)`
      : `${leftW}px 6px minmax(0, 1fr)`

  return (
    <div className="app">
      <header className="toolbar">
        <button type="button" onClick={() => void openFile()}>
          Open…
        </button>
        <button type="button" onClick={() => void loadSample()}>
          Load sample
        </button>
        <span className="toolbar-sep" />
        <button type="button" onClick={() => void saveRevision()} disabled={!originalPath}>
          Save revision
        </button>
        <button type="button" onClick={() => void saveRevisionAs()} disabled={!originalPath}>
          Save as…
        </button>
        <span className="toolbar-sep" />
        <button
          type="button"
          onClick={() => runEditorAction('editor.foldAll')}
          disabled={!originalPath || viewMode !== 'panes'}
        >
          Fold all
        </button>
        <button
          type="button"
          onClick={() => runEditorAction('editor.unfoldAll')}
          disabled={!originalPath || viewMode !== 'panes'}
        >
          Unfold all
        </button>
        <button
          type="button"
          className={syncEnabled ? 'toggle active' : 'toggle'}
          onClick={() => setSyncEnabled((value) => !value)}
          disabled={!originalPath || viewMode !== 'panes'}
        >
          Sync scroll: {syncEnabled ? 'on' : 'off'}
        </button>
        <span className="toolbar-sep" />
        <label className="view-mode">
          <span>View</span>
          <select
            value={viewMode}
            onChange={(event) => setViewMode(event.target.value as ViewMode)}
          >
            <option value="panes">Panes (edit)</option>
            <option value="split">Split diff</option>
            <option value="unified">Unified diff</option>
          </select>
        </label>
        {viewMode !== 'panes' ? (
          <>
            <button type="button" onClick={() => goToChange(-1)} disabled={!originalPath}>
              ◀ Change
            </button>
            <button type="button" onClick={() => goToChange(1)} disabled={!originalPath}>
              Change ▶
            </button>
          </>
        ) : null}
        <span className="spacer" />
        <span className="status" title={status}>
          {status}
        </span>
      </header>

      <main className="workspace" style={{ gridTemplateColumns: gridColumns }}>
        <StructurePanel
          key={originalPath ?? 'empty'}
          document={originalDoc}
          matches={matches}
          selectedId={selectedId}
          onSelect={navigateTo}
        />

        <div className="splitter" onPointerDown={(event) => startDrag('left', event)} />

        {viewMode === 'panes' ? (
          <>
            <section className="pane">
              <div className="pane-header">
                <span>Original</span>
                {originalPath ? <span className="pane-sub">{originalPath}</span> : null}
              </div>
              <MonacoEditor
                value={originalContent}
                readOnly
                side="original"
                decorations={diff.originalLines}
                onMount={(editor) => {
                  originalEditorRef.current = editor
                  setPaneEditors((previous) => ({ ...previous, original: editor }))
                }}
              />
            </section>

            <div className="splitter" onPointerDown={(event) => startDrag('mid', event)} />

            <section className="pane">
              <div className="pane-header">
                <span>My Revision</span>
                {revisionPath ? <span className="pane-sub">{revisionPath}</span> : null}
              </div>
              <MonacoEditor
                value={revisionContent}
                side="revision"
                decorations={diff.revisionLines}
                onChange={setRevisionContent}
                onMount={(editor) => {
                  revisionEditorRef.current = editor
                  setPaneEditors((previous) => ({ ...previous, revision: editor }))
                }}
              />
            </section>
          </>
        ) : (
          <section className="pane">
            <div className="pane-header">
              <span>{viewMode === 'split' ? 'Split diff' : 'Unified diff'}</span>
              <span className="pane-sub">{diff.changeCount} changes</span>
            </div>
            <DiffView
              original={originalContent}
              revision={revisionContent}
              mode={viewMode}
              onMount={(editor) => {
                diffEditorRef.current = editor
              }}
            />
          </section>
        )}
      </main>

      <footer className="statusbar">
        <span>{originalPath ? 'Original loaded (read-only)' : 'No document loaded'}</span>
        <span>{originalDoc.headings.length} headings</span>
        <span>{diff.changeCount} changes</span>
        {unmatchedCount > 0 ? <span>{unmatchedCount} unmatched</span> : null}
        {warningCount > 0 ? <span>{warningCount} warnings</span> : null}
        <span>{revisionPath ? 'Revision saved separately' : 'Revision not saved yet'}</span>
      </footer>
    </div>
  )
}
