import { Router } from 'express';
import { db } from '../config/database.js';
import { topics, sessions, insights, notes, verificationHistory, bookmarks } from '../models/schema.js';
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

    // Insights per topic breakdown
    const topicInsightBreakdown = userTopics.map(topic => {
      const topicInsightsList = userInsights.filter(i => i.topicId === topic.id);
      const verified = topicInsightsList.filter(i => i.verificationStatus === 'verified').length;
      const rejected = topicInsightsList.filter(i => i.verificationStatus === 'rejected').length;
      const unverified = topicInsightsList.filter(i => i.verificationStatus === 'unverified' || i.verificationStatus === 're_verification_pending').length;
      return {
        topicId: topic.id,
        topicTitle: topic.title,
        category: topic.presetCategory || 'uncategorized',
        totalInsights: topicInsightsList.length,
        verified,
        rejected,
        unverified,
      };
    }).filter(t => t.totalInsights > 0) // Only include topics that have insights
      .sort((a, b) => b.totalInsights - a.totalInsights); // Sort by most insights first

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
      topicInsightBreakdown,
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
});

// GET /api/dashboard/activity - Get recent activity for a user (aggregated from multiple sources)
dashboardRouter.get('/activity', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const allActivities: Array<{
      id: string;
      type: string;
      title: string;
      description: string;
      status?: string;
      date: string;
    }> = [];

    // 1. Topic creation events
    const recentTopics = db.select().from(topics)
      .where(eq(topics.userId, userId))
      .orderBy(desc(topics.createdAt))
      .limit(10)
      .all();

    for (const topic of recentTopics) {
      allActivities.push({
        id: `topic-${topic.id}`,
        type: 'topic_created',
        title: topic.title,
        description: `Created topic "${topic.title}"`,
        date: topic.createdAt || new Date().toISOString(),
      });
    }

    // 2. Session events (started, completed, paused)
    const recentSessions = db.select({
      session: sessions,
      topicTitle: topics.title,
    }).from(sessions)
      .leftJoin(topics, eq(sessions.topicId, topics.id))
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.updatedAt))
      .limit(15)
      .all();

    for (const row of recentSessions) {
      const topicTitle = row.topicTitle || 'Unknown topic';
      const session = row.session;

      if (session.status === 'completed' && session.completedAt) {
        allActivities.push({
          id: `session-completed-${session.id}`,
          type: 'session_completed',
          title: topicTitle,
          description: `Completed interview session on "${topicTitle}"`,
          status: 'completed',
          date: session.completedAt,
        });
      }

      if (session.status === 'active') {
        allActivities.push({
          id: `session-started-${session.id}`,
          type: 'session_started',
          title: topicTitle,
          description: `Started interview session on "${topicTitle}"`,
          status: 'active',
          date: session.createdAt || new Date().toISOString(),
        });
      }

      if (session.status === 'paused') {
        allActivities.push({
          id: `session-paused-${session.id}`,
          type: 'session_paused',
          title: topicTitle,
          description: `Paused interview session on "${topicTitle}"`,
          status: 'paused',
          date: session.updatedAt || session.createdAt || new Date().toISOString(),
        });
      }
    }

    // 3. Insight verification events from verification_history
    const recentVerifications = db.select({
      vh: verificationHistory,
      insightContent: insights.content,
      topicTitle: topics.title,
    }).from(verificationHistory)
      .innerJoin(insights, eq(verificationHistory.insightId, insights.id))
      .innerJoin(topics, eq(insights.topicId, topics.id))
      .where(eq(insights.userId, userId))
      .orderBy(desc(verificationHistory.createdAt))
      .limit(15)
      .all();

    for (const row of recentVerifications) {
      const action = row.vh.action;
      const insightSnippet = (row.insightContent || '').substring(0, 60) + ((row.insightContent || '').length > 60 ? '...' : '');
      const topicTitle = row.topicTitle || 'Unknown topic';

      let actType = 'insight_verified';
      let description = '';

      if (action === 'verified' || action === 're_verified') {
        actType = 'insight_verified';
        description = `Verified insight: "${insightSnippet}"`;
      } else if (action === 'rejected' || action === 're_rejected') {
        actType = 'insight_rejected';
        description = `Rejected insight: "${insightSnippet}"`;
      } else if (action === 'edited') {
        actType = 'insight_edited';
        description = `Edited insight in "${topicTitle}"`;
      } else {
        actType = 'insight_action';
        description = `${action} insight in "${topicTitle}"`;
      }

      allActivities.push({
        id: `verification-${row.vh.id}`,
        type: actType,
        title: topicTitle,
        description,
        date: row.vh.createdAt || new Date().toISOString(),
      });
    }

    // 4. Note/distillation events
    const recentNotes = db.select({
      note: notes,
      topicTitle: topics.title,
    }).from(notes)
      .innerJoin(topics, eq(notes.topicId, topics.id))
      .where(eq(notes.userId, userId))
      .orderBy(desc(notes.createdAt))
      .limit(10)
      .all();

    for (const row of recentNotes) {
      const topicTitle = row.topicTitle || 'Unknown topic';
      allActivities.push({
        id: `note-${row.note.id}`,
        type: 'note_created',
        title: topicTitle,
        description: `Distilled notes from "${topicTitle}" session`,
        date: row.note.createdAt || new Date().toISOString(),
      });
    }

    // 5. Bookmark events
    const recentBookmarks = db.select({
      bookmark: bookmarks,
      topicTitle: topics.title,
    }).from(bookmarks)
      .innerJoin(sessions, eq(bookmarks.sessionId, sessions.id))
      .innerJoin(topics, eq(sessions.topicId, topics.id))
      .where(eq(bookmarks.userId, userId))
      .orderBy(desc(bookmarks.createdAt))
      .limit(5)
      .all();

    for (const row of recentBookmarks) {
      const topicTitle = row.topicTitle || 'Unknown topic';
      allActivities.push({
        id: `bookmark-${row.bookmark.id}`,
        type: 'bookmark_added',
        title: topicTitle,
        description: `Bookmarked a moment in "${topicTitle}"`,
        date: row.bookmark.createdAt || new Date().toISOString(),
      });
    }

    // Sort all activities by date (newest first) and take top 20
    allActivities.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    });

    const activity = allActivities.slice(0, 20);

    res.json({ activity });
  } catch (error) {
    console.error('Dashboard activity error:', error);
    res.status(500).json({ error: 'Failed to get dashboard activity' });
  }
});
