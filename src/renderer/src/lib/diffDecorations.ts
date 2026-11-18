import { monaco } from './monacoSetup'
import type { LineMark } from './diff'

const previousDecorations = new WeakMap<monaco.editor.IStandaloneCodeEditor, string[]>()

/**
 * Paint diff decorations onto an editor. Whole added/removed lines get a
 * background plus a gutter marker; modified lines get word-level spans so only
 * the changed words are highlighted.
 */
export function applyDiffDecorations(
  editor: monaco.editor.IStandaloneCodeEditor,
  marks: LineMark[],
  side: 'original' | 'revision'
): void {
  const decorations: monaco.editor.IModelDeltaDecoration[] = []
  const wordClass = side === 'original' ? 'diff-word-removed' : 'diff-word-added'
  const wordColor = side === 'original' ? '#f85149' : '#2ea043'

  for (const mark of marks) {
    if (mark.kind === 'modified') {
      for (const word of mark.words) {
        decorations.push({
          range: new monaco.Range(mark.line, word.startColumn, mark.line, word.endColumn),
          options: {
            inlineClassName: wordClass,
            overviewRuler: {
              color: wordColor,
              position: monaco.editor.OverviewRulerLane.Left
            }
          }
        })
      }
      decorations.push({
        range: new monaco.Range(mark.line, 1, mark.line, 1),
        options: { isWholeLine: true, className: 'diff-line-modified' }
      })
      continue
    }

    const isAdded = mark.kind === 'added'
    decorations.push({
      range: new monaco.Range(mark.line, 1, mark.line, 1),
      options: {
        isWholeLine: true,
        className: isAdded ? 'diff-line-added' : 'diff-line-removed',
        linesDecorationsClassName: isAdded ? 'diff-gutter-added' : 'diff-gutter-removed',
        overviewRuler: {
          color: isAdded ? '#2ea043' : '#f85149',
          position: monaco.editor.OverviewRulerLane.Left
        }
      }
    })
  }

  const previous = previousDecorations.get(editor) ?? []
  const ids = editor.deltaDecorations(previous, decorations)
  previousDecorations.set(editor, ids)
}
