import { useEffect, useRef } from 'react'
import type * as Monaco from 'monaco-editor'
import { monaco } from '../lib/monacoSetup'

export type DiffViewMode = 'split' | 'unified'

interface DiffViewProps {
  original: string
  revision: string
  mode: DiffViewMode
  onMount?: (editor: Monaco.editor.IStandaloneDiffEditor) => void
}

/**
 * Dedicated GitHub-style comparison view built on Monaco's diff editor.
 * `renderSideBySide` gives split diff; turning it off gives the unified diff.
 */
export function DiffView({ original, revision, mode, onMount }: DiffViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
  const onMountRef = useRef(onMount)

  onMountRef.current = onMount

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const editor = monaco.editor.createDiffEditor(container, {
      theme: 'vs-dark',
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: mode === 'split',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      wordWrap: 'on',
      renderIndicators: true,
      ignoreTrimWhitespace: false,
      enableSplitViewResizing: true
    })

    diffEditorRef.current = editor
    onMountRef.current?.(editor)

    if (import.meta.env.DEV) {
      ;(globalThis as unknown as { __diffEditor?: unknown }).__diffEditor = editor
    }

    return () => {
      const model = editor.getModel()
      editor.dispose()
      model?.original.dispose()
      model?.modified.dispose()
      diffEditorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const editor = diffEditorRef.current
    if (!editor) return
    const previous = editor.getModel()
    const nextOriginal = monaco.editor.createModel(original, 'markdown')
    const nextRevision = monaco.editor.createModel(revision, 'markdown')
    editor.setModel({ original: nextOriginal, modified: nextRevision })
    previous?.original.dispose()
    previous?.modified.dispose()
  }, [original, revision])

  useEffect(() => {
    diffEditorRef.current?.updateOptions({ renderSideBySide: mode === 'split' })
  }, [mode])

  return <div ref={containerRef} className="monaco-host diff-host" />
}
