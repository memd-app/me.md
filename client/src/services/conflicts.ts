/**
 * Insight Conflicts Service
 * ==========================
 * Ported from server/src/routes/conflicts.ts
 * Detects and manages contradictions between user insights.
 */

import { eq, and, desc, or } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import { insights, insightConflicts, topics } from '@/db/schema'
import { scheduleSave } from '@/db/persistence'
import { LOCAL_USER_ID } from '@/contexts/UserContext'

type Db = SQLJsDatabase<typeof schema>

// ============================================
// Contradiction detection logic
// ============================================

function detectContradiction(contentA: string, contentB: string): { isConflict: boolean; reason: string } {
  const lowerA = contentA.toLowerCase()
  const lowerB = contentB.toLowerCase()

  const contradictionPairs: Array<[RegExp, RegExp, string]> = [
    [/\b(love|enjoy|like|prefer|embrace)\b/, /\b(hate|dislike|avoid|despise|detest)\b/, 'opposing sentiments'],
    [/\b(always|every time|without exception)\b/, /\b(never|rarely|seldom|hardly ever)\b/, 'always vs never contradiction'],
    [/\b(introvert|solitude|alone time|quiet|reserved)\b/, /\b(extrovert|social|outgoing|gregarious|party)\b/, 'personality contradiction'],
    [/\b(structured|organized|planned|systematic|methodical)\b/, /\b(spontaneous|flexible|improvise|go with the flow|unplanned)\b/, 'approach contradiction'],
    [/\b(morning person|early bird|wake up early|early riser)\b/, /\b(night owl|stay up late|evening person|late night)\b/, 'temporal preference contradiction'],
    [/\b(risk-averse|cautious|conservative|safe|careful)\b/, /\b(risk-taker|adventurous|bold|daring|fearless)\b/, 'risk attitude contradiction'],
    [/\b(independent|solo|on my own|self-reliant|alone)\b/, /\b(collaborative|team|together|group work|collective)\b/, 'work style contradiction'],
    [/\b(detail-oriented|meticulous|thorough|precise|perfectionist)\b/, /\b(big picture|broad strokes|overview|high-level|general)\b/, 'focus contradiction'],
    [/\b(optimist|positive|hopeful|glass half full|bright side)\b/, /\b(pessimist|negative|cynical|glass half empty|worst case)\b/, 'outlook contradiction'],
    [/\b(quick decision|decisive|fast|snap judgment|instinct)\b/, /\b(slow decision|deliberate|careful|take my time|overthink)\b/, 'decision speed contradiction'],
  ]

  const stopWords = new Set(['i', 'me', 'my', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'shall', 'can', 'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'not', 'no', 'so', 'yet', 'both',
    'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
    'than', 'too', 'very', 'just', 'about', 'above', 'after', 'again', 'also', 'because', 'before',
    'between', 'both', 'during', 'for', 'from', 'here', 'how', 'in', 'into', 'it', 'its', 'of', 'on',
    'only', 'out', 'over', 'own', 'same', 'she', 'he', 'her', 'his', 'that', 'their', 'them', 'then',
    'there', 'these', 'they', 'this', 'those', 'through', 'to', 'under', 'up', 'what', 'when', 'where',
    'which', 'while', 'who', 'whom', 'why', 'with', 'you', 'your', 'like', 'really', 'think', 'feel',
    'tend', 'much', 'way', 'things', 'thing', 'something', 'anything', 'everything', 'nothing'])

  const wordsA = lowerA.replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w))
  const wordsB = lowerB.replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w))
  const commonWords = wordsA.filter(w => wordsB.includes(w))

  for (const [patternA, patternB, reason] of contradictionPairs) {
    if ((patternA.test(lowerA) && patternB.test(lowerB)) ||
        (patternB.test(lowerA) && patternA.test(lowerB))) {
      if (commonWords.length >= 1) {
        return { isConflict: true, reason }
      }
    }
  }

  // Direct negation check
  const iAmPatternA = lowerA.match(/i\s+(?:am|consider myself)\s+(?:a\s+)?(\w+)/g) || []
  const iAmNotPatternB = lowerB.match(/i\s+(?:am not|don'?t consider myself)\s+(?:a\s+)?(\w+)/g) || []
  const iAmPatternB = lowerB.match(/i\s+(?:am|consider myself)\s+(?:a\s+)?(\w+)/g) || []
  const iAmNotPatternA = lowerA.match(/i\s+(?:am not|don'?t consider myself)\s+(?:a\s+)?(\w+)/g) || []

  if ((iAmPatternA.length > 0 && iAmNotPatternB.length > 0) ||
      (iAmPatternB.length > 0 && iAmNotPatternA.length > 0)) {
    return { isConflict: true, reason: 'direct self-description contradiction' }
  }

  return { isConflict: false, reason: '' }
}

// ============================================
// Enrichment helper
// ============================================

function enrichConflict(db: Db, conflict: typeof insightConflicts.$inferSelect) {
  const insightA = db.select({ insight: insights, topicTitle: topics.title })
    .from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(eq(insights.id, conflict.insightAId))
    .get()

  const insightB = db.select({ insight: insights, topicTitle: topics.title })
    .from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(eq(insights.id, conflict.insightBId))
    .get()

  return {
    ...conflict,
    insightA: insightA ? { ...insightA.insight, topicTitle: insightA.topicTitle } : null,
    insightB: insightB ? { ...insightB.insight, topicTitle: insightB.topicTitle } : null,
  }
}

// ============================================
// Public API
// ============================================

/**
 * Detect conflicts among the user's verified/unverified insights.
 */
export function detectConflicts(db: Db) {
  const userInsights = db.select().from(insights)
    .where(and(
      eq(insights.userId, LOCAL_USER_ID),
      or(
        eq(insights.verificationStatus, 'verified'),
        eq(insights.verificationStatus, 'unverified'),
        eq(insights.verificationStatus, 're_verification_pending'),
      ),
    ))
    .all()

  if (userInsights.length < 2) {
    return { detected: 0, conflicts: [], message: 'Need at least 2 insights to detect conflicts' }
  }

  // Get existing conflicts to avoid duplicates
  const existingConflicts = db.select().from(insightConflicts).where(eq(insightConflicts.userId, LOCAL_USER_ID)).all()
  const existingPairs = new Set(
    existingConflicts.map(c => {
      const ids = [c.insightAId, c.insightBId].sort()
      return `${ids[0]}:${ids[1]}`
    })
  )

  const newConflicts: Array<{ id: string; insightAId: string; insightBId: string; reason: string }> = []

  for (let i = 0; i < userInsights.length; i++) {
    for (let j = i + 1; j < userInsights.length; j++) {
      const insightA = userInsights[i]
      const insightB = userInsights[j]
      const pairKey = [insightA.id, insightB.id].sort()
      const pairKeyStr = `${pairKey[0]}:${pairKey[1]}`
      if (existingPairs.has(pairKeyStr)) continue

      const result = detectContradiction(insightA.content, insightB.content)
      if (result.isConflict) {
        const conflictId = crypto.randomUUID()
        db.insert(insightConflicts).values({
          id: conflictId,
          userId: LOCAL_USER_ID,
          insightAId: insightA.id,
          insightBId: insightB.id,
          resolutionStatus: 'unresolved',
        }).run()

        newConflicts.push({ id: conflictId, insightAId: insightA.id, insightBId: insightB.id, reason: result.reason })
        existingPairs.add(pairKeyStr)
      }
    }
  }

  scheduleSave()

  return {
    detected: newConflicts.length,
    conflicts: newConflicts,
    message: newConflicts.length > 0 ? `Found ${newConflicts.length} new conflict(s)` : 'No new conflicts detected',
  }
}

/**
 * List all conflicts for the user, optionally filtered by status.
 */
export function getConflicts(db: Db, status?: string) {
  const conditions = [eq(insightConflicts.userId, LOCAL_USER_ID)]
  if (status) conditions.push(eq(insightConflicts.resolutionStatus, status))

  const userConflicts = db.select().from(insightConflicts)
    .where(and(...conditions))
    .orderBy(desc(insightConflicts.createdAt))
    .all()

  const enrichedConflicts = userConflicts.map(c => enrichConflict(db, c))

  return {
    conflicts: enrichedConflicts,
    count: enrichedConflicts.length,
    unresolved: enrichedConflicts.filter(c => c.resolutionStatus === 'unresolved').length,
  }
}

/**
 * Get conflict statistics.
 */
export function getConflictStats(db: Db) {
  const allConflicts = db.select().from(insightConflicts).where(eq(insightConflicts.userId, LOCAL_USER_ID)).all()
  const unresolved = allConflicts.filter(c => c.resolutionStatus === 'unresolved').length
  return { total: allConflicts.length, unresolved, resolved: allConflicts.length - unresolved }
}

/**
 * Get a single conflict with full details.
 */
export function getConflict(db: Db, conflictId: string) {
  const conflict = db.select().from(insightConflicts)
    .where(and(eq(insightConflicts.id, conflictId), eq(insightConflicts.userId, LOCAL_USER_ID)))
    .get()

  if (!conflict) throw new Error('Conflict not found')
  return enrichConflict(db, conflict)
}

/**
 * Resolve a conflict.
 */
export function resolveConflict(
  db: Db,
  conflictId: string,
  resolution: string,
  resolutionNote?: string,
) {
  const validResolutions = ['both_true_different_contexts', 'a_outdated', 'b_outdated', 'clarified']
  if (!resolution || !validResolutions.includes(resolution)) {
    throw new Error('Invalid resolution. Must be one of: both_true_different_contexts, a_outdated, b_outdated, clarified')
  }

  const conflict = db.select().from(insightConflicts)
    .where(and(eq(insightConflicts.id, conflictId), eq(insightConflicts.userId, LOCAL_USER_ID)))
    .get()

  if (!conflict) throw new Error('Conflict not found')

  const now = new Date().toISOString()

  const updated = db.update(insightConflicts).set({
    resolutionStatus: resolution,
    resolutionNote: resolutionNote || null,
    resolvedAt: now,
  }).where(eq(insightConflicts.id, conflictId)).returning().get()

  // Handle resolution side effects
  if (resolution === 'a_outdated') {
    db.update(insights).set({ verificationStatus: 're_verification_pending', updatedAt: now })
      .where(eq(insights.id, conflict.insightAId)).run()
  } else if (resolution === 'b_outdated') {
    db.update(insights).set({ verificationStatus: 're_verification_pending', updatedAt: now })
      .where(eq(insights.id, conflict.insightBId)).run()
  }

  scheduleSave()

  return {
    ...enrichConflict(db, updated!),
    message: 'Conflict resolved successfully',
  }
}
