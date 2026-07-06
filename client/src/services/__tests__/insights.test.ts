import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from '@/db/schema'
import { CREATE_TABLES_SQL } from '@/db/database'
import { getGraphStats, getPendingInsights } from '../insights'

vi.mock('@/db/persistence', () => ({
  scheduleSave: vi.fn(),
}))

describe('getPendingInsights', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeAll(async () => {
    const SQL = await initSqlJs()
    const sqlDb = new SQL.Database()
    sqlDb.run('PRAGMA foreign_keys = ON;')
    sqlDb.run(CREATE_TABLES_SQL)
    db = drizzle(sqlDb, { schema })
  })

  beforeEach(() => {
    db.run('DELETE FROM insights')
    db.run('DELETE FROM users')
    db.run("INSERT OR IGNORE INTO users (id, name) VALUES ('local-user', 'Test User')")
  })

  function insertPending(id: string, confidenceScore: number, createdAt: string): void {
    db.run(`
      INSERT INTO insights (
        id,
        user_id,
        content,
        confidence_score,
        verification_status,
        created_at
      )
      VALUES (
        '${id}',
        'local-user',
        'Insight ${id}',
        ${confidenceScore},
        'unverified',
        '${createdAt}'
      )
    `)
  }

  it('orders pending insights by confidence before created time', () => {
    insertPending('low', 40, '2026-07-05T12:00:00.000Z')
    insertPending('high', 90, '2026-07-05T10:00:00.000Z')
    insertPending('middle', 70, '2026-07-05T11:00:00.000Z')

    expect(getPendingInsights(db).insights.map((insight: { id: string }) => insight.id)).toEqual(['high', 'middle', 'low'])
  })

  it('falls back to created time descending when confidence is equal', () => {
    insertPending('older', 70, '2026-07-05T10:00:00.000Z')
    insertPending('newer', 70, '2026-07-05T12:00:00.000Z')
    insertPending('low', 40, '2026-07-05T11:00:00.000Z')

    expect(getPendingInsights(db).insights.map((insight: { id: string }) => insight.id)).toEqual(['newer', 'older', 'low'])
  })
})

describe('getGraphStats', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeAll(async () => {
    const SQL = await initSqlJs()
    const sqlDb = new SQL.Database()
    sqlDb.run('PRAGMA foreign_keys = ON;')
    sqlDb.run(CREATE_TABLES_SQL)
    db = drizzle(sqlDb, { schema })
  })

  beforeEach(() => {
    db.run('DELETE FROM insights')
    db.run('DELETE FROM topics')
    db.run('DELETE FROM users')
    db.run("INSERT OR IGNORE INTO users (id, name) VALUES ('local-user', 'Test User')")
    db.run("INSERT OR IGNORE INTO users (id, name) VALUES ('other-user', 'Other User')")
    db.run("INSERT INTO topics (id, user_id, title) VALUES ('topic-work', 'local-user', 'Work')")
    db.run("INSERT INTO topics (id, user_id, title) VALUES ('topic-communication', 'local-user', 'Communication')")
  })

  function insertInsight(params: {
    id: string
    topicId?: string | null
    userId?: string
    kind?: string | null
    status?: string
  }): void {
    db.run(`
      INSERT INTO insights (
        id,
        user_id,
        topic_id,
        content,
        confidence_score,
        verification_status,
        kind
      )
      VALUES (
        '${params.id}',
        '${params.userId ?? 'local-user'}',
        ${params.topicId === null ? 'NULL' : `'${params.topicId ?? 'topic-work'}'`},
        'Insight ${params.id}',
        80,
        '${params.status ?? 'verified'}',
        ${params.kind === undefined || params.kind === null ? 'NULL' : `'${params.kind}'`}
      )
    `)
  }

  it('counts verified insights by kind and topic size for the local user', () => {
    insertInsight({ id: 'belief-1', topicId: 'topic-work', kind: 'belief' })
    insertInsight({ id: 'belief-2', topicId: 'topic-work', kind: 'belief' })
    insertInsight({ id: 'uncategorized', topicId: 'topic-communication' })
    insertInsight({ id: 'pending-trait', topicId: 'topic-communication', kind: 'trait', status: 'unverified' })
    insertInsight({ id: 'other-user-belief', topicId: null, kind: 'belief', userId: 'other-user' })

    expect(getGraphStats(db)).toEqual({
      byKind: [
        { kind: 'belief', label: 'Beliefs', count: 2 },
        { kind: null, label: 'Uncategorized', count: 1 },
      ],
      topicSizes: [
        { title: 'Work', count: 2 },
        { title: 'Communication', count: 1 },
      ],
      verifiedTotal: 3,
      topicTotal: 2,
    })
  })

  it('sorts equal topic sizes by title', () => {
    insertInsight({ id: 'work', topicId: 'topic-work', kind: 'habit' })
    insertInsight({ id: 'communication', topicId: 'topic-communication', kind: 'habit' })

    expect(getGraphStats(db).topicSizes).toEqual([
      { title: 'Communication', count: 1 },
      { title: 'Work', count: 1 },
    ])
  })
})
