import { Router } from 'express';
import { db } from '../config/database.js';
import { insights, topics, sessions, verificationHistory, conceptNodes, conceptEdges } from '../models/schema.js';
import { eq, and, desc, or, sql, inArray, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export const insightsRouter = Router();

// ============================================
// Re-verification interval calculation
// ============================================

/**
 * Classify an insight to determine its re-verification interval.
 * Based on the app spec:
 * - Situational insights: 1-4 weeks (weekly)
 * - Preference insights: 3-6 months (quarterly)
 * - Core trait insights: 6-12 months (biannual)
 */
function classifyInsightInterval(content: string, confidenceScore: number | null): string {
  const lowerContent = content.toLowerCase();
  const confidence = confidenceScore ?? 50;

  // Core traits: deeply held values, identity, beliefs - highest confidence, stable over time
  const coreTraitPatterns = /\b(always|never|identity|core|fundamental|deeply|who i am|my nature|trait|personality|character|values?|believe|principle|philosophy)\b/i;

  // Preferences: likes, dislikes, styles, approaches - moderately stable
  const preferencePatterns = /\b(prefer|like|enjoy|favorite|style|approach|tend to|usually|comfortable|dislike|hate|love|way i|how i)\b/i;

  // Situational: current feelings, recent events, context-dependent - changes frequently
  const situationalPatterns = /\b(currently|right now|lately|recently|at the moment|these days|this week|this month|feeling|situation|context|today)\b/i;

  if (situationalPatterns.test(lowerContent)) {
    return 'weekly'; // Re-verify in 1-4 weeks
  }

  if (coreTraitPatterns.test(lowerContent) && confidence >= 75) {
    return 'biannual'; // Re-verify in 6-12 months
  }

  if (preferencePatterns.test(lowerContent)) {
    return 'quarterly'; // Re-verify in 3-6 months
  }

  // Default: monthly for moderate insights
  if (confidence >= 70) {
    return 'quarterly';
  }

  return 'monthly'; // Default for unclassified, moderate-confidence insights
}

/**
 * Calculate the re_verify_at timestamp based on the interval.
 * Returns an ISO string for the target re-verification date.
 */
function calculateReVerifyAt(interval: string): string {
  const now = new Date();

  switch (interval) {
    case 'weekly':
      // 1-4 weeks: use 2 weeks as default
      now.setDate(now.getDate() + 14);
      break;
    case 'monthly':
      // ~1 month
      now.setMonth(now.getMonth() + 1);
      break;
    case 'quarterly':
      // 3 months
      now.setMonth(now.getMonth() + 3);
      break;
    case 'biannual':
      // 6 months
      now.setMonth(now.getMonth() + 6);
      break;
    case 'annual':
      // 12 months
      now.setFullYear(now.getFullYear() + 1);
      break;
    default:
      // Default to monthly
      now.setMonth(now.getMonth() + 1);
      break;
  }

  return now.toISOString();
}

/**
 * Check for insights that are due for re-verification and mark them.
 * Called on server startup and periodically.
 */
export function checkReVerificationDue(asOfDate?: string): number {
  const now = asOfDate || new Date().toISOString();

  // Find all verified insights where re_verify_at has passed
  const dueInsights = db.select().from(insights)
    .where(
      and(
        eq(insights.verificationStatus, 'verified'),
        lte(insights.reVerifyAt, now)
      )
    )
    .all()
    .filter(i => i.reVerifyAt !== null);

  let count = 0;
  for (const insight of dueInsights) {
    db.update(insights).set({
      verificationStatus: 're_verification_pending',
      updatedAt: now,
    }).where(eq(insights.id, insight.id)).run();

    // Record in verification history
    db.insert(verificationHistory).values({
      id: uuidv4(),
      insightId: insight.id,
      action: 're_verification_triggered',
      previousContent: insight.content,
      newContent: `Re-verification triggered (interval: ${insight.reVerifyInterval})`,
    }).run();

    count++;
  }

  if (count > 0) {
    console.log(`[me.md] Re-verification check: ${count} insight(s) marked for re-verification`);
  }

  return count;
}

// GET /api/insights/stats - Get verification queue statistics
insightsRouter.get('/stats', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

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
    const userId = req.headers['x-user-id'] as string;

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
    const userId = req.headers['x-user-id'] as string;
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
    const userId = req.headers['x-user-id'] as string;
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
    const userId = req.headers['x-user-id'] as string;
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

    // Allow client to specify interval, or auto-classify
    const requestedInterval = req.body.reVerifyInterval;
    const validIntervals = ['weekly', 'monthly', 'quarterly', 'biannual', 'annual'];
    if (requestedInterval && !validIntervals.includes(requestedInterval)) {
      return res.status(400).json({
        error: `Invalid re-verification interval "${requestedInterval}". Must be one of: ${validIntervals.join(', ')}`
      });
    }
    const reVerifyInterval = requestedInterval || classifyInsightInterval(insight.content, insight.confidenceScore);
    const reVerifyAt = calculateReVerifyAt(reVerifyInterval);

    // Determine action for verification history
    const isReVerification = insight.verificationStatus === 're_verification_pending';
    const historyAction = isReVerification ? 're_verified' : 'verified';

    // Update the insight status to verified with re-verification scheduling
    const updated = db.update(insights).set({
      verificationStatus: 'verified',
      verifiedAt: now,
      reVerifyInterval,
      reVerifyAt,
      updatedAt: now,
    }).where(eq(insights.id, insightId)).returning().get();

    // Create verification history record
    db.insert(verificationHistory).values({
      id: uuidv4(),
      insightId,
      action: historyAction,
      previousContent: insight.content,
      newContent: insight.content,
    }).run();

    // Create concept node for newly verified insight (if one doesn't already exist)
    // This ensures the knowledge graph grows as insights are verified
    let newConceptNode = null;
    if (!isReVerification) {
      const existingConceptNode = db.select().from(conceptNodes)
        .where(
          and(
            eq(conceptNodes.insightId, insightId),
            eq(conceptNodes.userId, userId)
          )
        ).get();

      if (!existingConceptNode) {
        const nodeId = uuidv4();
        newConceptNode = db.insert(conceptNodes).values({
          id: nodeId,
          userId,
          topicId: insight.topicId,
          insightId: insightId,
          label: insight.content.substring(0, 60),
          weight: (insight.confidenceScore ?? 50) / 100,
        }).returning().get();
        console.log(`[me.md] Created concept node for verified insight: ${nodeId} (label: "${insight.content.substring(0, 40)}...")`);
      }
    }

    // Check if all insights for this topic are now verified/rejected
    // If so, automatically transition topic status to 'refined'
    let topicRefined = false;
    if (insight.topicId) {
      const topicInsights = db.select().from(insights)
        .where(eq(insights.topicId, insight.topicId))
        .all();
      const allResolved = topicInsights.length > 0 && topicInsights.every(
        i => i.verificationStatus === 'verified' || i.verificationStatus === 'rejected'
      );
      if (allResolved) {
        const topic = db.select().from(topics)
          .where(eq(topics.id, insight.topicId))
          .get();
        if (topic && topic.status === 'extracted') {
          db.update(topics).set({
            status: 'refined',
            updatedAt: now,
          }).where(eq(topics.id, insight.topicId)).run();
          topicRefined = true;
          console.log(`[me.md] Topic "${topic.title}" auto-transitioned to 'refined' - all insights resolved`);
        }
      }
    }

    res.json({
      insight: updated,
      message: 'Insight verified successfully',
      conceptNodeCreated: !!newConceptNode,
      conceptNode: newConceptNode,
      topicRefined,
    });
  } catch (error) {
    console.error('Verify insight error:', error);
    res.status(500).json({ error: 'Failed to verify insight' });
  }
});

// POST /api/insights/:id/reject - Reject an insight
insightsRouter.post('/:id/reject', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
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

    // Clean up concept nodes linked to this rejected insight
    // First, find concept nodes linked to this insight
    const linkedConceptNodes = db.select().from(conceptNodes)
      .where(eq(conceptNodes.insightId, insightId))
      .all();

    if (linkedConceptNodes.length > 0) {
      const linkedNodeIds = linkedConceptNodes.map(cn => cn.id);

      // Delete concept edges that reference these nodes
      for (const nodeId of linkedNodeIds) {
        db.delete(conceptEdges).where(
          or(
            eq(conceptEdges.sourceNodeId, nodeId),
            eq(conceptEdges.targetNodeId, nodeId)
          )
        ).run();
      }

      // Delete the concept nodes themselves
      db.delete(conceptNodes).where(eq(conceptNodes.insightId, insightId)).run();
    }

    // Check if all insights for this topic are now verified/rejected
    // If so, automatically transition topic status to 'refined'
    let topicRefined = false;
    if (insight.topicId) {
      const topicInsights = db.select().from(insights)
        .where(eq(insights.topicId, insight.topicId))
        .all();
      const allResolved = topicInsights.length > 0 && topicInsights.every(
        i => i.verificationStatus === 'verified' || i.verificationStatus === 'rejected'
      );
      if (allResolved) {
        const topicRecord = db.select().from(topics)
          .where(eq(topics.id, insight.topicId))
          .get();
        if (topicRecord && topicRecord.status === 'extracted') {
          db.update(topics).set({
            status: 'refined',
            updatedAt: now,
          }).where(eq(topics.id, insight.topicId)).run();
          topicRefined = true;
          console.log(`[me.md] Topic "${topicRecord.title}" auto-transitioned to 'refined' - all insights resolved`);
        }
      }
    }

    res.json({ insight: updated, message: 'Insight rejected', removedConceptNodes: linkedConceptNodes.length, topicRefined });
  } catch (error) {
    console.error('Reject insight error:', error);
    res.status(500).json({ error: 'Failed to reject insight' });
  }
});

// PUT /api/insights/:id/re-verify-interval - Set re-verification interval for an insight
insightsRouter.put('/:id/re-verify-interval', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const insightId = req.params.id;
    const { interval } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const validIntervals = ['weekly', 'monthly', 'quarterly', 'biannual', 'annual'];
    if (!interval || !validIntervals.includes(interval)) {
      return res.status(400).json({ error: 'Invalid interval. Must be one of: weekly, monthly, quarterly, biannual, annual' });
    }

    const insight = db.select().from(insights).where(
      and(eq(insights.id, insightId), eq(insights.userId, userId))
    ).get();

    if (!insight) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    const now = new Date().toISOString();
    const reVerifyAt = calculateReVerifyAt(interval);

    const updated = db.update(insights).set({
      reVerifyInterval: interval,
      reVerifyAt,
      updatedAt: now,
    }).where(eq(insights.id, insightId)).returning().get();

    res.json({ insight: updated, message: `Re-verification interval set to ${interval}` });
  } catch (error) {
    console.error('Update re-verify interval error:', error);
    res.status(500).json({ error: 'Failed to update re-verification interval' });
  }
});

// POST /api/insights/check-reverification - Trigger a re-verification check
// Accepts optional body param `asOfDate` to simulate checking at a future date (for testing)
insightsRouter.post('/check-reverification', async (req, res) => {
  try {
    const { asOfDate } = req.body || {};
    const count = checkReVerificationDue(asOfDate);
    res.json({ checked: true, markedForReVerification: count, asOfDate: asOfDate || new Date().toISOString() });
  } catch (error) {
    console.error('Re-verification check error:', error);
    res.status(500).json({ error: 'Failed to run re-verification check' });
  }
});

// PUT /api/insights/:id - Edit an insight's content
// Supports optimistic concurrency control via expectedUpdatedAt parameter
insightsRouter.put('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const insightId = req.params.id;
    const { content, agreementScore, privacyTier, expectedUpdatedAt } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const insight = db.select().from(insights).where(
      and(eq(insights.id, insightId), eq(insights.userId, userId))
    ).get();

    if (!insight) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    // Optimistic concurrency control: if client provides expectedUpdatedAt,
    // check it matches the current value to detect concurrent edits
    if (expectedUpdatedAt && insight.updatedAt !== expectedUpdatedAt) {
      return res.status(409).json({
        error: 'Conflict: this insight was modified by another session',
        currentContent: insight.content,
        currentUpdatedAt: insight.updatedAt,
        yourExpectedUpdatedAt: expectedUpdatedAt,
      });
    }

    // Validate content if provided
    if (content !== undefined && content !== null) {
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'Insight content cannot be empty.' });
      }
      if (content.length > 5000) {
        return res.status(400).json({ error: 'Insight content is too long. Please keep it under 5000 characters.' });
      }
    }

    // Validate agreementScore if provided
    if (agreementScore !== undefined && agreementScore !== null) {
      const score = Number(agreementScore);
      if (isNaN(score) || score < 0 || score > 100) {
        return res.status(400).json({ error: 'Agreement score must be a number between 0 and 100.' });
      }
    }

    // Validate privacyTier if provided
    if (privacyTier !== undefined && privacyTier !== null) {
      const validTiers = ['public', 'connections', 'private'];
      if (!validTiers.includes(privacyTier)) {
        return res.status(400).json({
          error: `Invalid privacy tier "${privacyTier}". Must be one of: ${validTiers.join(', ')}`
        });
      }
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

// DELETE /api/insights/:id - Delete an insight and its related data
insightsRouter.delete('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const insightId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const insight = db.select().from(insights).where(
      and(eq(insights.id, insightId), eq(insights.userId, userId))
    ).get();

    if (!insight) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    // Delete verification history for this insight
    db.delete(verificationHistory).where(eq(verificationHistory.insightId, insightId)).run();

    // Delete concept edges referencing concept nodes for this insight
    const linkedConceptNodes = db.select().from(conceptNodes)
      .where(eq(conceptNodes.insightId, insightId))
      .all();

    if (linkedConceptNodes.length > 0) {
      for (const node of linkedConceptNodes) {
        db.delete(conceptEdges).where(
          or(
            eq(conceptEdges.sourceNodeId, node.id),
            eq(conceptEdges.targetNodeId, node.id)
          )
        ).run();
      }
      // Delete concept nodes
      db.delete(conceptNodes).where(eq(conceptNodes.insightId, insightId)).run();
    }

    // Delete the insight itself
    db.delete(insights).where(eq(insights.id, insightId)).run();

    res.json({ message: 'Insight deleted successfully', id: insightId });
  } catch (error) {
    console.error('Delete insight error:', error);
    res.status(500).json({ error: 'Failed to delete insight' });
  }
});
