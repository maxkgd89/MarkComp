import { diffLines, diffWordsWithSpace } from 'diff'

export interface WordRange {
  /** 1-based start column (inclusive). */
  startColumn: number
  /** 1-based end column (exclusive). */
  endColumn: number
}

export type LineChangeKind = 'added' | 'removed' | 'modified'

export interface LineMark {
  /** 1-based line number in the document being decorated. */
  line: number
  kind: LineChangeKind
  /** Changed word ranges for `modified` lines (empty for added/removed). */
  words: WordRange[]
}

export interface DiffResult {
  originalLines: LineMark[]
  revisionLines: LineMark[]
  changeCount: number
  /** index = 1-based original line, value = corresponding 1-based revision line (0 = unmapped). */
  originalToRevision: number[]
  /** index = 1-based revision line, value = corresponding 1-based original line (0 = unmapped). */
  revisionToOriginal: number[]
}

/** Resolve a 1-based line through a sparse map, falling back to the nearest mapped line. */
export function resolveMappedLine(map: number[], line: number): number {
  if (line < 1) return 1
  const lastIndex = map.length - 1
  const start = Math.min(line, lastIndex)

  for (let i = start; i >= 1; i--) {
    if (map[i] > 0) return map[i]
  }
  for (let i = start + 1; i <= lastIndex; i++) {
    if (map[i] > 0) return map[i]
  }
  return line
}

interface LineRun {
  lines: string[]
  startLine: number
}

function chunkToLines(value: string): string[] {
  if (value.length === 0) return []
  const withoutTrailingNewline = value.endsWith('\n') ? value.slice(0, -1) : value
  return withoutTrailingNewline.split('\n')
}

function wordDiff(
  oldText: string,
  newText: string
): { oldRanges: WordRange[]; newRanges: WordRange[]; equal: boolean } {
  const parts = diffWordsWithSpace(oldText, newText)
  const oldRanges: WordRange[] = []
  const newRanges: WordRange[] = []
  let oldColumn = 1
  let newColumn = 1
  let equal = true

  for (const part of parts) {
    const length = part.value.length
    if (part.removed) {
      oldRanges.push({ startColumn: oldColumn, endColumn: oldColumn + length })
      oldColumn += length
      equal = false
    } else if (part.added) {
      newRanges.push({ startColumn: newColumn, endColumn: newColumn + length })
      newColumn += length
      equal = false
    } else {
      oldColumn += length
      newColumn += length
    }
  }

  return { oldRanges, newRanges, equal }
}

/**
 * Compute a line-level diff with word-level ranges for paired (modified) lines.
 *
 * Removed and added runs are aligned line-by-line; the overlapping lines are
 * compared word by word so a single changed word is highlighted instead of the
 * whole paragraph. Extra lines in a longer run stay marked as pure
 * additions/removals.
 */
export function computeDiff(original: string, revision: string): DiffResult {
  const chunks = diffLines(original, revision)
  const originalLines: LineMark[] = []
  const revisionLines: LineMark[] = []
  let changeCount = 0

  const originalLineCount = original.split('\n').length
  const revisionLineCount = revision.split('\n').length
  const originalToRevision = new Array<number>(originalLineCount + 2).fill(0)
  const revisionToOriginal = new Array<number>(revisionLineCount + 2).fill(0)

  let removedRun: LineRun | null = null
  let addedRun: LineRun | null = null
  let oldLine = 1
  let newLine = 1

  const flushRuns = (): void => {
    if (!removedRun && !addedRun) return
    const removed = removedRun
    const added = addedRun
    removedRun = null
    addedRun = null

    const pairCount = Math.min(removed?.lines.length ?? 0, added?.lines.length ?? 0)

    for (let i = 0; i < pairCount; i++) {
      const result = wordDiff(removed!.lines[i], added!.lines[i])
      if (result.equal) continue
      originalLines.push({ line: removed!.startLine + i, kind: 'modified', words: result.oldRanges })
      revisionLines.push({ line: added!.startLine + i, kind: 'modified', words: result.newRanges })
      changeCount++
    }

    for (let i = pairCount; i < (removed?.lines.length ?? 0); i++) {
      originalLines.push({ line: removed!.startLine + i, kind: 'removed', words: [] })
      changeCount++
    }

    for (let i = pairCount; i < (added?.lines.length ?? 0); i++) {
      revisionLines.push({ line: added!.startLine + i, kind: 'added', words: [] })
      changeCount++
    }
  }

  for (const chunk of chunks) {
    const lines = chunkToLines(chunk.value)
    const count = lines.length

    if (chunk.removed) {
      if (!removedRun) removedRun = { lines: [], startLine: oldLine }
      removedRun.lines.push(...lines)
      for (let i = 0; i < count; i++) originalToRevision[oldLine + i] = newLine
      oldLine += count
      continue
    }

    if (chunk.added) {
      if (!addedRun) addedRun = { lines: [], startLine: newLine }
      addedRun.lines.push(...lines)
      for (let i = 0; i < count; i++) revisionToOriginal[newLine + i] = oldLine
      newLine += count
      continue
    }

    for (let i = 0; i < count; i++) {
      originalToRevision[oldLine + i] = newLine + i
      revisionToOriginal[newLine + i] = oldLine + i
    }
    flushRuns()
    oldLine += count
    newLine += count
  }

  flushRuns()

  return {
    originalLines,
    revisionLines,
    changeCount,
    originalToRevision,
    revisionToOriginal
  }
}
