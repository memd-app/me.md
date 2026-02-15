import { Router } from 'express';
import { db } from '../config/database.js';
import { topics, sessions, insights, notes } from '../models/schema.js';
import { eq, and, desc } from 'drizzle-orm';

export const dashboardRouter = Router();

// Knowledge categories for completeness tracking
const KNOWLEDGE_CATEGORIES = ['identity', 'skills', 'experiences', 'perspectives', 'goals'] as const;

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

    // Topics explored = topics that have at least one session
    const userSessions = db.select().from(sessions).where(eq(sessions.userId, userId)).all();
    const exploredTopicIds = new Set(userSessions.map(s => s.topicId));
    const topicsExplored = exploredTopicIds.size;

    const completedSessions = userSessions.filter(s => s.status === 'completed').length;
    const totalSessions = userSessions.length;

    // Count insights and verification stats
    const userInsights = db.select().from(insights).where(eq(insights.userId, userId)).all();
    const verifiedInsights = userInsights.filter(i => i.verificationStatus === 'verified').length;
    const rejectedInsights = userInsights.filter(i => i.verificationStatus === 'rejected').length;
    const totalInsights = userInsights.length;

    // Verification rate: approved / (approved + rejected) percentage
    const reviewedInsights = verifiedInsights + rejectedInsights;
    const verificationRate = reviewedInsights > 0
      ? Math.round((verifiedInsights / reviewedInsights) * 100)
      : 0;

    // Count notes
    const userNotes = db.select().from(notes).where(eq(notes.userId, userId)).all();

    // Knowledge completeness by category
    // For each preset category, count how many topics exist and how many have been explored (have sessions)
    const categoryCompleteness = KNOWLEDGE_CATEGORIES.map(category => {
      const categoryTopics = userTopics.filter(t => t.presetCategory === category);
      const totalInCategory = categoryTopics.length;
      const exploredInCategory = categoryTopics.filter(t => exploredTopicIds.has(t.id)).length;
      // Get insights for this category's topics
      const categoryTopicIds = new Set(categoryTopics.map(t => t.id));
      const categoryInsights = userInsights.filter(i => categoryTopicIds.has(i.topicId));
      const verifiedInCategory = categoryInsights.filter(i => i.verificationStatus === 'verified').length;

      return {
        category,
        label: category.charAt(0).toUpperCase() + category.slice(1),
        totalTopics: totalInCategory,
        exploredTopics: exploredInCategory,
        totalInsights: categoryInsights.length,
        verifiedInsights: verifiedInCategory,
        // Completeness = explored/total if topics exist, otherwise 0
        completeness: totalInCategory > 0
          ? Math.round((exploredInCategory / totalInCategory) * 100)
          : 0,
      };
    });

    res.json({
      topics: topicCount,
      topicsExplored,
      sessions: totalSessions,
      completedSessions,
      insights: totalInsights,
      verifiedInsights,
      rejectedInsights,
      verificationRate,
      notes: userNotes.length,
      categoryCompleteness,
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
