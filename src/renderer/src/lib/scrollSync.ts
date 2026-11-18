import type * as Monaco from 'monaco-editor'
import { monaco } from './monacoSetup'

export interface ScrollSyncHandle {
  dispose(): void
}

/**
 * Keep two editors scrolled to corresponding content.
 *
 * Scroll position is mapped through the diff's line map (content positions),
 * not copied as a raw offset. Programmatic scrolls suppress the target's
 * scroll events for a short window so the two editors cannot ping-pong.
 */
export function attachScrollSync(
  original: Monaco.editor.IStandaloneCodeEditor,
  revision: Monaco.editor.IStandaloneCodeEditor,
  originalToRevision: (line: number) => number,
  revisionToOriginal: (line: number) => number,
  isEnabled: () => boolean
): ScrollSyncHandle {
  const suppressUntil = { original: 0, revision: 0 }
  let pending: 'original' | 'revision' | null = null
  let frame = 0

  const flush = (): void => {
    frame = 0
    const which = pending
    pending = null
    if (!which || !isEnabled()) return

    const source = which === 'original' ? original : revision
    const target = which === 'original' ? revision : original
    const map = which === 'original' ? originalToRevision : revisionToOriginal

    const ranges = source.getVisibleRanges()
    if (ranges.length === 0) return

    const targetLine = map(ranges[0].startLineNumber)
    // `revealLineNearTop` refuses to move when the line is already visible, so
    // scroll explicitly to the mapped line's pixel offset instead.
    target.setScrollTop(target.getTopForLineNumber(targetLine), monaco.editor.ScrollType.Immediate)
    suppressUntil[which === 'original' ? 'revision' : 'original'] = performance.now() + 60
  }

  const onOriginalScroll = (): void => {
    if (!isEnabled()) return
    if (performance.now() < suppressUntil.original) return
    pending = 'original'
    if (!frame) frame = requestAnimationFrame(flush)
  }

  const onRevisionScroll = (): void => {
    if (!isEnabled()) return
    if (performance.now() < suppressUntil.revision) return
    pending = 'revision'
    if (!frame) frame = requestAnimationFrame(flush)
  }

  const originalSubscription = original.onDidScrollChange((event) => {
    if (event.scrollTopChanged) onOriginalScroll()
  })
  const revisionSubscription = revision.onDidScrollChange((event) => {
    if (event.scrollTopChanged) onRevisionScroll()
  })

  return {
    dispose(): void {
      originalSubscription.dispose()
      revisionSubscription.dispose()
      if (frame) cancelAnimationFrame(frame)
    }
  }
}
