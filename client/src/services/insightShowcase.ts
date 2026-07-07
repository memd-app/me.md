import { and, desc, eq } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import { insights, topics } from '@/db/schema'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { KIND_LABELS } from '@/services/obsidianExport'

type Db = SQLJsDatabase<typeof schema>

export interface ShowcaseInsight {
  id: string
  content: string
  kind: string | null
  confidenceScore: number
  priorAlignment: string | null
  evidenceCount: number
  topicTitle: string | null
}

export interface ShowcaseSelection {
  quotes: ShowcaseInsight[]
  tensionPair: { tension: ShowcaseInsight; counterpart: ShowcaseInsight | null } | null
}

export function getShowcaseSourceInsights(db: Db): ShowcaseInsight[] {
  return db.select({
    id: insights.id,
    content: insights.content,
    kind: insights.kind,
    confidenceScore: insights.confidenceScore,
    priorAlignment: insights.priorAlignment,
    evidenceCount: insights.evidenceCount,
    topicTitle: topics.title,
  }).from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(and(
      eq(insights.userId, LOCAL_USER_ID),
      eq(insights.verificationStatus, 'verified'),
      eq(insights.privacyTier, 'exportable'),
    ))
    .orderBy(desc(insights.confidenceScore))
    .all()
    .map(row => ({
      id: row.id,
      content: row.content,
      kind: row.kind ?? null,
      confidenceScore: row.confidenceScore ?? 50,
      priorAlignment: row.priorAlignment ?? null,
      evidenceCount: row.evidenceCount ?? 0,
      topicTitle: row.topicTitle ?? null,
    }))
}

export function selectShowcase(source: ShowcaseInsight[]): ShowcaseSelection {
  const quotable = source.filter(isQuotable)

  const perKind = KIND_LABELS
    .map(([kind]) => topRanked(quotable.filter(item => item.kind === kind && item.priorAlignment === 'corroborated')))
    .filter((item): item is ShowcaseInsight => item !== null)

  const quotes = [...perKind].sort(rankInsights).slice(0, 6)
  const tension = topRanked(quotable.filter(item => item.priorAlignment === 'tension'))
  if (!tension) return { quotes, tensionPair: null }

  const counterpart = selectCounterpart(quotable, tension)
  const tensionIds = new Set([tension.id, counterpart?.id].filter((id): id is string => Boolean(id)))

  return {
    quotes: quotes.filter(item => !tensionIds.has(item.id)),
    tensionPair: { tension, counterpart },
  }
}

export function extractStandfirst(body: string | null | undefined): string | null {
  if (!body) return null

  const text = body
    .split('\n')
    .filter(line => !/^\s*#{1,3}\s+/.test(line))
    .map(line => line
      .trim()
      .replace(/^(?:>\s*)+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/__/g, '')
      .trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  const match = text.match(/^.*?[.!?](?=\s|$)/)
  const standfirst = (match ? match[0] : text).trim()
  if (!standfirst || standfirst.length > 220) return null
  return standfirst
}

export function splitFacetBody(body: string): { main: string; tensions: string | null } {
  const lines = body.split('\n')
  const tensionIndex = lines.findIndex(line => /^###\s+Tensions/i.test(line.trim()))

  if (tensionIndex === -1) return { main: body.trim(), tensions: null }

  const main = lines.slice(0, tensionIndex).join('\n').trim()
  const tensions = lines.slice(tensionIndex + 1).join('\n').trim()
  return { main, tensions: tensions || null }
}

function isQuotable(insight: ShowcaseInsight): boolean {
  const length = insight.content.trim().length
  return length >= 40 && length <= 280
}

function topRanked(items: ShowcaseInsight[]): ShowcaseInsight | null {
  return [...items].sort(rankInsights)[0] ?? null
}

function selectCounterpart(quotable: ShowcaseInsight[], tension: ShowcaseInsight): ShowcaseInsight | null {
  const nonTension = quotable.filter(item => item.id !== tension.id && item.priorAlignment !== 'tension')

  if (tension.kind !== null) {
    const sameKind = topRanked(nonTension.filter(item => item.kind === tension.kind))
    if (sameKind) return sameKind
  }

  if (tension.topicTitle !== null) {
    const sameTopic = topRanked(nonTension.filter(item => item.topicTitle === tension.topicTitle))
    if (sameTopic) return sameTopic
  }

  return null
}

function rankInsights(a: ShowcaseInsight, b: ShowcaseInsight): number {
  if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore
  if (b.evidenceCount !== a.evidenceCount) return b.evidenceCount - a.evidenceCount
  if (a.content.length !== b.content.length) return a.content.length - b.content.length
  return a.id.localeCompare(b.id)
}
