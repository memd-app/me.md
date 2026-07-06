import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { CREATE_TABLES_SQL } from '@/db/database'
import { insights, verificationHistory } from '@/db/schema'
import { callAnthropic, isApiKeyConfigured } from '../anthropic'
import { reevaluatePendingInsights } from '../queueReevaluate'
import { enqueueVaultWrite } from '../vaultWriteThrough'

vi.mock('@/db/persistence', () => ({
  scheduleSave: vi.fn(),
}))

vi.mock('../anthropic', () => ({
  isApiKeyConfigured: vi.fn(),
  callAnthropic: vi.fn(),
}))

vi.mock('../vaultWriteThrough', () => ({
  enqueueVaultWrite: vi.fn(),
}))

const mockIsApiKeyConfigured = vi.mocked(isApiKeyConfigured)
const mockCallAnthropic = vi.mocked(callAnthropic)
const mockEnqueueVaultWrite = vi.mocked(enqueueVaultWrite)

function sqlValue(value: string | number | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${value.replace(/'/g, "''")}'`
}

describe('reevaluatePendingInsights', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeAll(async () => {
    const SQL = await initSqlJs()
    const sqlDb = new SQL.Database()
    sqlDb.run('PRAGMA foreign_keys = ON;')
    sqlDb.run(CREATE_TABLES_SQL)
    db = drizzle(sqlDb, { schema })
  })

  beforeEach(() => {
    mockIsApiKeyConfigured.mockReset()
    mockCallAnthropic.mockReset()
    mockEnqueueVaultWrite.mockReset()
    db.run('DELETE FROM verification_history')
    db.run('DELETE FROM concept_edges')
    db.run('DELETE FROM concept_nodes')
    db.run('DELETE FROM insights')
    db.run('DELETE FROM topics')
    db.run('DELETE FROM users')
    db.run("INSERT OR IGNORE INTO users (id, name) VALUES ('local-user', 'Test User')")
    db.run("INSERT INTO topics (id, user_id, title) VALUES ('topic-work', 'local-user', 'Work')")
  })

  function insertInsight(params: {
    id: string
    content: string
    verificationStatus?: string
  }): void {
    db.run(`
      INSERT INTO insights (
        id,
        user_id,
        topic_id,
        content,
        confidence_score,
        verification_status,
        privacy_tier,
        extraction_method,
        updated_at
      )
      VALUES (
        ${sqlValue(params.id)},
        'local-user',
        'topic-work',
        ${sqlValue(params.content)},
        82,
        ${sqlValue(params.verificationStatus ?? 'unverified')},
        'exportable',
        'ai',
        '2026-07-05T10:00:00.000Z'
      )
    `)
  }

  function pendingRows() {
    return db.select().from(insights).where(eq(insights.verificationStatus, 'unverified')).all()
  }

  it('batches AI evaluation forty insights at a time', async () => {
    mockIsApiKeyConfigured.mockReturnValue(true)
    mockCallAnthropic.mockImplementation(async options => {
      const content = options.messages[0].content
      const itemCount = (content.match(/^\d+\. /gm) ?? []).length
      return JSON.stringify(Array.from({ length: itemCount }, (_, index) => ({
        index: index + 1,
        kind: 'preference',
        self_relevance: 90,
      })))
    })

    for (let i = 0; i < 85; i += 1) {
      insertInsight({ id: `ins-${String(i).padStart(2, '0')}`, content: `I prefer direct feedback in review ${i}.` })
    }

    const progress: Array<[number, number]> = []
    const result = await reevaluatePendingInsights(db, {
      onProgress: (done, total) => progress.push([done, total]),
      isCancelled: () => false,
    })

    expect(mockCallAnthropic).toHaveBeenCalledTimes(3)
    expect(mockCallAnthropic.mock.calls.map(([options]) => (
      options.messages[0].content.match(/^\d+\. /gm) ?? []
    ).length)).toEqual([40, 40, 5])
    expect(result).toEqual({ evaluated: 85, filtered: 0, kept: 85, usedAi: true })
    expect(progress[progress.length - 1]).toEqual([85, 85])
  })

  it('fails open for missing and invalid AI verdicts', async () => {
    mockIsApiKeyConfigured.mockReturnValue(true)
    mockCallAnthropic.mockResolvedValue(JSON.stringify([
      { index: 1, kind: 'preference', self_relevance: 59 },
      { index: 2, kind: 'fact', self_relevance: 10 },
      { index: 3, self_relevance: 10 },
    ]))
    insertInsight({ id: 'ins-system', content: 'Maintains an automated weekly vault harvest.' })
    insertInsight({ id: 'ins-invalid-kind', content: 'Keeps an index of all processed notes.' })
    insertInsight({ id: 'ins-missing-kind', content: 'Archives import logs after every run.' })

    const result = await reevaluatePendingInsights(db, {
      onProgress: vi.fn(),
      isCancelled: () => false,
    })

    expect(result).toEqual({ evaluated: 3, filtered: 1, kept: 2, usedAi: true })
    expect(db.select().from(insights).where(eq(insights.id, 'ins-system')).get()?.verificationStatus).toBe('rejected')
    expect(db.select().from(insights).where(eq(insights.id, 'ins-invalid-kind')).get()?.verificationStatus).toBe('unverified')
    expect(db.select().from(insights).where(eq(insights.id, 'ins-missing-kind')).get()?.verificationStatus).toBe('unverified')
  })

  it('persists AI prior alignment and adjusted confidence for kept rows', async () => {
    mockIsApiKeyConfigured.mockReturnValue(true)
    mockCallAnthropic.mockResolvedValue(JSON.stringify([
      { index: 1, kind: 'preference', self_relevance: 90, prior_alignment: 'corroborated', confidence: 91 },
      { index: 2, kind: 'trait', self_relevance: 90, prior_alignment: 'tension', confidence: 90 },
    ]))
    insertInsight({ id: 'ins-corroborated', content: 'Prefers direct feedback during technical reviews.' })
    insertInsight({ id: 'ins-tension', content: 'Avoids direct feedback during technical reviews.' })

    const result = await reevaluatePendingInsights(db, {
      onProgress: vi.fn(),
      isCancelled: () => false,
    })

    expect(result).toEqual({ evaluated: 2, filtered: 0, kept: 2, usedAi: true })
    expect(db.select().from(insights).where(eq(insights.id, 'ins-corroborated')).get()).toMatchObject({
      priorAlignment: 'corroborated',
      confidenceScore: 91,
    })
    expect(db.select().from(insights).where(eq(insights.id, 'ins-tension')).get()).toMatchObject({
      priorAlignment: 'tension',
      confidenceScore: 60,
    })
  })

  it('uses the offline lexical gate when no API key is configured', async () => {
    mockIsApiKeyConfigured.mockReturnValue(false)
    insertInsight({
      id: 'ins-system',
      content: 'Runs automated weekly harvest processes over their personal knowledge vault that cross-check multiple memory sources.',
    })
    insertInsight({ id: 'ins-self', content: 'I prefer direct feedback during technical reviews.' })

    const result = await reevaluatePendingInsights(db, {
      onProgress: vi.fn(),
      isCancelled: () => false,
    })

    expect(result).toEqual({ evaluated: 2, filtered: 1, kept: 1, usedAi: false })
    expect(db.select().from(insights).where(eq(insights.id, 'ins-system')).get()?.verificationStatus).toBe('rejected')
    expect(db.select().from(insights).where(eq(insights.id, 'ins-self')).get()?.verificationStatus).toBe('unverified')
    expect(db.select().from(verificationHistory).where(eq(verificationHistory.insightId, 'ins-system')).all()).toEqual([
      expect.objectContaining({
        action: 'rejected',
        newContent: 'auto-filtered: personhood re-evaluation',
      }),
    ])
    expect(mockEnqueueVaultWrite).toHaveBeenCalledWith(db, 'ins-system', 'reject')
  })

  it('stops between rejection chunks and keeps partial progress', async () => {
    mockIsApiKeyConfigured.mockReturnValue(false)
    let cancelled = false
    const progress: Array<[number, number]> = []
    for (let i = 0; i < 45; i += 1) {
      insertInsight({
        id: `ins-${i}`,
        content: `Runs automated weekly harvest processes over their personal knowledge vault ${i}.`,
      })
    }

    const result = await reevaluatePendingInsights(db, {
      onProgress: (done, total) => {
        progress.push([done, total])
        if (done >= 20) cancelled = true
      },
      isCancelled: () => cancelled,
    })

    expect(result).toEqual({ evaluated: 20, filtered: 20, kept: 0, usedAi: false })
    expect(pendingRows()).toHaveLength(25)
    expect(mockEnqueueVaultWrite).toHaveBeenCalledTimes(20)
    expect(progress).toContainEqual([20, 45])
  })
})
