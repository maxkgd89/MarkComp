export type DiagnosticSeverity = 'warning' | 'info'

export type DiagnosticCode =
  | 'skipped-level'
  | 'empty-heading'
  | 'duplicate-heading'
  | 'missing-h1'
  | 'starts-below-h1'
  | 'deep-nesting'
  | 'ambiguous-heading'
  | 'unclosed-code-fence'
  | 'heading-like-text-in-code'

export interface Diagnostic {
  code: DiagnosticCode
  severity: DiagnosticSeverity
  message: string
  /** 0-based line the diagnostic refers to, when applicable. */
  line?: number
  headingId?: string
}

export interface HeadingNode {
  /** Deterministic identity derived from level, normalized text and occurrence. */
  id: string
  level: number
  /** Heading text exactly as extracted from the source (markers stripped). */
  rawText: string
  /** Plain display text with inline Markdown formatting removed. */
  displayText: string
  /** 0-based line of the heading (text line for setext headings). */
  startLine: number
  /** 0-based last line of the heading itself (underline for setext). */
  endLine: number
  startOffset: number
  endOffset: number
  parentId: string | null
  childIds: string[]
  /** 0-based inclusive line range of the heading's section (heading + body). */
  sectionStartLine: number
  sectionEndLine: number
  diagnostics: Diagnostic[]
  children: HeadingNode[]
}

export interface ParsedDocument {
  documentId: string
  lineEnding: '\n' | '\r\n'
  lineCount: number
  lines: string[]
  /** Headings in document order. */
  headings: HeadingNode[]
  /** Top-level headings. */
  roots: HeadingNode[]
  /** Document-level diagnostics (some diagnostics also live on headings). */
  diagnostics: Diagnostic[]
}

export interface MarkdownFoldingRange {
  start: number
  end: number
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const THINK_OPEN = /<think(?:ing)?\b/i
const THINK_CLOSE = /<\/think(?:ing)?>/i
const ATX_LIKE = /^ {0,3}#{1,6}[^\s#]/

interface SplitResult {
  lines: string[]
  offsets: number[]
  lineEnding: '\n' | '\r\n'
}

function splitLines(content: string): SplitResult {
  const lineEnding: '\n' | '\r\n' = content.includes('\r\n') ? '\r\n' : '\n'
  const lines: string[] = []
  const offsets: number[] = []
  let start = 0

  for (let i = 0; i <= content.length; i++) {
    const char = i < content.length ? content[i] : ''
    if (i === content.length || char === '\n' || char === '\r') {
      lines.push(content.slice(start, i))
      offsets.push(start)
      if (char === '\r' && content[i + 1] === '\n') i++
      start = i + 1
    }
  }

  return { lines, offsets, lineEnding }
}

interface LineContext {
  inCode: boolean
  inThink: boolean
  isFenceLine: boolean
}

function computeLineContexts(lines: string[]): {
  contexts: LineContext[]
  unclosedFence: boolean
  headingLikeInCode: number
} {
  const contexts: LineContext[] = lines.map(() => ({
    inCode: false,
    inThink: false,
    isFenceLine: false
  }))

  let fenceChar: '`' | '~' | null = null
  let fenceLength = 0
  let thinkDepth = 0
  let headingLikeInCode = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (fenceChar) {
      contexts[i].inCode = true
      const close = FENCE_CLOSE.exec(line)
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLength) {
        fenceChar = null
        fenceLength = 0
        contexts[i].isFenceLine = true
      } else if (parseAtxHeading(line) || ATX_LIKE.test(line)) {
        headingLikeInCode++
      }
      continue
    }

    const open = FENCE_OPEN.exec(line)
    if (open) {
      fenceChar = open[1][0] as '`' | '~'
      fenceLength = open[1].length
      contexts[i].inCode = true
      contexts[i].isFenceLine = true
      continue
    }

    if (thinkDepth > 0) {
      contexts[i].inThink = true
      if (THINK_CLOSE.test(line)) thinkDepth--
      continue
    }

    if (THINK_OPEN.test(line)) {
      contexts[i].inThink = true
      thinkDepth++
      if (THINK_CLOSE.test(line)) thinkDepth--
      continue
    }
  }

  return { contexts, unclosedFence: fenceChar !== null, headingLikeInCode }
}

/** Parse an ATX heading line, returning the raw heading text or null. */
function parseAtxHeading(line: string): { level: number; rawText: string } | null {
  const match = /^( {0,3})(#{1,6})(.*)$/.exec(line)
  if (!match) return null

  const level = match[2].length
  const rest = match[3]

  // A space or tab (or end of line) must follow the opening hashes.
  if (rest.length > 0 && rest[0] !== ' ' && rest[0] !== '\t') return null

  // Closing sequence: hashes preceded by whitespace and followed only by spaces.
  const withoutClosing = rest.replace(/[ \t]+#+[ \t]*$/, '')
  return { level, rawText: withoutClosing.trim() }
}

/** Parse a setext underline line (`===` -> 1, `---` -> 2). */
function parseSetextUnderline(line: string): 1 | 2 | null {
  const match = /^ {0,3}(=+|-+)[ \t]*$/.exec(line)
  if (!match) return null
  return match[1][0] === '=' ? 1 : 2
}

function isParagraphLine(line: string): boolean {
  if (line.trim().length === 0) return false
  if (/^(?: {4,}|\t)/.test(line)) return false
  if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) return false
  if (/^ {0,3}>/.test(line)) return false
  if (/^ {0,3}(?:[-*+]|\d+[.)])[ \t]+/.test(line)) return false
  if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) return false
  if (/^ {0,3}(?:`{3,}|~{3,})/.test(line)) return false
  return true
}

/**
 * Convert heading source text into plain display text by removing common
 * inline Markdown formatting. Handlers are conservative: snake_case and code
 * spans are preserved.
 */
export function normalizeHeadingText(rawText: string): string {
  let text = rawText.trim()

  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/`([^`]*)`/g, '$1')
  text = text.replace(/\*\*(.+?)\*\*/g, '$1')
  text = text.replace(/__(.+?)__/g, '$1')
  text = text.replace(/\*(.+?)\*/g, '$1')
  text = text.replace(/~~(.+?)~~/g, '$1')
  text = text.replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1')
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, '')
  text = text.replace(/\s+/g, ' ').trim()

  return text
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}

function makeHeading(
  level: number,
  rawText: string,
  startLine: number,
  endLine: number,
  startOffset: number,
  endOffset: number
): HeadingNode {
  return {
    id: '',
    level,
    rawText,
    displayText: normalizeHeadingText(rawText),
    startLine,
    endLine,
    startOffset,
    endOffset,
    parentId: null,
    childIds: [],
    sectionStartLine: startLine,
    sectionEndLine: endLine,
    diagnostics: [],
    children: []
  }
}

/**
 * Parse a Markdown document locally and deterministically.
 *
 * Handles ATX and setext headings, fenced code (backtick/tilde, any length),
 * indented code, and `<think>` reasoning blocks. Never modifies the source.
 */
export function parseMarkdownDocument(content: string, documentId = 'document'): ParsedDocument {
  const { lines, offsets, lineEnding } = splitLines(content)
  const { contexts, unclosedFence, headingLikeInCode } = computeLineContexts(lines)
  const headings: HeadingNode[] = []
  const usedAsSetextText = new Set<number>()

  for (let i = 0; i < lines.length; i++) {
    if (contexts[i].inCode || contexts[i].inThink || contexts[i].isFenceLine) continue

    const atx = parseAtxHeading(lines[i])
    if (atx) {
      headings.push(
        makeHeading(atx.level, atx.rawText, i, i, offsets[i], offsets[i] + lines[i].length)
      )
      continue
    }

    const setextLevel = parseSetextUnderline(lines[i])
    if (setextLevel && i > 0) {
      const previous = i - 1
      if (
        !usedAsSetextText.has(previous) &&
        !contexts[previous].inCode &&
        !contexts[previous].inThink &&
        !contexts[previous].isFenceLine &&
        isParagraphLine(lines[previous])
      ) {
        usedAsSetextText.add(previous)
        headings.push(
          makeHeading(
            setextLevel,
            lines[previous].trim(),
            previous,
            i,
            offsets[previous],
            offsets[i] + lines[i].length
          )
        )
      }
    }
  }

  const diagnostics: Diagnostic[] = []
  const documentLineCount = lines.length

  // Stable IDs and duplicate detection.
  const occurrence = new Map<string, number>()
  const seenText = new Map<string, HeadingNode>()

  for (const heading of headings) {
    const slug = slugify(heading.displayText)
    const key = `${heading.level}:${slug}`
    const next = (occurrence.get(key) ?? 0) + 1
    occurrence.set(key, next)
    heading.id = `h${heading.level}-${slug}-${next}`

    const normalized = heading.displayText.toLowerCase()
    if (normalized.length === 0) {
      heading.diagnostics.push({
        code: 'empty-heading',
        severity: 'info',
        message: 'Heading has no text.',
        line: heading.startLine,
        headingId: heading.id
      })
    } else {
      const previous = seenText.get(normalized)
      if (previous) {
        heading.diagnostics.push({
          code: 'duplicate-heading',
          severity: 'info',
          message: `Duplicate heading: another "${heading.displayText}" appears earlier in the document.`,
          line: heading.startLine,
          headingId: heading.id
        })
      } else {
        seenText.set(normalized, heading)
      }
    }
  }

  // Hierarchy construction: parent = nearest preceding lower level.
  const roots: HeadingNode[] = []
  const stack: HeadingNode[] = []
  const headingById = new Map<string, HeadingNode>()
  for (const heading of headings) headingById.set(heading.id, heading)

  for (const heading of headings) {
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) stack.pop()
    if (stack.length === 0) {
      roots.push(heading)
    } else {
      const parent = stack[stack.length - 1]
      heading.parentId = parent.id
      parent.childIds.push(heading.id)
      parent.children.push(heading)
    }
    stack.push(heading)
  }

  // Section boundaries and depth diagnostics.
  const depth = (node: HeadingNode): number => {
    let count = 1
    let current = node
    while (current.parentId) {
      count++
      const parent = headingById.get(current.parentId)
      if (!parent) break
      current = parent
    }
    return count
  }

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]
    let end = documentLineCount - 1
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= heading.level) {
        end = headings[j].startLine - 1
        break
      }
    }
    heading.sectionStartLine = heading.startLine
    heading.sectionEndLine = end

    const headingDepth = depth(heading)
    if (headingDepth >= 6) {
      heading.diagnostics.push({
        code: 'deep-nesting',
        severity: 'info',
        message: `Heading is nested ${headingDepth} levels deep.`,
        line: heading.startLine,
        headingId: heading.id
      })
    }

    if (heading.parentId) {
      const parent = headingById.get(heading.parentId)
      if (parent && parent.level < heading.level - 1) {
        heading.diagnostics.push({
          code: 'skipped-level',
          severity: 'warning',
          message: `Heading skips levels: H${parent.level} followed by H${heading.level}.`,
          line: heading.startLine,
          headingId: heading.id
        })
      }
    }
  }

  // Document-level diagnostics.
  if (headings.length > 0) {
    const hasH1 = headings.some((heading) => heading.level === 1)
    if (!hasH1) {
      diagnostics.push({
        code: 'missing-h1',
        severity: 'warning',
        message: 'Document has no H1 heading.'
      })
    }
    if (headings[0].level > 1) {
      diagnostics.push({
        code: 'starts-below-h1',
        severity: 'info',
        message: `Document starts with an H${headings[0].level} heading.`,
        line: headings[0].startLine
      })
    }
  }

  if (unclosedFence) {
    diagnostics.push({
      code: 'unclosed-code-fence',
      severity: 'warning',
      message: 'A code fence is never closed; later headings may be hidden as code.'
    })
  }

  if (headingLikeInCode > 0) {
    diagnostics.push({
      code: 'heading-like-text-in-code',
      severity: 'info',
      message: `${headingLikeInCode} heading-like line(s) inside code blocks were ignored.`
    })
  }

  const ambiguousLines: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (contexts[i].inCode || contexts[i].inThink || contexts[i].isFenceLine) continue
    if (ATX_LIKE.test(lines[i]) && !parseAtxHeading(lines[i])) ambiguousLines.push(i)
  }
  if (ambiguousLines.length > 0) {
    diagnostics.push({
      code: 'ambiguous-heading',
      severity: 'info',
      message: `${ambiguousLines.length} line(s) look like headings but have no space after the hashes.`,
      line: ambiguousLines[0]
    })
  }

  return {
    documentId,
    lineEnding,
    lineCount: lines.length,
    lines,
    headings,
    roots,
    diagnostics
  }
}

/** Flatten a heading tree back into document order. */
export function flattenHeadings(nodes: HeadingNode[]): HeadingNode[] {
  const result: HeadingNode[] = []
  const walk = (list: HeadingNode[]): void => {
    for (const node of list) {
      result.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return result
}

/**
 * Heading-based folding ranges: a heading folds down to the line before the
 * next heading of the same or higher level. `lines` are 0-based; the returned
 * ranges use 1-based line numbers, as Monaco's provider expects.
 */
export function computeFoldingRanges(lines: string[]): MarkdownFoldingRange[] {
  const document = parseMarkdownDocument(lines.join('\n'), 'folding')
  const ranges: MarkdownFoldingRange[] = []

  for (const heading of document.headings) {
    const start = heading.startLine + 1
    const end = heading.sectionEndLine + 1
    if (end > start) ranges.push({ start, end })
  }

  return ranges
}
