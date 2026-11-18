import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import { computeFoldingRanges } from './markdown'

// Monaco needs at least the core editor worker. Markdown is a basic language,
// so it does not require a dedicated language worker.
;(globalThis as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorker(): Worker {
    return new EditorWorker()
  }
}

// Monaco has no built-in Markdown folding, so fold sections by heading level.
monaco.languages.registerFoldingRangeProvider('markdown', {
  provideFoldingRanges(model) {
    return computeFoldingRanges(model.getLinesContent())
  }
})

// Dev-only hook so the diff can be exercised from automated checks.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __monaco?: unknown }).__monaco = monaco
}

export { monaco }
