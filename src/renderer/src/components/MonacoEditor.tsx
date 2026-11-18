import { useEffect, useRef } from 'react'
import type * as Monaco from 'monaco-editor'
import { monaco } from '../lib/monacoSetup'
import { applyDiffDecorations } from '../lib/diffDecorations'
import type { LineMark } from '../lib/diff'

interface MonacoEditorProps {
  value: string
  readOnly?: boolean
  side?: 'original' | 'revision'
  decorations?: LineMark[]
  onChange?: (value: string) => void
  onMount?: (editor: Monaco.editor.IStandaloneCodeEditor) => void
}

/**
 * Thin React wrapper around a Monaco editor instance. Kept deliberately small
 * so later milestones (folding, decorations, synchronized scrolling) can reach
 * the underlying editor through `onMount`.
 */
export function MonacoEditor({
  value,
  readOnly = false,
  side,
  decorations,
  onChange,
  onMount
}: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const onChangeRef = useRef(onChange)
  const onMountRef = useRef(onMount)

  onChangeRef.current = onChange
  onMountRef.current = onMount

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const editor = monaco.editor.create(container, {
      value,
      language: 'markdown',
      readOnly,
      theme: 'vs-dark',
      automaticLayout: true,
      wordWrap: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: 'on',
      folding: true,
      showFoldingControls: 'always',
      foldingHighlight: true,
      renderLineHighlight: 'all',
      fixedOverflowWidgets: true
    })

    editorRef.current = editor
    onMountRef.current?.(editor)

    if (import.meta.env.DEV && side) {
      const registry = ((globalThis as unknown as { __editors?: Record<string, unknown> }).__editors ??=
        {})
      registry[side] = editor
    }

    const subscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue())
    })

    return () => {
      subscription.dispose()
      editor.dispose()
      editorRef.current = null
    }
    // Editor is created once; value/readOnly are synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the editor in sync when the value is replaced externally (e.g. a new
  // document is opened). We compare first so typing does not reset the model.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (editor.getValue() !== value) {
      editor.getModel()?.setValue(value)
    }
  }, [value])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly })
  }, [readOnly])

  // Re-paint diff decorations whenever the computed marks change.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !side) return
    applyDiffDecorations(editor, decorations ?? [], side)
  }, [decorations, side])

  return <div ref={containerRef} className="monaco-host" />
}
