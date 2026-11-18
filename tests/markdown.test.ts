import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseMarkdownDocument,
  computeFoldingRanges
} from '../src/renderer/src/lib/markdown.ts'

function headings(content: string) {
  return parseMarkdownDocument(content, 'test').headings
}

test('parses ATX headings H1 through H6', () => {
  const doc = parseMarkdownDocument('# A\n## B\n### C\n#### D\n##### E\n###### F\n', 'test')
  assert.equal(doc.headings.length, 6)
  assert.deepEqual(
    doc.headings.map((heading) => heading.level),
    [1, 2, 3, 4, 5, 6]
  )
  assert.equal(doc.headings[1].displayText, 'B')
})

test('strips closing hashes but keeps a trailing C#', () => {
  const parsed = headings('# Title ###\n## C#\n')
  assert.equal(parsed[0].rawText, 'Title')
  assert.equal(parsed[1].rawText, 'C#')
  assert.equal(parsed[1].displayText, 'C#')
})

test('supports setext headings', () => {
  const doc = parseMarkdownDocument('Title\n=====\n\nSection\n-------\n', 'test')
  assert.equal(doc.headings.length, 2)
  assert.equal(doc.headings[0].level, 1)
  assert.equal(doc.headings[0].displayText, 'Title')
  assert.equal(doc.headings[1].level, 2)
  assert.equal(doc.headings[1].displayText, 'Section')
})

test('does not treat a thematic break after a blank line as a setext heading', () => {
  const doc = parseMarkdownDocument('text\n\n---\n', 'test')
  assert.equal(doc.headings.length, 0)
})

test('handles unicode, emoji, numbering, and inline formatting', () => {
  const parsed = headings('## 日本語 🚀\n### **重要** `code` [link](https://example.com)\n')
  assert.equal(parsed[0].displayText, '日本語 🚀')
  assert.equal(parsed[1].displayText, '重要 code link')
})

test('handles empty headings and duplicate headings', () => {
  const doc = parseMarkdownDocument('# Notes\n## Details\n## Details\n# Notes\n', 'test')
  assert.equal(doc.headings.length, 4)
  const duplicates = doc.headings.filter((heading) =>
    heading.diagnostics.some((diagnostic) => diagnostic.code === 'duplicate-heading')
  )
  assert.equal(duplicates.length, 2)

  const empty = parseMarkdownDocument('##\n', 'test')
  assert.equal(empty.headings[0].displayText, '')
  assert.ok(
    empty.headings[0].diagnostics.some((diagnostic) => diagnostic.code === 'empty-heading')
  )
})

test('handles CRLF and a final line without newline', () => {
  const doc = parseMarkdownDocument('# A\r\n\r\ntext\r\n## B', 'test')
  assert.equal(doc.lineEnding, '\r\n')
  assert.equal(doc.headings.length, 2)
  assert.equal(doc.headings[1].startLine, 3)
})

test('ignores headings inside variable-length backtick fences', () => {
  const doc = parseMarkdownDocument(
    '````markdown\n# fake\n```\n## fake2\n```\n````\n# Real\n',
    'test'
  )
  assert.equal(doc.headings.length, 1)
  assert.equal(doc.headings[0].displayText, 'Real')
})

test('ignores headings inside tilde fences and indented code blocks', () => {
  const doc = parseMarkdownDocument('~~~\n# fake\n~~~\n    # indented\n# Real\n', 'test')
  assert.equal(doc.headings.length, 1)
  assert.equal(doc.headings[0].displayText, 'Real')
})

test('ignores headings inside think blocks and role markers', () => {
  const doc = parseMarkdownDocument(
    '<think>\n# hidden\n</think>\n<｜Assistant｜>\n# Real\n',
    'test'
  )
  assert.equal(doc.headings.length, 1)
  assert.equal(doc.headings[0].displayText, 'Real')
})

test('does not treat plain labels, lists, or blockquotes as headings', () => {
  const doc = parseMarkdownDocument(
    'Answer:\nExplanation:\n分析：\n\n- # item\n> # quoted\n',
    'test'
  )
  assert.equal(doc.headings.length, 0)
})

test('does not treat #Heading as a heading and reports it as ambiguous', () => {
  const doc = parseMarkdownDocument('#Heading\n', 'test')
  assert.equal(doc.headings.length, 0)
  assert.ok(doc.diagnostics.some((diagnostic) => diagnostic.code === 'ambiguous-heading'))
})

test('builds hierarchy and reports skipped levels', () => {
  const doc = parseMarkdownDocument('# A\n### C\n#### D\n## B\n', 'test')
  // Parent = nearest preceding heading with a lower level, so B (H2) nests
  // under A (H1); C (H3) nests under A and reports the skipped H2.
  assert.equal(doc.roots.length, 1)
  assert.equal(doc.roots[0].displayText, 'A')
  assert.deepEqual(
    doc.roots[0].children.map((heading) => heading.displayText),
    ['C', 'B']
  )
  const c = doc.headings.find((heading) => heading.displayText === 'C')!
  assert.equal(c.children[0].displayText, 'D')
  assert.ok(c.diagnostics.some((diagnostic) => diagnostic.code === 'skipped-level'))
})

test('reports missing H1 and documents starting below H1', () => {
  const doc = parseMarkdownDocument('## Intro\n', 'test')
  assert.ok(doc.diagnostics.some((diagnostic) => diagnostic.code === 'missing-h1'))
  assert.ok(doc.diagnostics.some((diagnostic) => diagnostic.code === 'starts-below-h1'))
})

test('computes section boundaries', () => {
  const doc = parseMarkdownDocument('# Root\n## A\ntext\n## B\ntext\n', 'test')
  const a = doc.headings.find((heading) => heading.displayText === 'A')!
  const b = doc.headings.find((heading) => heading.displayText === 'B')!
  assert.equal(a.sectionEndLine, 2)
  assert.equal(b.sectionEndLine, 5)
})

test('computes character offsets', () => {
  const content = '# A\n\ntext\n## B\n'
  const doc = parseMarkdownDocument(content, 'test')
  assert.equal(
    content.slice(doc.headings[0].startOffset, doc.headings[0].endOffset),
    '# A'
  )
  assert.equal(
    content.slice(doc.headings[1].startOffset, doc.headings[1].endOffset),
    '## B'
  )
})

test('reports unclosed fences', () => {
  const doc = parseMarkdownDocument('# A\n```\n# hidden\n', 'test')
  assert.ok(doc.diagnostics.some((diagnostic) => diagnostic.code === 'unclosed-code-fence'))
  assert.equal(doc.headings.length, 1)
})

test('provides heading-based folding ranges', () => {
  const ranges = computeFoldingRanges(['# A', 'text', '## B', 'text', '# C'])
  assert.deepEqual(ranges, [
    { start: 1, end: 4 },
    { start: 3, end: 4 }
  ])
})

test('gives each duplicate an independent stable id', () => {
  const doc = parseMarkdownDocument('# Notes\n## Details\n## Details\n# Notes\n', 'test')
  const ids = doc.headings.map((heading) => heading.id)
  assert.equal(new Set(ids).size, ids.length)
})
