import { Router } from 'express';
import { db, sqlite } from '../config/database.js';
import { topics, insights, notes, messages, sessions } from '../models/schema.js';
import { eq, and, like, or, desc } from 'drizzle-orm';

export const searchRouter = Router();

interface SearchResult {
  id: string;
  type: 'topic' | 'insight' | 'session' | 'note';
  title: string;
  snippet: string;
  context?: string;
  topicId?: string;
  topicTitle?: string;
  sessionId?: string;
  verificationStatus?: string;
  confidenceScore?: number;
  createdAt?: string;
}

// GET /api/search?q=<query>&filter=<all|topics|insights|sessions|notes>&page=<number>&limit=<number>
searchRouter.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const query = (req.query.q as string || '').trim();
    const filter = (req.query.filter as string || 'all').toLowerCase();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    if (!query) {
      return res.json({
        results: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        query: '',
        filter,
      });
    }

    const searchPattern = `%${query}%`;
    const results: SearchResult[] = [];
    let totalCount = 0;

    // Search Topics
    if (filter === 'all' || filter === 'topics') {
      const topicResults = db.select().from(topics)
        .where(
          and(
            eq(topics.userId, userId),
            or(
              like(topics.title, searchPattern),
              like(topics.description, searchPattern),
              like(topics.tags, searchPattern)
            )
          )
        )
        .all();

      for (const t of topicResults) {
        const snippet = getSnippet(t.title, t.description || '', query);
        results.push({
          id: t.id,
          type: 'topic',
          title: t.title,
          snippet,
          context: t.status || undefined,
          topicId: t.id,
          topicTitle: t.title,
          createdAt: t.createdAt || undefined,
        });
      }
    }

    // Search Insights
    if (filter === 'all' || filter === 'insights') {
      const insightResults = db.select({
        insight: insights,
        topicTitle: topics.title,
      }).from(insights)
        .leftJoin(topics, eq(insights.topicId, topics.id))
        .where(
          and(
            eq(insights.userId, userId),
            like(insights.content, searchPattern)
          )
        )
        .all();

      for (const row of insightResults) {
        const i = row.insight;
        const snippet = getSnippet(i.content, '', query);
        results.push({
          id: i.id,
          type: 'insight',
          title: truncate(i.content, 80),
          snippet,
          context: i.verificationStatus || undefined,
          topicId: i.topicId || undefined,
          topicTitle: row.topicTitle || undefined,
          verificationStatus: i.verificationStatus || undefined,
          confidenceScore: i.confidenceScore || undefined,
          createdAt: i.createdAt || undefined,
        });
      }
    }

    // Search Sessions (via messages)
    if (filter === 'all' || filter === 'sessions') {
      // Find messages that match, then group by session
      // Use raw SQL for the join across sessions -> messages -> topics
      const messageResults = sqlite.prepare(`
        SELECT
          m.id as message_id,
          m.content as message_content,
          m.role as message_role,
          m.created_at as message_created_at,
          s.id as session_id,
          s.created_at as session_created_at,
          s.status as session_status,
          t.id as topic_id,
          t.title as topic_title
        FROM messages m
        JOIN sessions s ON m.session_id = s.id
        JOIN topics t ON s.topic_id = t.id
        WHERE s.user_id = ?
          AND m.content LIKE ?
        ORDER BY m.created_at DESC
      `).all(userId, searchPattern) as Array<{
        message_id: string;
        message_content: string;
        message_role: string;
        message_created_at: string;
        session_id: string;
        session_created_at: string;
        session_status: string;
        topic_id: string;
        topic_title: string;
      }>;

      // Deduplicate by session - show first match per session
      const seenSessions = new Set<string>();
      for (const msg of messageResults) {
        if (seenSessions.has(msg.session_id)) continue;
        seenSessions.add(msg.session_id);

        const snippet = getSnippet(msg.message_content, '', query);
        results.push({
          id: msg.session_id,
          type: 'session',
          title: `Session: ${msg.topic_title}`,
          snippet,
          context: msg.session_status || undefined,
          topicId: msg.topic_id || undefined,
          topicTitle: msg.topic_title || undefined,
          sessionId: msg.session_id,
          createdAt: msg.session_created_at || undefined,
        });
      }
    }

    // Search Notes
    if (filter === 'all' || filter === 'notes') {
      const noteResults = db.select({
        note: notes,
        topicTitle: topics.title,
      }).from(notes)
        .leftJoin(topics, eq(notes.topicId, topics.id))
        .where(
          and(
            eq(notes.userId, userId),
            or(
              like(notes.title, searchPattern),
              like(notes.contentFullAnalysis, searchPattern),
              like(notes.contentBriefSummary, searchPattern),
              like(notes.contentDecisionFramework, searchPattern)
            )
          )
        )
        .all();

      for (const row of noteResults) {
        const n = row.note;
        // Search across all content fields to find the best snippet
        const allContent = [
          n.contentFullAnalysis,
          n.contentBriefSummary,
          n.contentDecisionFramework,
        ].filter(Boolean).join(' ');
        const snippet = getSnippet(n.title || '', allContent, query);
        results.push({
          id: n.id,
          type: 'note',
          title: n.title || 'Untitled Note',
          snippet,
          topicId: n.topicId || undefined,
          topicTitle: row.topicTitle || undefined,
          sessionId: n.sessionId || undefined,
          createdAt: n.createdAt || undefined,
        });
      }
    }

    // Sort all results by createdAt descending (most recent first)
    results.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    totalCount = results.length;
    const totalPages = Math.ceil(totalCount / limit);

    // Apply pagination
    const paginatedResults = results.slice(offset, offset + limit);

    res.json({
      results: paginatedResults,
      total: totalCount,
      page,
      limit,
      totalPages,
      query,
      filter,
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * Get a snippet of text with the search query highlighted context.
 * Returns surrounding text around the first match.
 */
function getSnippet(primary: string, secondary: string, query: string): string {
  const text = primary + (secondary ? ' ' + secondary : '');
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);

  if (matchIndex === -1) {
    return truncate(text, 200);
  }

  // Show context around the match
  const contextLength = 80;
  const start = Math.max(0, matchIndex - contextLength);
  const end = Math.min(text.length, matchIndex + query.length + contextLength);

  let snippet = '';
  if (start > 0) snippet += '...';
  snippet += text.slice(start, end);
  if (end < text.length) snippet += '...';

  return snippet;
}

/**
 * Truncate text to a maximum length
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
