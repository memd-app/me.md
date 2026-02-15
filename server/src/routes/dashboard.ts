import { Router } from 'express';
import { db } from '../config/database.js';
import { topics, sessions, insights, notes } from '../models/schema.js';
import { eq, and, desc } from 'drizzle-orm';

export const dashboardRouter = Router();

// GET /api/dashboard/stats - Get dashboard statistics for a user
dashboardRouter.get('/stats', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Count topics
    const userTopics = db.select().from(topics).where(eq(topics.userId, userId)).all();
    const topicCount = userTopics.length;

    // Count sessions
    const userSessions = db.select().from(sessions).where(eq(sessions.userId, userId)).all();
    const completedSessions = userSessions.filter(s => s.status === 'completed').length;
    const totalSessions = userSessions.length;

    // Count insights
    const userInsights = db.select().from(insights).where(eq(insights.userId, userId)).all();
    const verifiedInsights = userInsights.filter(i => i.verificationStatus === 'verified').length;
    const totalInsights = userInsights.length;

    // Count notes
    const userNotes = db.select().from(notes).where(eq(notes.userId, userId)).all();

    res.json({
      topics: topicCount,
      sessions: totalSessions,
      completedSessions,
      insights: totalInsights,
      verifiedInsights,
      notes: userNotes.length,
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
});

// GET /api/dashboard/activity - Get recent activity for a user
dashboardRouter.get('/activity', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get recent sessions with topic titles
    const recentSessions = db.select({
      session: sessions,
      topicTitle: topics.title,
    }).from(sessions)
      .leftJoin(topics, eq(sessions.topicId, topics.id))
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.updatedAt))
      .limit(10)
      .all();

    const activity = recentSessions.map(row => ({
      id: row.session.id,
      type: 'session' as const,
      title: row.topicTitle || 'Unknown topic',
      status: row.session.status,
      date: row.session.updatedAt || row.session.createdAt,
    }));

    res.json({ activity });
  } catch (error) {
    console.error('Dashboard activity error:', error);
    res.status(500).json({ error: 'Failed to get dashboard activity' });
  }
});
