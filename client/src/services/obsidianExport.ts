import { and, desc, eq } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import { insights, topics } from '@/db/schema'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { generatePersonalityMarkdown, getPersonalityExportData } from '@/services/profile'
import { getProfileFacets, type FacetRecord } from '@/services/profileSynthesis'
import { combinedScore, DUPLICATE_THRESHOLD } from '@/services/similarity'
import type { NoteStatus } from '@/services/vaultReconcile'

type Db = SQLJsDatabase<typeof schema>

const ROOT_FOLDER = 'me.md'
const GENERAL_TOPIC = 'General'
const FORBIDDEN_PATH_CHARS = /[\/\\:#^|\[\]?*<>"`\x00-\x1F\x7F]/g

export const STATUS_DIRS: Record<NoteStatus, string> = {
  pending: `${ROOT_FOLDER}/Pending`,
  verified: `${ROOT_FOLDER}/Insights`,
  rejected: `${ROOT_FOLDER}/Rejected`,
}

export const KIND_LABELS: ReadonlyArray<[kind: string, label: string]> = [
  ['belief', 'Beliefs'],
  ['value', 'Values'],
  ['trait', 'Traits'],
  ['habit', 'Habits'],
  ['preference', 'Preferences'],
  ['goal', 'Goals'],
  ['motivation', 'Motivations'],
  ['relationship_pattern', 'Relationship patterns'],
  ['self_assessment', 'Self-assessments'],
]

export const RELATED_FLOOR = 0.15

export interface ObsidianNote {
  path: string
  content: string
  hash: string
}

export interface ObsidianExportResult {
  rootFolder: string
  notes: ObsidianNote[]
  insightCount: number
  topicCount: number
  hasPersonality: boolean
  hasFacets: boolean
  facetCount: number
}

interface InsightNoteData {
  id: string
  slug: string
  title: string
  content: string
  kind: string | null
}

interface TopicGroup {
  title: string
  link: string
  path: string
  insights: InsightNoteData[]
}

export interface InsightGenRow {
  id: string
  content: string
  confidenceScore: number | null
  verifiedAt: string | null
  updatedAt: string | null
  topicId: string | null
  topicTitle: string | null
  kind?: string | null
  related?: Array<{ slug: string; title: string }>
}

interface ExportRow {
  row: InsightGenRow
  group: TopicGroup
}

export function generateObsidianNotes(db: Db, opts?: { skipRelated?: boolean }): ObsidianExportResult {
  const rows = db.select({
    id: insights.id,
    content: insights.content,
    confidenceScore: insights.confidenceScore,
    verifiedAt: insights.verifiedAt,
    updatedAt: insights.updatedAt,
    topicId: insights.topicId,
    topicTitle: topics.title,
    kind: insights.kind,
  }).from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(and(
      eq(insights.userId, LOCAL_USER_ID),
      eq(insights.verificationStatus, 'verified'),
      eq(insights.privacyTier, 'exportable'),
    ))
    .orderBy(desc(insights.confidenceScore))
    .all()

  const personalityData = getPersonalityExportData(db, 'exportable')
  const hasPersonality = personalityData.hasAssessment
  const facets = getProfileFacets(db)
  const hasFacets = facets.length > 0

  if (rows.length === 0 && !hasPersonality && !hasFacets) {
    return {
      rootFolder: ROOT_FOLDER,
      notes: [],
      insightCount: 0,
      topicCount: 0,
      hasPersonality,
      hasFacets,
      facetCount: 0,
    }
  }

  const topicGroups = new Map<string, TopicGroup>()
  const exportRows: ExportRow[] = []

  for (const row of rows) {
    const topicName = sanitizeTopicTitle(row.topicTitle ?? GENERAL_TOPIC)
    const topicLink = `Topic - ${topicName}`
    const topicPath = `${ROOT_FOLDER}/Topics/${topicLink}.md`
    const groupKey = topicName
    let group = topicGroups.get(groupKey)
    if (!group) {
      group = { title: topicName, link: topicLink, path: topicPath, insights: [] }
      topicGroups.set(groupKey, group)
    }

    const title = deriveInsightTitle(row.content)
    const slug = slugify(row.id, title)

    const insightData: InsightNoteData = {
      id: row.id,
      slug,
      title,
      content: row.content,
      kind: row.kind ?? null,
    }
    group.insights.push(insightData)
    exportRows.push({ row, group })
  }

  const groups = Array.from(topicGroups.values())
  const insightNotes = exportRows.map(({ row, group }) => {
    const related = opts?.skipRelated ? [] : pickRelated(row, group.insights)
    // Bulk zip exports can enrich insight note frontmatter. Live vault per-insight
    // writers pass rows without these optional fields, preserving phase-2 bytes.
    return generateInsightNote({
      ...row,
      kind: row.kind ?? null,
      related,
    }).note
  })
  const topicNotes = groups.map(group => makeTopicNote(group))
  const notes: ObsidianNote[] = [
    makeIndexNote(groups, rows.length, hasPersonality, facets),
    ...topicNotes,
    ...insightNotes,
  ]

  if (hasPersonality) {
    const content = [
      toFrontmatter([
        ['title', 'Big Five'],
        ['source', ROOT_FOLDER],
        ['type', 'personality'],
      ]),
      '',
      generatePersonalityMarkdown(personalityData).trimEnd(),
      '',
    ].join('\n')
    notes.push(makeNote(`${ROOT_FOLDER}/Personality/Big Five.md`, content))
  }

  for (const facet of facets) {
    const lines = [
      toFrontmatter([
        ['title', facet.title],
        ['source', ROOT_FOLDER],
        ['type', 'profile-facet'],
      ]),
      '',
      `# ${facet.title}`,
      '',
      facet.body.trimEnd(),
      '',
    ]
    if (facet.agentBrief) {
      lines.push('## Agent brief', '', facet.agentBrief.trimEnd(), '')
    }
    notes.push(makeNote(`${ROOT_FOLDER}/Profile/${facet.title}.md`, lines.join('\n')))
  }

  return {
    rootFolder: ROOT_FOLDER,
    notes,
    insightCount: rows.length,
    topicCount: groups.length,
    hasPersonality,
    hasFacets,
    facetCount: facets.length,
  }
}

export function generateInsightNote(row: InsightGenRow, status: NoteStatus = 'verified'): { slug: string; note: ObsidianNote } {
  const topicName = sanitizeTopicTitle(row.topicTitle ?? GENERAL_TOPIC)
  const topicLink = `Topic - ${topicName}`
  const title = deriveInsightTitle(row.content)
  const slug = slugify(row.id, title)
  const verified = formatDate(row.verifiedAt ?? row.updatedAt)
  const fields: Array<[string, string | number | string[]]> = [
    ['title', title],
    ['topic', topicName],
    ['confidence', Math.round(row.confidenceScore ?? 50)],
  ]
  if (row.kind) fields.push(['kind', row.kind])
  if (row.related && row.related.length > 0) {
    fields.push([
      'related',
      row.related.map(item => `[[${item.slug}|${sanitizeWikiAlias(item.title)}]]`),
    ])
  }
  if (verified) fields.push(['verified', verified])
  fields.push(['status', status], ['source', ROOT_FOLDER], ['id', row.id])

  const content = [
    toFrontmatter(fields),
    '',
    row.content,
    '',
    `Topic: [[${topicLink}]]`,
    '',
  ].join('\n')

  return {
    slug,
    note: makeNote(`${STATUS_DIRS[status]}/${slug}.md`, content),
  }
}

export function slugify(id: string, title: string): string {
  const compactId = id.replace(/^(?:insight|ins)-/i, '').replace(/[^a-z0-9]/gi, '')
  const idFragment = (compactId.slice(0, 6) || stableHash(id).slice(0, 6)).toLowerCase()
  const titleSlug = sanitizeInsightSlugTitle(title)
  const fullSlug = titleSlug ? `ins-${idFragment}-${titleSlug}` : `ins-${idFragment}`
  const trimmed = fullSlug.slice(0, 80).replace(/[.-]+$/g, '')
  return trimmed && trimmed !== '.' && trimmed !== '..' ? trimmed : `ins-${idFragment}`
}

export function toFrontmatter(fields: Array<[string, string | number | string[]]>): string {
  const lines = fields.flatMap(([key, value]) => {
    if (Array.isArray(value)) {
      return [`${key}:`, ...value.map(item => `  - "${escapeYamlString(item)}"`)]
    }
    if (typeof value === 'number') return `${key}: ${value}`
    return `${key}: "${escapeYamlString(value)}"`
  })
  return ['---', ...lines, '---'].join('\n')
}

// Wiki-link aliases cannot contain link/alias delimiters.
export function sanitizeWikiAlias(title: string): string {
  return title.replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim()
}

// FNV-1a over UTF-16 code units. This is non-crypto and only used for cheap change detection.
export function stableHash(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function makeTopicNote(group: TopicGroup): ObsidianNote {
  const linkInsight = (insight: InsightNoteData) => `- [[${insight.slug}|${sanitizeWikiAlias(insight.title)}]]`
  const hasKind = group.insights.some(insight => insight.kind !== null)
  const lines = [
    toFrontmatter([
      ['title', group.title],
      ['source', ROOT_FOLDER],
      ['type', 'topic'],
    ]),
    '',
    `# ${group.title}`,
    '',
  ]

  if (!hasKind) {
    lines.push(...group.insights.map(linkInsight), '')
  } else {
    for (const [kind, label] of KIND_LABELS) {
      const section = group.insights.filter(insight => insight.kind === kind)
      if (section.length === 0) continue
      lines.push(`### ${label}`, ...section.map(linkInsight), '')
    }

    const other = group.insights.filter(insight => insight.kind === null)
    if (other.length > 0) {
      lines.push('### Other', ...other.map(linkInsight), '')
    }
  }

  lines.push('[[Me - Index]]', '')
  return makeNote(group.path, lines.join('\n'))
}

function makeIndexNote(groups: TopicGroup[], insightCount: number, hasPersonality: boolean, facets: FacetRecord[]): ObsidianNote {
  const topicGroups = [...groups].sort((a, b) => b.insights.length - a.insights.length || a.title.localeCompare(b.title))
  const facetSummary = facets.length > 0 ? ` · ${formatCount(facets.length, 'profile facet')}` : ''
  const lines = [
    toFrontmatter([
      ['title', 'Me - Index'],
      ['source', ROOT_FOLDER],
      ['type', 'moc'],
    ]),
    '',
    '# Me — Index',
    '',
    `> Auto-generated from me.md. ${formatCount(insightCount, 'verified insight')} · ${formatCount(groups.length, 'topic')}${facetSummary}.`,
    '',
  ]

  if (topicGroups.length > 0) {
    lines.push('## Topics', '')
    lines.push(...topicGroups.map(group => `- [[${group.link}]] · ${formatCount(group.insights.length, 'insight')}`))
    lines.push('')
  }

  if (hasPersonality) {
    lines.push('## Personality', '', '- [[Big Five]]', '')
  }

  if (facets.length > 0) {
    lines.push('## Profile', '')
    lines.push(...facets.map(facet => `- [[${facet.title}]]`))
    lines.push('')
  }

  return makeNote(`${ROOT_FOLDER}/Me - Index.md`, lines.join('\n'))
}

export function pickRelated(
  self: { id: string; content: string },
  siblings: Array<{ id: string; content: string; slug: string; title: string }>,
): Array<{ slug: string; title: string }> {
  return siblings
    .filter(sibling => sibling.id !== self.id)
    .map(sibling => ({
      sibling,
      score: combinedScore(self.content, sibling.content),
    }))
    .filter(item => item.score >= RELATED_FLOOR && item.score < DUPLICATE_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.sibling.slug.localeCompare(b.sibling.slug))
    .slice(0, 3)
    .map(({ sibling }) => ({ slug: sibling.slug, title: sibling.title }))
}

function formatCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function makeNote(path: string, content: string): ObsidianNote {
  return {
    path,
    content,
    hash: stableHash(content),
  }
}

function deriveInsightTitle(content: string): string {
  const singleLine = content.replace(/\s+/g, ' ').trim()
  if (!singleLine) return 'Untitled Insight'
  const sentenceEnd = singleLine.search(/[.!?](?:\s|$)/)
  const candidate = sentenceEnd >= 0 ? singleLine.slice(0, sentenceEnd) : singleLine
  const shortened = candidate.length > 80 ? candidate.slice(0, 80) : candidate
  return shortened.trim() || 'Untitled Insight'
}

function sanitizeInsightSlugTitle(title: string): string {
  const words = toAscii(title)
    .replace(FORBIDDEN_PATH_CHARS, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(' ')
    .slice(0, 48)

  return words
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
}

function sanitizeTopicTitle(title: string): string {
  const sanitized = toAscii(title)
    .replace(FORBIDDEN_PATH_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.-]+|[.-]+$/g, '')
  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : GENERAL_TOPIC
}

function toAscii(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const stableDate = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  if (stableDate) return stableDate[1]
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function escapeYamlString(value: string): string {
  return value
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}
