import { Router } from 'express';
import { db } from '../config/database.js';
import { insights, insightConflicts, topics } from '../models/schema.js';
import { eq, and, desc, or, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export const conflictsRouter = Router();

// ============================================
// Conflict Detection Logic
// ============================================

/**
 * Simple keyword-based contradiction detection.
 * Checks for opposing sentiments/statements between two insights.
 */
function detectContradiction(contentA: string, contentB: string): { isConflict: boolean; reason: string } {
  const lowerA = contentA.toLowerCase();
  const lowerB = contentB.toLowerCase();

  // Contradiction pattern pairs: if one insight matches pattern[0] and the other matches pattern[1]
  const contradictionPairs: Array<[RegExp, RegExp, string]> = [
    // Love vs hate/dislike
    [/\b(love|enjoy|like|prefer|embrace)\b/, /\b(hate|dislike|avoid|despise|detest)\b/, 'opposing sentiments'],
    // Always vs never
    [/\b(always|every time|without exception)\b/, /\b(never|rarely|seldom|hardly ever)\b/, 'always vs never contradiction'],
    // Introvert vs extrovert
    [/\b(introvert|solitude|alone time|quiet|reserved)\b/, /\b(extrovert|social|outgoing|gregarious|party)\b/, 'personality contradiction'],
    // Structured vs spontaneous
    [/\b(structured|organized|planned|systematic|methodical)\b/, /\b(spontaneous|flexible|improvise|go with the flow|unplanned)\b/, 'approach contradiction'],
    // Morning vs night
    [/\b(morning person|early bird|wake up early|early riser)\b/, /\b(night owl|stay up late|evening person|late night)\b/, 'temporal preference contradiction'],
    // Risk-averse vs risk-taking
    [/\b(risk-averse|cautious|conservative|safe|careful)\b/, /\b(risk-taker|adventurous|bold|daring|fearless)\b/, 'risk attitude contradiction'],
    // Independent vs collaborative
    [/\b(independent|solo|on my own|self-reliant|alone)\b/, /\b(collaborative|team|together|group work|collective)\b/, 'work style contradiction'],
    // Detail-oriented vs big picture
    [/\b(detail-oriented|meticulous|thorough|precise|perfectionist)\b/, /\b(big picture|broad strokes|overview|high-level|general)\b/, 'focus contradiction'],
    // Optimistic vs pessimistic
    [/\b(optimist|positive|hopeful|glass half full|bright side)\b/, /\b(pessimist|negative|cynical|glass half empty|worst case)\b/, 'outlook contradiction'],
    // Fast vs slow decision making
    [/\b(quick decision|decisive|fast|snap judgment|instinct)\b/, /\b(slow decision|deliberate|careful|take my time|overthink)\b/, 'decision speed contradiction'],
  ];

  // Check if insights share a common subject area (at least 2 overlapping meaningful words)
  const stopWords = new Set(['i', 'me', 'my', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'shall', 'can', 'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'not', 'no', 'so', 'yet', 'both',
    'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
    'than', 'too', 'very', 'just', 'about', 'above', 'after', 'again', 'also', 'because', 'before',
    'between', 'both', 'during', 'for', 'from', 'here', 'how', 'in', 'into', 'it', 'its', 'of', 'on',
    'only', 'out', 'over', 'own', 'same', 'she', 'he', 'her', 'his', 'that', 'their', 'them', 'then',
    'there', 'these', 'they', 'this', 'those', 'through', 'to', 'under', 'up', 'what', 'when', 'where',
    'which', 'while', 'who', 'whom', 'why', 'with', 'you', 'your', 'like', 'really', 'think', 'feel',
    'tend', 'much', 'way', 'things', 'thing', 'something', 'anything', 'everything', 'nothing']);

  const wordsA = lowerA.replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  const wordsB = lowerB.replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  const commonWords = wordsA.filter(w => wordsB.includes(w));

  // Check contradiction patterns
  for (const [patternA, patternB, reason] of contradictionPairs) {
    // Check both directions: A matches first pattern and B matches second, or vice versa
    if ((patternA.test(lowerA) && patternB.test(lowerB)) ||
        (patternB.test(lowerA) && patternA.test(lowerB))) {
      // Must share some topical overlap or both be about the same general domain
      if (commonWords.length >= 1) {
        return { isConflict: true, reason };
      }
    }
  }

  // Direct negation check: "I am X" vs "I am not X" patterns
  const iAmPatternA = lowerA.match(/i\s+(?:am|consider myself)\s+(?:a\s+)?(\w+)/g) || [];
  const iAmNotPatternB = lowerB.match(/i\s+(?:am not|don'?t consider myself)\s+(?:a\s+)?(\w+)/g) || [];
  const iAmPatternB = lowerB.match(/i\s+(?:am|consider myself)\s+(?:a\s+)?(\w+)/g) || [];
  const iAmNotPatternA = lowerA.match(/i\s+(?:am not|don'?t consider myself)\s+(?:a\s+)?(\w+)/g) || [];

  if ((iAmPatternA.length > 0 && iAmNotPatternB.length > 0) ||
      (iAmPatternB.length > 0 && iAmNotPatternA.length > 0)) {
    return { isConflict: true, reason: 'direct self-description contradiction' };
  }

  return { isConflict: false, reason: '' };
}

// ============================================
// POST /api/conflicts/detect - Detect conflicts among user's verified insights
// ============================================
conflictsRouter.post('/detect', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get all verified (or unverified) insights for this user
    const userInsights = db.select().from(insights)
      .where(
        and(
          eq(insights.userId, userId),
          or(
            eq(insights.verificationStatus, 'verified'),
            eq(insights.verificationStatus, 'unverified'),
            eq(insights.verificationStatus, 're_verification_pending')
          )
        )
      )
      .all();

    if (userInsights.length < 2) {
      return res.json({ detected: 0, conflicts: [], message: 'Need at least 2 insights to detect conflicts' });
    }

    // Get existing unresolved conflicts to avoid duplicates
    const existingConflicts = db.select().from(insightConflicts)
      .where(eq(insightConflicts.userId, userId))
      .all();

    const existingPairs = new Set(
      existingConflicts.map(c => {
        const ids = [c.insightAId, c.insightBId].sort();
        return `${ids[0]}:${ids[1]}`;
      })
    );

    const newConflicts: Array<{
      id: string;
      insightAId: string;
      insightBId: string;
      reason: string;
    }> = [];

    // Compare all pairs
    for (let i = 0; i < userInsights.length; i++) {
      for (let j = i + 1; j < userInsights.length; j++) {
        const insightA = userInsights[i];
        const insightB = userInsights[j];

        // Skip if conflict already exists for this pair
        const pairKey = [insightA.id, insightB.id].sort();
        const pairKeyStr = `${pairKey[0]}:${pairKey[1]}`;
        if (existingPairs.has(pairKeyStr)) continue;

        const result = detectContradiction(insightA.content, insightB.content);
        if (result.isConflict) {
          const conflictId = uuidv4();
          db.insert(insightConflicts).values({
            id: conflictId,
            userId,
            insightAId: insightA.id,
            insightBId: insightB.id,
            resolutionStatus: 'unresolved',
          }).run();

          newConflicts.push({
            id: conflictId,
            insightAId: insightA.id,
            insightBId: insightB.id,
            reason: result.reason,
          });

          existingPairs.add(pairKeyStr);
        }
      }
    }

    res.json({
      detected: newConflicts.length,
      conflicts: newConflicts,
      message: newConflicts.length > 0
        ? `Found ${newConflicts.length} new conflict(s)`
        : 'No new conflicts detected',
    });
  } catch (error) {
    console.error('Conflict detection error:', error);
    res.status(500).json({ error: 'Failed to detect conflicts' });
  }
});

// ============================================
// GET /api/conflicts - List all conflicts for a user
// ============================================
conflictsRouter.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const status = req.query.status as string | undefined;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    let conditions = [eq(insightConflicts.userId, userId)];
    if (status) {
      conditions.push(eq(insightConflicts.resolutionStatus, status));
    }

    const userConflicts = db.select().from(insightConflicts)
      .where(and(...conditions))
      .orderBy(desc(insightConflicts.createdAt))
      .all();

    // Enrich with insight details
    const enrichedConflicts = userConflicts.map(conflict => {
      const insightA = db.select({
        insight: insights,
        topicTitle: topics.title,
      }).from(insights)
        .leftJoin(topics, eq(insights.topicId, topics.id))
        .where(eq(insights.id, conflict.insightAId))
        .get();

      const insightB = db.select({
        insight: insights,
        topicTitle: topics.title,
      }).from(insights)
        .leftJoin(topics, eq(insights.topicId, topics.id))
        .where(eq(insights.id, conflict.insightBId))
        .get();

      return {
        ...conflict,
        insightA: insightA ? { ...insightA.insight, topicTitle: insightA.topicTitle } : null,
        insightB: insightB ? { ...insightB.insight, topicTitle: insightB.topicTitle } : null,
      };
    });

    res.json({
      conflicts: enrichedConflicts,
      count: enrichedConflicts.length,
      unresolved: enrichedConflicts.filter(c => c.resolutionStatus === 'unresolved').length,
    });
  } catch (error) {
    console.error('List conflicts error:', error);
    res.status(500).json({ error: 'Failed to list conflicts' });
  }
});

// ============================================
// GET /api/conflicts/stats - Get conflict statistics
// ============================================
conflictsRouter.get('/stats', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const allConflicts = db.select().from(insightConflicts)
      .where(eq(insightConflicts.userId, userId))
      .all();

    const unresolved = allConflicts.filter(c => c.resolutionStatus === 'unresolved').length;
    const resolved = allConflicts.filter(c => c.resolutionStatus !== 'unresolved').length;

    res.json({ total: allConflicts.length, unresolved, resolved });
  } catch (error) {
    console.error('Get conflict stats error:', error);
    res.status(500).json({ error: 'Failed to get conflict stats' });
  }
});

// ============================================
// GET /api/conflicts/:id - Get a single conflict with full details
// ============================================
conflictsRouter.get('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const conflictId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const conflict = db.select().from(insightConflicts)
      .where(
        and(eq(insightConflicts.id, conflictId), eq(insightConflicts.userId, userId))
      )
      .get();

    if (!conflict) {
      return res.status(404).json({ error: 'Conflict not found' });
    }

    const insightA = db.select({
      insight: insights,
      topicTitle: topics.title,
    }).from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(eq(insights.id, conflict.insightAId))
      .get();

    const insightB = db.select({
      insight: insights,
      topicTitle: topics.title,
    }).from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(eq(insights.id, conflict.insightBId))
      .get();

    res.json({
      ...conflict,
      insightA: insightA ? { ...insightA.insight, topicTitle: insightA.topicTitle } : null,
      insightB: insightB ? { ...insightB.insight, topicTitle: insightB.topicTitle } : null,
    });
  } catch (error) {
    console.error('Get conflict error:', error);
    res.status(500).json({ error: 'Failed to get conflict' });
  }
});

// ============================================
// POST /api/conflicts/:id/resolve - Resolve a conflict
// ============================================
conflictsRouter.post('/:id/resolve', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const conflictId = req.params.id;
    const { resolution, resolutionNote } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const validResolutions = ['both_true_different_contexts', 'a_outdated', 'b_outdated', 'clarified'];
    if (!resolution || !validResolutions.includes(resolution)) {
      return res.status(400).json({
        error: 'Invalid resolution. Must be one of: both_true_different_contexts, a_outdated, b_outdated, clarified',
      });
    }

    const conflict = db.select().from(insightConflicts)
      .where(
        and(eq(insightConflicts.id, conflictId), eq(insightConflicts.userId, userId))
      )
      .get();

    if (!conflict) {
      return res.status(404).json({ error: 'Conflict not found' });
    }

    const now = new Date().toISOString();

    // Update conflict resolution
    const updated = db.update(insightConflicts).set({
      resolutionStatus: resolution,
      resolutionNote: resolutionNote || null,
      resolvedAt: now,
    }).where(eq(insightConflicts.id, conflictId)).returning().get();

    // Handle resolution-specific side effects
    if (resolution === 'a_outdated') {
      // Mark insight A as needing re-verification or update its status
      db.update(insights).set({
        verificationStatus: 're_verification_pending',
        updatedAt: now,
      }).where(eq(insights.id, conflict.insightAId)).run();
    } else if (resolution === 'b_outdated') {
      // Mark insight B as needing re-verification or update its status
      db.update(insights).set({
        verificationStatus: 're_verification_pending',
        updatedAt: now,
      }).where(eq(insights.id, conflict.insightBId)).run();
    }

    // Get enriched response
    const insightA = db.select({
      insight: insights,
      topicTitle: topics.title,
    }).from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(eq(insights.id, conflict.insightAId))
      .get();

    const insightB = db.select({
      insight: insights,
      topicTitle: topics.title,
    }).from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(eq(insights.id, conflict.insightBId))
      .get();

    res.json({
      ...updated,
      insightA: insightA ? { ...insightA.insight, topicTitle: insightA.topicTitle } : null,
      insightB: insightB ? { ...insightB.insight, topicTitle: insightB.topicTitle } : null,
      message: 'Conflict resolved successfully',
    });
  } catch (error) {
    console.error('Resolve conflict error:', error);
    res.status(500).json({ error: 'Failed to resolve conflict' });
  }
});
