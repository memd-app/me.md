import { Router } from 'express';
import { db } from '../config/database.js';
import { bookmarks, messages, sessions, topics } from '../models/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export const bookmarksRouter = Router();

// POST /api/bookmarks - Create a bookmark for a message
bookmarksRouter.post('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { messageId, sessionId } = req.body;

    if (!messageId || !sessionId) {
      return res.status(400).json({ error: 'messageId and sessionId are required' });
    }

    // Verify the session belongs to the user
    const session = db.select().from(sessions).where(
      and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
    ).get();

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify the message belongs to the session
    const message = db.select().from(messages).where(
      and(eq(messages.id, messageId), eq(messages.sessionId, sessionId))
    ).get();

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check if bookmark already exists
    const existing = db.select().from(bookmarks).where(
      and(eq(bookmarks.messageId, messageId), eq(bookmarks.userId, userId))
    ).get();

    if (existing) {
      return res.status(200).json({ bookmark: existing, message: 'Already bookmarked' });
    }

    // Create the bookmark
    const bookmarkId = uuidv4();
    const newBookmark = db.insert(bookmarks).values({
      id: bookmarkId,
      userId,
      messageId,
      sessionId,
    }).returning().get();

    // Update the message's is_bookmarked flag
    db.update(messages).set({
      isBookmarked: true,
    }).where(eq(messages.id, messageId)).run();

    res.status(201).json({ bookmark: newBookmark });
  } catch (error) {
    console.error('Create bookmark error:', error);
    res.status(500).json({ error: 'Failed to create bookmark' });
  }
});

// DELETE /api/bookmarks/:messageId - Remove a bookmark by message ID
bookmarksRouter.delete('/:messageId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;
    const messageId = req.params.messageId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Find and delete the bookmark
    const existing = db.select().from(bookmarks).where(
      and(eq(bookmarks.messageId, messageId), eq(bookmarks.userId, userId))
    ).get();

    if (!existing) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }

    db.delete(bookmarks).where(eq(bookmarks.id, existing.id)).run();

    // Update the message's is_bookmarked flag
    db.update(messages).set({
      isBookmarked: false,
    }).where(eq(messages.id, messageId)).run();

    res.json({ success: true, message: 'Bookmark removed' });
  } catch (error) {
    console.error('Delete bookmark error:', error);
    res.status(500).json({ error: 'Failed to delete bookmark' });
  }
});

// GET /api/bookmarks - Get all bookmarks for a user (with message content and session context)
bookmarksRouter.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get all bookmarks for user, ordered by creation date
    const userBookmarks = db.select().from(bookmarks)
      .where(eq(bookmarks.userId, userId))
      .orderBy(desc(bookmarks.createdAt))
      .all();

    // Enrich each bookmark with message content, session info, and topic info
    const enrichedBookmarks = userBookmarks.map((bm) => {
      const message = db.select().from(messages)
        .where(eq(messages.id, bm.messageId))
        .get();

      const session = db.select().from(sessions)
        .where(eq(sessions.id, bm.sessionId))
        .get();

      let topic = null;
      if (session) {
        topic = db.select().from(topics)
          .where(eq(topics.id, session.topicId))
          .get();
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
      };
    });

    res.json({ bookmarks: enrichedBookmarks });
  } catch (error) {
    console.error('Get bookmarks error:', error);
    res.status(500).json({ error: 'Failed to get bookmarks' });
  }
});
