import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from '@/db/schema'
import { CREATE_TABLES_SQL } from '@/db/database'
import { getPendingInsights } from '../insights'

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
