import { and, eq, inArray } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import { insights } from '@/db/schema'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import type { AttachTarget, DroppedCandidate, ExistingInsightRef } from './insightExtraction'

type Db = SQLJsDatabase<typeof schema>

export function fetchExistingInsightRefs(db: Db): ExistingInsightRef[] {
  return db.select({
    id: insights.id,
    content: insights.content,
    verificationStatus: insights.verificationStatus,
    evidenceCount: insights.evidenceCount,
  }).from(insights)
    .where(and(
      eq(insights.userId, LOCAL_USER_ID),
      inArray(insights.verificationStatus, ['verified', 'unverified', 're_verification_pending']),
    ))
    .all()
    .map(row => ({
      ...row,
      verificationStatus: row.verificationStatus ?? 'unverified',
      evidenceCount: row.evidenceCount ?? 0,
    }))
}

export function applyInsightEvidenceAttachments(db: Db, attachments: AttachTarget[]): void {
  for (const attachment of attachments) {
    const row = db.select({
      id: insights.id,
      evidenceCount: insights.evidenceCount,
      evidenceSources: insights.evidenceSources,
    }).from(insights)
      .where(and(eq(insights.id, attachment.targetId), eq(insights.userId, LOCAL_USER_ID)))
      .get()

    if (!row) continue

    const evidenceSources = parseEvidenceSources(row.evidenceSources)
    evidenceSources.push(attachment.sourceRef)

    db.update(insights).set({
      evidenceCount: (row.evidenceCount ?? 0) + 1,
      evidenceSources: JSON.stringify(evidenceSources),
      updatedAt: new Date().toISOString(),
    }).where(eq(insights.id, attachment.targetId)).run()
  }
}

export function logAdmissionDrops(drops: DroppedCandidate[]): void {
  for (const drop of drops) {
    console.log('[me.md:admission] dropped', drop.reason, drop.score, drop.matchedId)
  }
}

function parseEvidenceSources(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}
