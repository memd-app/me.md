import { eq, and, or, sql } from 'drizzle-orm'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { topics, insights, notes, messages, sessions } from '@/db/schema'

type Db = any // Drizzle sql.js instance

interface SearchResult {
  id: string
  type: 'topic' | 'insight' | 'session' | 'note'
  title: string
  snippet: string
  context?: string
  topicId?: string
  topicTitle?: string
  topicCategory?: string
  sessionId?: string
  verificationStatus?: string
  confidenceScore?: number
  createdAt?: string
}

interface SearchOptions {
  query: string
  filter?: string
  page?: number
  limit?: number
  verificationStatus?: string
  dateFrom?: string
  dateTo?: string
  minConfidence?: number
  maxConfidence?: number
}

/**
 * Search across topics, insights, sessions (via messages), and notes.
 * Uses LIKE-based full-text search with advanced filters.
 */
export function searchAll(db: Db, options: SearchOptions) {
  const userId = LOCAL_USER_ID
  const query = (options.query || '').trim().substring(0, 500)
  const filter = (options.filter || 'all').toLowerCase()
  const page = Math.max(1, options.page || 1)
  const limit = Math.min(50, Math.max(1, options.limit || 20))
  const offset = (page - 1) * limit

  const verificationStatusFilter = (options.verificationStatus || '').trim().toLowerCase()
  const dateFrom = (options.dateFrom || '').trim()
  const dateTo = (options.dateTo || '').trim()
  const minConfidence = options.minConfidence || 0
  const maxConfidence = options.maxConfidence || 100

  // Handle empty queries
  if (!query) {
    return {
      results: [],
      total: 0,
      page,
      limit,
      totalPages: 0,
      query: '',
      filter,
    }
  }

  // Escape SQL LIKE wildcards
  const escapedQuery = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  const searchPattern = `%${escapedQuery}%`
  const results: SearchResult[] = []

  // Search Topics
  if (filter === 'all' || filter === 'topics') {
    const topicResults = db.select().from(topics)
      .where(
        and(
          eq(topics.userId, userId),
          or(
            sql`${topics.title} LIKE ${searchPattern} ESCAPE '\\'`,
            sql`${topics.description} LIKE ${searchPattern} ESCAPE '\\'`,
            sql`${topics.tags} LIKE ${searchPattern} ESCAPE '\\'`
          )
        )
      )
      .all()

    for (const t of topicResults) {
      const snippet = getSnippet(t.title, t.description || '', query)
      results.push({
        id: t.id,
        type: 'topic',
        title: t.title,
        snippet,
        context: t.status || undefined,
        topicId: t.id,
        topicTitle: t.title,
        topicCategory: t.presetCategory || t.intent || undefined,
        createdAt: t.createdAt || undefined,
      })
    }
  }

  // Search Insights
  if (filter === 'all' || filter === 'insights') {
    const insightResults = db.select({
      insight: insights,
      topicTitle: topics.title,
      topicCategory: topics.presetCategory,
      topicIntent: topics.intent,
    }).from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(
        and(
          eq(insights.userId, userId),
          sql`${insights.content} LIKE ${searchPattern} ESCAPE '\\'`
        )
      )
      .all()

    for (const row of insightResults) {
      const i = row.insight
      const snippet = getSnippet(i.content, '', query)
      results.push({
        id: i.id,
        type: 'insight',
        title: truncate(i.content, 80),
        snippet,
        context: i.verificationStatus || undefined,
        topicId: i.topicId || undefined,
        topicTitle: row.topicTitle || undefined,
        topicCategory: row.topicCategory || row.topicIntent || undefined,
        verificationStatus: i.verificationStatus || undefined,
        confidenceScore: i.confidenceScore || undefined,
        createdAt: i.createdAt || undefined,
      })
    }
  }

  // Search Sessions (via messages)
  if (filter === 'all' || filter === 'sessions') {
    // For sql.js in browser, use Drizzle query with raw SQL for the join
    const sessionMsgs = db.select({
      message: messages,
      session: sessions,
      topicTitle: topics.title,
      topicCategory: topics.presetCategory,
      topicIntent: topics.intent,
    }).from(messages)
      .innerJoin(sessions, eq(messages.sessionId, sessions.id))
      .innerJoin(topics, eq(sessions.topicId, topics.id))
      .where(
        and(
          eq(sessions.userId, userId),
          sql`${messages.content} LIKE ${searchPattern} ESCAPE '\\'`
        )
      )
      .all()

    // Deduplicate by session - show first match per session
    const seenSessions = new Set<string>()
    for (const row of sessionMsgs) {
      const sessionId = row.session.id
      if (seenSessions.has(sessionId)) continue
      seenSessions.add(sessionId)

      const snippet = getSnippet(row.message.content, '', query)
      results.push({
        id: sessionId,
        type: 'session',
        title: `Session: ${row.topicTitle}`,
        snippet,
        context: row.session.status || undefined,
        topicId: row.session.topicId || undefined,
        topicTitle: row.topicTitle || undefined,
        topicCategory: row.topicCategory || row.topicIntent || undefined,
        sessionId,
        createdAt: row.session.createdAt || undefined,
      })
    }
  }

  // Search Notes
  if (filter === 'all' || filter === 'notes') {
    const noteResults = db.select({
      note: notes,
      topicTitle: topics.title,
      topicCategory: topics.presetCategory,
      topicIntent: topics.intent,
    }).from(notes)
      .leftJoin(topics, eq(notes.topicId, topics.id))
      .where(
        and(
          eq(notes.userId, userId),
          or(
            sql`${notes.title} LIKE ${searchPattern} ESCAPE '\\'`,
            sql`${notes.contentFullAnalysis} LIKE ${searchPattern} ESCAPE '\\'`,
            sql`${notes.contentBriefSummary} LIKE ${searchPattern} ESCAPE '\\'`,
            sql`${notes.contentDecisionFramework} LIKE ${searchPattern} ESCAPE '\\'`
          )
        )
      )
      .all()

    for (const row of noteResults) {
      const n = row.note
      const allContent = [
        n.contentFullAnalysis,
        n.contentBriefSummary,
        n.contentDecisionFramework,
      ].filter(Boolean).join(' ')
      const snippet = getSnippet(n.title || '', allContent, query)
      results.push({
        id: n.id,
        type: 'note',
        title: n.title || 'Untitled Note',
        snippet,
        topicId: n.topicId || undefined,
        topicTitle: row.topicTitle || undefined,
        topicCategory: row.topicCategory || row.topicIntent || undefined,
        sessionId: n.sessionId || undefined,
        createdAt: n.createdAt || undefined,
      })
    }
  }

  // Apply advanced filters
  let filteredResults = results

  // Filter by verification status
  if (verificationStatusFilter) {
    filteredResults = filteredResults.filter(r => {
      if (r.type === 'insight') {
        return r.verificationStatus === verificationStatusFilter
      }
      return filter !== 'insights'
    })
  }

  // Filter by date range
  if (dateFrom) {
    const fromDate = new Date(dateFrom)
    if (!isNaN(fromDate.getTime())) {
      filteredResults = filteredResults.filter(r => {
        if (!r.createdAt) return false
        return new Date(r.createdAt) >= fromDate
      })
    }
  }
  if (dateTo) {
    const toDate = new Date(dateTo)
    if (!isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999)
      filteredResults = filteredResults.filter(r => {
        if (!r.createdAt) return false
        return new Date(r.createdAt) <= toDate
      })
    }
  }

  // Filter by confidence score range
  if (minConfidence > 0 || maxConfidence < 100) {
    filteredResults = filteredResults.filter(r => {
      if (r.type === 'insight' && r.confidenceScore !== undefined) {
        return r.confidenceScore >= minConfidence && r.confidenceScore <= maxConfidence
      }
      return true
    })
  }

  // Sort by createdAt descending
  filteredResults.sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return dateB - dateA
  })

  const totalCount = filteredResults.length
  const totalPages = Math.ceil(totalCount / limit)

  // Apply pagination
  const paginatedResults = filteredResults.slice(offset, offset + limit)

  return {
    results: paginatedResults,
    total: totalCount,
    page,
    limit,
    totalPages,
    query,
    filter,
  }
}

/**
 * Get a snippet of text with the search query highlighted context.
 */
function getSnippet(primary: string, secondary: string, query: string): string {
  const text = primary + (secondary ? ' ' + secondary : '')
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matchIndex = lowerText.indexOf(lowerQuery)

  if (matchIndex === -1) {
    return truncate(text, 200)
  }

  const contextLength = 80
  const start = Math.max(0, matchIndex - contextLength)
  const end = Math.min(text.length, matchIndex + query.length + contextLength)

  let snippet = ''
  if (start > 0) snippet += '...'
  snippet += text.slice(start, end)
  if (end < text.length) snippet += '...'

  return snippet
}

/**
 * Truncate text to a maximum length.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}
