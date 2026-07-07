import { eq, and, desc, or, count } from 'drizzle-orm'
import { scheduleSave } from '@/db/persistence'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { insights, topics, verificationHistory, conceptNodes, conceptEdges } from '@/db/schema'
import { KIND_LABELS } from '@/services/obsidianExport'

type Db = any // Drizzle sql.js instance

// ============================================
// Re-verification interval calculation
// ============================================

/**
 * Classify an insight to determine its re-verification interval.
 * - Situational insights: 1-4 weeks (weekly)
 * - Preference insights: 3-6 months (quarterly)
 * - Core trait insights: 6-12 months (biannual)
 */
function classifyInsightInterval(content: string, confidenceScore: number | null): string {
  const lowerContent = content.toLowerCase()
  const confidence = confidenceScore ?? 50

  const coreTraitPatterns = /\b(always|never|identity|core|fundamental|deeply|who i am|my nature|trait|personality|character|values?|believe|principle|philosophy)\b/i
  const preferencePatterns = /\b(prefer|like|enjoy|favorite|style|approach|tend to|usually|comfortable|dislike|hate|love|way i|how i)\b/i
  const situationalPatterns = /\b(currently|right now|lately|recently|at the moment|these days|this week|this month|feeling|situation|context|today)\b/i

  if (situationalPatterns.test(lowerContent)) {
    return 'weekly'
  }

  if (coreTraitPatterns.test(lowerContent) && confidence >= 75) {
    return 'biannual'
  }

  if (preferencePatterns.test(lowerContent)) {
    return 'quarterly'
  }

  if (confidence >= 70) {
    return 'quarterly'
  }

  return 'monthly'
}

/**
 * Calculate the re_verify_at timestamp based on the interval.
 */
function calculateReVerifyAt(interval: string): string {
  const now = new Date()

  switch (interval) {
    case 'weekly':
      now.setDate(now.getDate() + 14)
      break
    case 'monthly':
      now.setMonth(now.getMonth() + 1)
      break
    case 'quarterly':
      now.setMonth(now.getMonth() + 3)
      break
    case 'biannual':
      now.setMonth(now.getMonth() + 6)
      break
    case 'annual':
      now.setFullYear(now.getFullYear() + 1)
      break
    default:
      now.setMonth(now.getMonth() + 1)
      break
  }

  return now.toISOString()
}

/**
 * Get verification queue statistics.
 */
export function getInsightStats(db: Db) {
  const userId = LOCAL_USER_ID

  const allInsights = db.select().from(insights)
    .where(eq(insights.userId, userId))
    .all()

  const pending = allInsights.filter((i: any) =>
    i.verificationStatus === 'unverified' || i.verificationStatus === 're_verification_pending'
  ).length
  const verified = allInsights.filter((i: any) => i.verificationStatus === 'verified').length
  const rejected = allInsights.filter((i: any) => i.verificationStatus === 'rejected').length

  return { pending, verified, rejected, total: allInsights.length }
}

/** Cheap count of insights awaiting review (unverified or re_verification_pending). */
export function getPendingInsightsCount(db: Db): number {
  const rows = db.select({ value: count() }).from(insights)
    .where(and(
      eq(insights.userId, LOCAL_USER_ID),
      or(
        eq(insights.verificationStatus, 'unverified'),
        eq(insights.verificationStatus, 're_verification_pending'),
      ),
    ))
    .all()

  return rows[0]?.value ?? 0
}

export function getGraphStats(db: Db): {
  byKind: Array<{ kind: string | null; label: string; count: number }>
  topicSizes: Array<{ title: string; count: number }>
  verifiedTotal: number
  topicTotal: number
} {
  const rows = db.select({
    kind: insights.kind,
    topicTitle: topics.title,
  }).from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(and(
      eq(insights.userId, LOCAL_USER_ID),
      eq(insights.verificationStatus, 'verified'),
    ))
    .all()

  const knownKinds = new Set(KIND_LABELS.map(([kind]) => kind))
  const kindCounts = new Map<string | null, number>()
  const topicCounts = new Map<string, number>()

  for (const row of rows) {
    const kind = typeof row.kind === 'string' && knownKinds.has(row.kind) ? row.kind : null
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1)

    const topicTitle = row.topicTitle ?? 'General'
    topicCounts.set(topicTitle, (topicCounts.get(topicTitle) ?? 0) + 1)
  }

  const byKind = KIND_LABELS
    .map(([kind, label]) => ({ kind, label, count: kindCounts.get(kind) ?? 0 }))
    .filter(item => item.count > 0) as Array<{ kind: string | null; label: string; count: number }>

  const uncategorized = kindCounts.get(null) ?? 0
  if (uncategorized > 0) {
    byKind.push({ kind: null, label: 'Uncategorized', count: uncategorized })
  }

  const topicSizes = Array.from(topicCounts, ([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))

  return {
    byKind,
    topicSizes,
    verifiedTotal: rows.length,
    topicTotal: topicSizes.length,
  }
}

/**
 * Get pending verification insights with topic titles.
 */
export function getPendingInsights(db: Db) {
  const userId = LOCAL_USER_ID

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
    .orderBy(desc(insights.confidenceScore), desc(insights.createdAt))
    .all()

  const result = pendingInsights.map((row: any) => ({
    ...row.insight,
    topicTitle: row.topicTitle,
  }))

  return { insights: result, count: result.length }
}

/**
 * Get all insights for the local user with optional status filter.
 */
export function getAllInsights(db: Db, status?: string) {
  const userId = LOCAL_USER_ID

  const conditions = [eq(insights.userId, userId)]
  if (status) {
    conditions.push(eq(insights.verificationStatus, status))
  }

  const userInsights = db.select({
    insight: insights,
    topicTitle: topics.title,
  }).from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(and(...conditions))
    .orderBy(desc(insights.createdAt))
    .all()

  const result = userInsights.map((row: any) => ({
    ...row.insight,
    topicTitle: row.topicTitle,
  }))

  return { insights: result, count: result.length }
}

/**
 * Get a single insight by ID with verification history.
 */
export function getInsight(db: Db, id: string) {
  const userId = LOCAL_USER_ID

  const result = db.select({
    insight: insights,
    topicTitle: topics.title,
  }).from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(
      and(eq(insights.id, id), eq(insights.userId, userId))
    )
    .get()

  if (!result) {
    throw new Error('Insight not found')
  }

  const history = db.select().from(verificationHistory)
    .where(eq(verificationHistory.insightId, id))
    .orderBy(desc(verificationHistory.createdAt))
    .all()

  return {
    ...result.insight,
    topicTitle: result.topicTitle,
    verificationHistory: history,
  }
}

/**
 * Verify (approve) an insight.
 */
export function verifyInsight(db: Db, id: string, data?: { reVerifyInterval?: string }) {
  const userId = LOCAL_USER_ID

  const insight = db.select().from(insights).where(
    and(eq(insights.id, id), eq(insights.userId, userId))
  ).get()

  if (!insight) {
    throw new Error('Insight not found')
  }

  const now = new Date().toISOString()

  // Allow client to specify interval, or auto-classify
  const requestedInterval = data?.reVerifyInterval
  const validIntervals = ['weekly', 'monthly', 'quarterly', 'biannual', 'annual']
  if (requestedInterval && !validIntervals.includes(requestedInterval)) {
    throw new Error(`Invalid re-verification interval "${requestedInterval}". Must be one of: ${validIntervals.join(', ')}`)
  }
  const reVerifyInterval = requestedInterval || classifyInsightInterval(insight.content, insight.confidenceScore)
  const reVerifyAt = calculateReVerifyAt(reVerifyInterval)

  const isReVerification = insight.verificationStatus === 're_verification_pending'
  const historyAction = isReVerification ? 're_verified' : 'verified'

  const updated = db.update(insights).set({
    verificationStatus: 'verified',
    verifiedAt: now,
    reVerifyInterval,
    reVerifyAt,
    updatedAt: now,
  }).where(eq(insights.id, id)).returning().get()

  db.insert(verificationHistory).values({
    id: crypto.randomUUID(),
    insightId: id,
    action: historyAction,
    previousContent: insight.content,
    newContent: insight.content,
  }).run()

  // Create concept node for newly verified insight (if one doesn't already exist)
  let newConceptNode = null
  if (!isReVerification) {
    const existingConceptNode = db.select().from(conceptNodes)
      .where(
        and(
          eq(conceptNodes.insightId, id),
          eq(conceptNodes.userId, userId)
        )
      ).get()

    if (!existingConceptNode) {
      const nodeId = crypto.randomUUID()
      newConceptNode = db.insert(conceptNodes).values({
        id: nodeId,
        userId,
        topicId: insight.topicId,
        insightId: id,
        label: insight.content.substring(0, 60),
        weight: (insight.confidenceScore ?? 50) / 100,
      }).returning().get()
    }
  }

  // Check if all insights for this topic are now verified/rejected
  let topicRefined = false
  if (insight.topicId) {
    const topicInsights = db.select().from(insights)
      .where(eq(insights.topicId, insight.topicId))
      .all()
    const allResolved = topicInsights.length > 0 && topicInsights.every(
      (i: any) => i.verificationStatus === 'verified' || i.verificationStatus === 'rejected'
    )
    if (allResolved) {
      const topic = db.select().from(topics)
        .where(eq(topics.id, insight.topicId))
        .get()
      if (topic && topic.status === 'extracted') {
        db.update(topics).set({
          status: 'refined',
          updatedAt: now,
        }).where(eq(topics.id, insight.topicId)).run()
        topicRefined = true
      }
    }
  }

  scheduleSave()

  return {
    insight: updated,
    message: 'Insight verified',
    conceptNodeCreated: !!newConceptNode,
    conceptNode: newConceptNode,
    topicRefined,
  }
}

/**
 * Reject an insight and clean up related concept nodes.
 */
export function rejectInsight(db: Db, id: string, reason?: string) {
  const userId = LOCAL_USER_ID

  const insight = db.select().from(insights).where(
    and(eq(insights.id, id), eq(insights.userId, userId))
  ).get()

  if (!insight) {
    throw new Error('Insight not found')
  }

  const now = new Date().toISOString()

  const updated = db.update(insights).set({
    verificationStatus: 'rejected',
    updatedAt: now,
  }).where(eq(insights.id, id)).returning().get()

  db.insert(verificationHistory).values({
    id: crypto.randomUUID(),
    insightId: id,
    action: 'rejected',
    previousContent: insight.content,
    newContent: reason || null,
  }).run()

  // Clean up concept nodes linked to this rejected insight
  const linkedConceptNodes = db.select().from(conceptNodes)
    .where(eq(conceptNodes.insightId, id))
    .all()

  if (linkedConceptNodes.length > 0) {
    const linkedNodeIds = linkedConceptNodes.map((cn: any) => cn.id)

    for (const nodeId of linkedNodeIds) {
      db.delete(conceptEdges).where(
        or(
          eq(conceptEdges.sourceNodeId, nodeId),
          eq(conceptEdges.targetNodeId, nodeId)
        )
      ).run()
    }

    db.delete(conceptNodes).where(eq(conceptNodes.insightId, id)).run()
  }

  // Check if all insights for this topic are now verified/rejected
  let topicRefined = false
  if (insight.topicId) {
    const topicInsights = db.select().from(insights)
      .where(eq(insights.topicId, insight.topicId))
      .all()
    const allResolved = topicInsights.length > 0 && topicInsights.every(
      (i: any) => i.verificationStatus === 'verified' || i.verificationStatus === 'rejected'
    )
    if (allResolved) {
      const topicRecord = db.select().from(topics)
        .where(eq(topics.id, insight.topicId))
        .get()
      if (topicRecord && topicRecord.status === 'extracted') {
        db.update(topics).set({
          status: 'refined',
          updatedAt: now,
        }).where(eq(topics.id, insight.topicId)).run()
        topicRefined = true
      }
    }
  }

  scheduleSave()

  return {
    insight: updated,
    message: 'Insight rejected',
    removedConceptNodes: linkedConceptNodes.length,
    topicRefined,
  }
}

export function reopenInsight(db: Db, id: string): void {
  const userId = LOCAL_USER_ID

  const insight = db.select().from(insights).where(
    and(eq(insights.id, id), eq(insights.userId, userId))
  ).get()

  if (!insight) {
    throw new Error('Insight not found')
  }

  const now = new Date().toISOString()

  db.update(insights).set({
    verificationStatus: 'unverified',
    verifiedAt: null,
    reVerifyAt: null,
    reVerifyInterval: null,
    updatedAt: now,
  }).where(eq(insights.id, id)).run()

  db.insert(verificationHistory).values({
    id: crypto.randomUUID(),
    insightId: id,
    action: 'reopened',
    previousContent: insight.content,
    newContent: insight.content,
  }).run()

  scheduleSave()
}

/**
 * Edit an insight's content or privacy tier.
 * Supports optimistic concurrency control via expectedUpdatedAt.
 */
export function editInsight(
  db: Db,
  id: string,
  data: {
    content?: string
    privacyTier?: string
    expectedUpdatedAt?: string
  }
) {
  const userId = LOCAL_USER_ID

  const insight = db.select().from(insights).where(
    and(eq(insights.id, id), eq(insights.userId, userId))
  ).get()

  if (!insight) {
    throw new Error('Insight not found')
  }

  // Optimistic concurrency control
  if (data.expectedUpdatedAt && insight.updatedAt !== data.expectedUpdatedAt) {
    throw new Error('Conflict: this insight was modified by another session')
  }

  // Validate content
  if (data.content !== undefined && data.content !== null) {
    if (typeof data.content !== 'string' || !data.content.trim()) {
      throw new Error('Insight content cannot be empty.')
    }
    if (data.content.length > 5000) {
      throw new Error('Insight content is too long. Please keep it under 5000 characters.')
    }
  }

  // Validate privacyTier
  if (data.privacyTier !== undefined && data.privacyTier !== null) {
    const validTiers = ['public', 'connections', 'private', 'exportable', 'never_export']
    if (!validTiers.includes(data.privacyTier)) {
      throw new Error(`Invalid privacy tier "${data.privacyTier}". Must be one of: ${validTiers.join(', ')}`)
    }
  }

  const now = new Date().toISOString()
  const updates: Record<string, any> = { updatedAt: now }

  if (data.content !== undefined) {
    updates.content = data.content
    db.insert(verificationHistory).values({
      id: crypto.randomUUID(),
      insightId: id,
      action: 'edited',
      previousContent: insight.content,
      newContent: data.content,
    }).run()
  }
  if (data.privacyTier !== undefined) updates.privacyTier = data.privacyTier

  const updated = db.update(insights).set(updates)
    .where(eq(insights.id, id)).returning().get()

  scheduleSave()

  return { insight: updated }
}

export function recordVaultSync(
  db: Db,
  id: string,
  data: { content?: string; contentHash: string; bodyHash: string; syncedAt: string }
) {
  const updates: Record<string, any> = {
    vaultContentHash: data.contentHash,
    vaultBodyHash: data.bodyHash,
    vaultSyncedAt: data.syncedAt,
  }

  if (data.content !== undefined) {
    updates.content = data.content
    updates.updatedAt = data.syncedAt
  }

  db.update(insights).set(updates).where(eq(insights.id, id)).run()
  scheduleSave()
}

export function clearVaultSync(db: Db, id: string) {
  db.update(insights).set({
    vaultContentHash: null,
    vaultBodyHash: null,
    vaultSyncedAt: null,
  }).where(eq(insights.id, id)).run()
  scheduleSave()
}

export function applyVaultBody(db: Db, id: string, body: string): void {
  const userId = LOCAL_USER_ID
  const insight = db.select().from(insights).where(
    and(eq(insights.id, id), eq(insights.userId, userId))
  ).get()

  if (!insight) {
    throw new Error('Insight not found')
  }

  const now = new Date().toISOString()
  db.update(insights).set({
    content: body,
    updatedAt: now,
  }).where(eq(insights.id, id)).run()

  db.insert(verificationHistory).values({
    id: crypto.randomUUID(),
    insightId: id,
    action: 'vault_sync',
    previousContent: insight.content,
    newContent: body,
  }).run()

  scheduleSave()
}

/**
 * Delete an insight and all related data (verification history, concept nodes/edges).
 */
export function deleteInsight(db: Db, id: string) {
  const userId = LOCAL_USER_ID

  const insight = db.select().from(insights).where(
    and(eq(insights.id, id), eq(insights.userId, userId))
  ).get()

  if (!insight) {
    throw new Error('Insight not found')
  }

  // Delete verification history
  db.delete(verificationHistory).where(eq(verificationHistory.insightId, id)).run()

  // Delete concept edges referencing concept nodes for this insight
  const linkedConceptNodes = db.select().from(conceptNodes)
    .where(eq(conceptNodes.insightId, id))
    .all()

  if (linkedConceptNodes.length > 0) {
    for (const node of linkedConceptNodes) {
      db.delete(conceptEdges).where(
        or(
          eq(conceptEdges.sourceNodeId, node.id),
          eq(conceptEdges.targetNodeId, node.id)
        )
      ).run()
    }
    db.delete(conceptNodes).where(eq(conceptNodes.insightId, id)).run()
  }

  // Delete the insight itself
  db.delete(insights).where(eq(insights.id, id)).run()

  scheduleSave()

  return { message: 'Insight deleted successfully', id }
}
