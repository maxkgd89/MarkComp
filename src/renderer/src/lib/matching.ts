import type { HeadingNode, ParsedDocument } from './markdown'

export type MatchStrategy = 'id' | 'text' | 'path' | 'similarity' | 'none'

export interface MatchResult {
  originalId: string
  revisionId: string | null
  strategy: MatchStrategy
}

interface Meta {
  path: string
  siblingIndex: number
}

function buildMeta(document: ParsedDocument): {
  byId: Map<string, HeadingNode>
  meta: Map<string, Meta>
} {
  const byId = new Map<string, HeadingNode>()
  for (const heading of document.headings) byId.set(heading.id, heading)

  const meta = new Map<string, Meta>()

  const pathOf = (node: HeadingNode): string => {
    const parts: string[] = []
    let current = node
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent) break
      parts.push(parent.displayText.toLowerCase())
      current = parent
    }
    return parts.reverse().join('\u0000')
  }

  const assign = (list: HeadingNode[]): void => {
    for (let i = 0; i < list.length; i++) {
      const node = list[i]
      meta.set(node.id, { path: pathOf(node), siblingIndex: i })
      assign(node.children)
    }
  }
  assign(document.roots)

  return { byId, meta }
}

function push(map: Map<string, HeadingNode[]>, key: string, node: HeadingNode): void {
  const list = map.get(key)
  if (list) list.push(node)
  else map.set(key, [node])
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection++
  return intersection / (a.size + b.size - intersection)
}

function matchesRevisionId(
  result: Map<string, MatchResult>,
  originalId: string
): string | null {
  return result.get(originalId)?.revisionId ?? null
}

/**
 * Deterministically match original headings to revision headings.
 *
 * Layered strategy: stable id -> normalized text + level (occurrence order)
 * -> structural path + level + sibling index -> unique structural path
 * -> section-content similarity. Unmatched headings stay null; they are never
 * pointed at an unrelated section.
 */
export function matchHeadings(
  original: ParsedDocument,
  revision: ParsedDocument
): Map<string, MatchResult> {
  const result = new Map<string, MatchResult>()
  const used = new Set<string>()
  const originalMeta = buildMeta(original)
  const revisionMeta = buildMeta(revision)

  const record = (o: HeadingNode, r: HeadingNode | null, strategy: MatchStrategy): void => {
    if (r) {
      if (used.has(r.id)) return
      used.add(r.id)
    }
    result.set(o.id, {
      originalId: o.id,
      revisionId: r ? r.id : null,
      strategy
    })
  }

  const revisionByText = new Map<string, HeadingNode[]>()
  const revisionByPathIndex = new Map<string, HeadingNode[]>()
  const revisionByPathLevel = new Map<string, HeadingNode[]>()

  for (const r of revision.headings) {
    const info = revisionMeta.meta.get(r.id)
    if (!info) continue
    push(revisionByText, `${r.level}|${r.displayText.toLowerCase()}`, r)
    push(revisionByPathIndex, `${r.level}|${info.path}|${info.siblingIndex}`, r)
    push(revisionByPathLevel, `${r.level}|${info.path}`, r)
  }

  // 1. Stable identity.
  for (const o of original.headings) {
    const r = revisionMeta.byId.get(o.id)
    if (r) record(o, r, 'id')
  }

  // 2. Normalized text + level, in duplicate-occurrence order.
  for (const o of original.headings) {
    if (result.has(o.id)) continue
    const candidates = revisionByText.get(`${o.level}|${o.displayText.toLowerCase()}`) ?? []
    const r = candidates.find((candidate) => !used.has(candidate.id))
    if (r) record(o, r, 'text')
  }

  // 3. Structural path + level + sibling index inside a matched parent
  //    (tolerates renames without pairing unrelated roots).
  for (const o of original.headings) {
    if (result.has(o.id)) continue
    if (!o.parentId) continue
    const parentRevisionId = matchesRevisionId(result, o.parentId)
    if (!parentRevisionId) continue
    const info = originalMeta.meta.get(o.id)
    if (!info) continue
    const candidates =
      revisionByPathIndex.get(`${o.level}|${info.path}|${info.siblingIndex}`) ?? []
    const r = candidates.find(
      (candidate) => !used.has(candidate.id) && candidate.parentId === parentRevisionId
    )
    if (r) record(o, r, 'path')
  }

  // 4. Structural path + level when unambiguous inside a matched parent.
  for (const o of original.headings) {
    if (result.has(o.id)) continue
    if (!o.parentId) continue
    const parentRevisionId = matchesRevisionId(result, o.parentId)
    if (!parentRevisionId) continue
    const info = originalMeta.meta.get(o.id)
    if (!info) continue
    const candidates = (revisionByPathLevel.get(`${o.level}|${info.path}`) ?? []).filter(
      (candidate) =>
        !used.has(candidate.id) && candidate.parentId === parentRevisionId
    )
    if (candidates.length === 1) record(o, candidates[0], 'path')
  }

  // 5. Section-content similarity, same level, as a last resort.
  const tokenCache = new Map<string, Set<string>>()
  const sectionTokens = (node: HeadingNode, document: ParsedDocument): Set<string> => {
    const key = `${document.documentId}:${node.id}`
    const cached = tokenCache.get(key)
    if (cached) return cached
    const text = document.lines.slice(node.endLine + 1, node.sectionEndLine + 1).join(' ')
    const tokens = new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    tokenCache.set(key, tokens)
    return tokens
  }

  for (const o of original.headings) {
    if (result.has(o.id)) continue
    const originalTokens = sectionTokens(o, original)
    let best: HeadingNode | null = null
    let bestScore = 0
    let secondScore = 0

    for (const r of revision.headings) {
      if (used.has(r.id) || r.level !== o.level) continue
      const score = jaccard(originalTokens, sectionTokens(r, revision))
      if (score > bestScore) {
        secondScore = bestScore
        bestScore = score
        best = r
      } else if (score > secondScore) {
        secondScore = score
      }
    }

    if (best && bestScore >= 0.45 && bestScore - secondScore >= 0.05) {
      record(o, best, 'similarity')
    } else {
      record(o, null, 'none')
    }
  }

  for (const o of original.headings) {
    if (!result.has(o.id)) record(o, null, 'none')
  }

  return result
}
