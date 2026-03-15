/**
 * Bookmarks Service
 * ==================
 * Ported from server/src/routes/bookmarks.ts
 * Manages message bookmarks for the local user.
 */

import { eq, and, desc } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import { bookmarks, messages, sessions, topics } from '@/db/schema'
import { scheduleSave } from '@/db/persistence'
import { LOCAL_USER_ID } from '@/contexts/UserContext'

type Db = SQLJsDatabase<typeof schema>

/**
 * Get all bookmarks for the local user, enriched with message, session, and topic details.
 */
export function getBookmarks(db: Db) {
  const userBookmarks = db.select().from(bookmarks)
    .where(eq(bookmarks.userId, LOCAL_USER_ID))
    .orderBy(desc(bookmarks.createdAt))
    .all()

  const enrichedBookmarks = userBookmarks.map(bm => {
    const message = db.select().from(messages).where(eq(messages.id, bm.messageId)).get()
    const session = db.select().from(sessions).where(eq(sessions.id, bm.sessionId)).get()
    let topic = null
    if (session) {
      topic = db.select().from(topics).where(eq(topics.id, session.topicId)).get()
    }

    return {
      ...bm,
      message: message ? {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      } : null,
      session: session ? {
        id: session.id,
        status: session.status,
        createdAt: session.createdAt,
      } : null,
      topic: topic ? {
        id: topic.id,
        title: topic.title,
      } : null,
    }
  })

  return { bookmarks: enrichedBookmarks }
}

/**
 * Create a bookmark for a message.
 */
export function createBookmark(db: Db, messageId: string, sessionId: string) {
  if (!messageId || !sessionId) throw new Error('messageId and sessionId are required')

  // Verify session belongs to user
  const session = db.select().from(sessions).where(
    and(eq(sessions.id, sessionId), eq(sessions.userId, LOCAL_USER_ID))
  ).get()
  if (!session) throw new Error('Session not found')

  // Verify message belongs to session
  const message = db.select().from(messages).where(
    and(eq(messages.id, messageId), eq(messages.sessionId, sessionId))
  ).get()
  if (!message) throw new Error('Message not found')

  // Check for existing bookmark
  const existing = db.select().from(bookmarks).where(
    and(eq(bookmarks.messageId, messageId), eq(bookmarks.userId, LOCAL_USER_ID))
  ).get()

  if (existing) {
    return { bookmark: existing, message: 'Already bookmarked' }
  }

  const bookmarkId = crypto.randomUUID()
  const newBookmark = db.insert(bookmarks).values({
    id: bookmarkId,
    userId: LOCAL_USER_ID,
    messageId,
    sessionId,
  }).returning().get()

  // Update message bookmark flag
  db.update(messages).set({ isBookmarked: true }).where(eq(messages.id, messageId)).run()

  scheduleSave()

  return { bookmark: newBookmark }
}

/**
 * Delete a bookmark by message ID.
 */
export function deleteBookmark(db: Db, messageId: string) {
  const existing = db.select().from(bookmarks).where(
    and(eq(bookmarks.messageId, messageId), eq(bookmarks.userId, LOCAL_USER_ID))
  ).get()

  if (!existing) throw new Error('Bookmark not found')

  db.delete(bookmarks).where(eq(bookmarks.id, existing.id)).run()

  // Update message bookmark flag
  db.update(messages).set({ isBookmarked: false }).where(eq(messages.id, messageId)).run()

  scheduleSave()

  return { success: true, message: 'Bookmark removed' }
}
