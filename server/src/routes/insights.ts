import { Router } from 'express';
import { db } from '../config/database.js';
import { insights, topics, sessions, verificationHistory } from '../models/schema.js';
import { eq, and, desc, or, sql, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export const insightsRouter = Router();

// GET /api/insights/stats - Get verification queue statistics
insightsRouter.get('/stats', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const allInsights = db.select().from(insights)
      .where(eq(insights.userId, userId))
      .all();

    const pending = allInsights.filter(i =>
      i.verificationStatus === 'unverified' || i.verificationStatus === 're_verification_pending'
    ).length;
    const verified = allInsights.filter(i => i.verificationStatus === 'verified').length;
    const rejected = allInsights.filter(i => i.verificationStatus === 'rejected').length;

    res.json({ pending, verified, rejected, total: allInsights.length });
  } catch (error) {
    console.error('Get insights stats error:', error);
    res.status(500).json({ error: 'Failed to get insights stats' });
  }
});

// GET /api/insights/pending - Get pending verification insights
insightsRouter.get('/pending', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const pendingInsights = db.select({
      insight: insights,
      topicTitle: topics.title,
    }).from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(
        and(
          eq(insights.userId, userId),
          or(
            eq(insights.verificationStatus, 'unverified'),
            eq(insights.verificationStatus, 're_verification_pending')
          )
        )
      )
      .orderBy(desc(insights.createdAt))
      .all();

    const result = pendingInsights.map(row => ({
      ...row.insight,
      topicTitle: row.topicTitle,
    }));

    res.json({ insights: result, count: result.length });
  } catch (error) {
    console.error('Get pending insights error:', error);
    res.status(500).json({ error: 'Failed to get pending insights' });
  }
});

// GET /api/insights - List all insights for a user (with optional status filter)
insightsRouter.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;
    const status = req.query.status as string | undefined;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    let conditions = [eq(insights.userId, userId)];
    if (status) {
      conditions.push(eq(insights.verificationStatus, status));
    }

    const userInsights = db.select({
      insight: insights,
      topicTitle: topics.title,
    }).from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(and(...conditions))
      .orderBy(desc(insights.createdAt))
      .all();

    const result = userInsights.map(row => ({
      ...row.insight,
      topicTitle: row.topicTitle,
    }));

    res.json({ insights: result, count: result.length });
  } catch (error) {
    console.error('List insights error:', error);
    res.status(500).json({ error: 'Failed to list insights' });
  }
});

// GET /api/insights/:id - Get a single insight
insightsRouter.get('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;
    const insightId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = db.select({
      insight: insights,
      topicTitle: topics.title,
    }).from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(
        and(eq(insights.id, insightId), eq(insights.userId, userId))
      )
      .get();

    if (!result) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    // Get verification history
    const history = db.select().from(verificationHistory)
      .where(eq(verificationHistory.insightId, insightId))
      .orderBy(desc(verificationHistory.createdAt))
      .all();

    res.json({
      ...result.insight,
      topicTitle: result.topicTitle,
      verificationHistory: history,
    });
  } catch (error) {
    console.error('Get insight error:', error);
    res.status(500).json({ error: 'Failed to get insight' });
  }
});

// POST /api/insights/:id/verify - Approve an insight (mark as verified)
insightsRouter.post('/:id/verify', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const insightId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Verify insight belongs to user
    const insight = db.select().from(insights).where(
      and(eq(insights.id, insightId), eq(insights.userId, userId))
    ).get();

    if (!insight) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    const now = new Date().toISOString();

    // Update the insight status to verified
    const updated = db.update(insights).set({
      verificationStatus: 'verified',
      verifiedAt: now,
      updatedAt: now,
    }).where(eq(insights.id, insightId)).returning().get();

    // Create verification history record
    db.insert(verificationHistory).values({
      id: uuidv4(),
      insightId,
      action: 'verified',
      previousContent: insight.content,
      newContent: insight.content,
    }).run();

    res.json({ insight: updated, message: 'Insight verified successfully' });
  } catch (error) {
    console.error('Verify insight error:', error);
    res.status(500).json({ error: 'Failed to verify insight' });
  }
});

// POST /api/insights/:id/reject - Reject an insight
insightsRouter.post('/:id/reject', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const insightId = req.params.id;
    const { reason } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const insight = db.select().from(insights).where(
      and(eq(insights.id, insightId), eq(insights.userId, userId))
    ).get();

    if (!insight) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    const now = new Date().toISOString();

    const updated = db.update(insights).set({
      verificationStatus: 'rejected',
      updatedAt: now,
    }).where(eq(insights.id, insightId)).returning().get();

    // Create verification history record
    db.insert(verificationHistory).values({
      id: uuidv4(),
      insightId,
      action: 'rejected',
      previousContent: insight.content,
      newContent: reason || null,
    }).run();

    res.json({ insight: updated, message: 'Insight rejected' });
  } catch (error) {
    console.error('Reject insight error:', error);
    res.status(500).json({ error: 'Failed to reject insight' });
  }
});

// PUT /api/insights/:id - Edit an insight's content
insightsRouter.put('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const insightId = req.params.id;
    const { content, agreementScore, privacyTier } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const insight = db.select().from(insights).where(
      and(eq(insights.id, insightId), eq(insights.userId, userId))
    ).get();

    if (!insight) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    const now = new Date().toISOString();
    const updates: Record<string, any> = { updatedAt: now };

    if (content !== undefined) {
      updates.content = content;
      // Create edit history record
      db.insert(verificationHistory).values({
        id: uuidv4(),
        insightId,
        action: 'edited',
        previousContent: insight.content,
        newContent: content,
      }).run();
    }
    if (agreementScore !== undefined) updates.agreementScore = agreementScore;
    if (privacyTier !== undefined) updates.privacyTier = privacyTier;

    const updated = db.update(insights).set(updates)
      .where(eq(insights.id, insightId)).returning().get();

    res.json({ insight: updated });
  } catch (error) {
    console.error('Update insight error:', error);
    res.status(500).json({ error: 'Failed to update insight' });
  }
});
