import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdownDocument } from '../src/renderer/src/lib/markdown.ts'
import { matchHeadings } from '../src/renderer/src/lib/matching.ts'

function run(original: string, revision: string) {
  const originalDoc = parseMarkdownDocument(original, 'original')
  const revisionDoc = parseMarkdownDocument(revision, 'revision')
  return {
    original: originalDoc,
    revision: revisionDoc,
    result: matchHeadings(originalDoc, revisionDoc)
  }
}

test('matches identical documents', () => {
  const { original, result } = run('# A\n## B\n', '# A\n## B\n')
  for (const heading of original.headings) {
    assert.notEqual(result.get(heading.id)?.revisionId, null)
  }
})

test('matches a renamed heading via structural path and sibling index', () => {
  const { original, revision, result } = run('# A\n## Old\n', '# A\n## New\n')
  const oldHeading = original.headings.find((heading) => heading.displayText === 'Old')!
  const newHeading = revision.headings.find((heading) => heading.displayText === 'New')!
  assert.equal(result.get(oldHeading.id)?.revisionId, newHeading.id)
})

test('survives heading insertion and deletion', () => {
  const original = parseMarkdownDocument('# A\n## B\n## C\n', 'original')
  const revision = parseMarkdownDocument('# A\n## Inserted\n## B\n## C\n', 'revision')
  const result = matchHeadings(original, revision)

  const find = (doc: typeof original, text: string) =>
    doc.headings.find((heading) => heading.displayText === text)!

  assert.equal(result.get(find(original, 'B').id)?.revisionId, find(revision, 'B').id)
  assert.equal(result.get(find(original, 'C').id)?.revisionId, find(revision, 'C').id)
})

test('marks deleted headings as unmatched', () => {
  const { original, revision, result } = run('# A\n## B\n## C\n', '# A\n## B\n')
  const c = original.headings.find((heading) => heading.displayText === 'C')!
  assert.equal(result.get(c.id)?.revisionId, null)
  assert.ok(revision.headings.length >= 1)
})

test('matches reordered headings by text', () => {
  const { original, revision, result } = run('# A\n## B\n', '## B\n# A\n')
  const a = original.headings.find((heading) => heading.displayText === 'A')!
  const ra = revision.headings.find((heading) => heading.displayText === 'A')!
  assert.equal(result.get(a.id)?.revisionId, ra.id)
})

test('handles duplicate headings by occurrence order', () => {
  const { original, revision, result } = run('# A\n## Notes\n## Notes\n', '# A\n## Notes\n## Notes\n')
  const originalNotes = original.headings.filter((heading) => heading.displayText === 'Notes')
  const revisionNotes = revision.headings.filter((heading) => heading.displayText === 'Notes')
  assert.equal(result.get(originalNotes[0].id)?.revisionId, revisionNotes[0].id)
  assert.equal(result.get(originalNotes[1].id)?.revisionId, revisionNotes[1].id)
})

test('falls back to section similarity when title and structure change', () => {
  const { original, result } = run(
    '# Root\n## Old title\ncommon words here about widgets\n',
    '# Root\n## New title\ncommon words here about widgets\n'
  )
  const oldHeading = original.headings.find((heading) => heading.displayText === 'Old title')!
  assert.notEqual(result.get(oldHeading.id)?.revisionId, null)
})

test('does not match unrelated sections', () => {
  const { original, result } = run(
    '# A\n## Alpha\nalpha alpha alpha\n',
    '# B\n## Beta\nbeta beta beta\n'
  )
  for (const heading of original.headings) {
    assert.equal(result.get(heading.id)?.revisionId, null)
  }
})
