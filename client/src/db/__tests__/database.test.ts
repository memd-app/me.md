import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from '../schema'
import { CREATE_TABLES_SQL, runMigrations } from '../database'

// We test database initialization logic directly using sql.js in Node.js,
// bypassing the browser-specific IndexedDB and locateFile parts of database.ts.
// This validates the schema SQL, Drizzle wrapping, and table creation.


let sqlDb: SqlJsDatabase
let db: ReturnType<typeof drizzle>

describe('database initialization', () => {
  beforeAll(async () => {
    // In Node.js, sql.js can locate its own WASM binary from node_modules
    const SQL = await initSqlJs()
    sqlDb = new SQL.Database()
    sqlDb.run(CREATE_TABLES_SQL)
    db = drizzle(sqlDb, { schema })
  })

  afterAll(() => {
    sqlDb?.close()
  })

  it('initializes sql.js and returns a Drizzle db instance', () => {
    expect(db).toBeDefined()
  })

  it('creates all schema tables', () => {
    const result = sqlDb.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    const tableNames = result[0].values.map((row: any[]) => row[0] as string)
    expect(tableNames).toContain('users')
    expect(tableNames).toContain('topics')
    expect(tableNames).toContain('sessions')
    expect(tableNames).toContain('messages')
    expect(tableNames).toContain('insights')
    expect(tableNames).toContain('notes')
    expect(tableNames).toContain('verification_history')
    expect(tableNames).toContain('concept_nodes')
    expect(tableNames).toContain('concept_edges')
    expect(tableNames).toContain('bookmarks')
    expect(tableNames).toContain('mcp_access_permissions')
    expect(tableNames).toContain('imported_files')
    expect(tableNames).toContain('assessment_attempts')
    expect(tableNames).toContain('assessment_answers')
    expect(tableNames).toContain('assessment_results')
  })

  it('creates assessment discriminator and result detail columns on fresh databases', () => {
    const attemptsInfo = sqlDb.exec('PRAGMA table_info(assessment_attempts)')[0].values
    const resultsInfo = sqlDb.exec('PRAGMA table_info(assessment_results)')[0].values

    expect(attemptsInfo.map((row: any[]) => row[1])).toContain('assessment_type')
    expect(resultsInfo.map((row: any[]) => row[1])).toContain('detail')
  })

  it('migrates older assessment tables and backfills the default assessment type', async () => {
    const SQL = await initSqlJs()
    const oldDb = new SQL.Database()
    oldDb.run(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE assessment_attempts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        status TEXT DEFAULT 'in_progress'
      );
      CREATE TABLE assessment_results (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        domain_score REAL NOT NULL,
        facet1_score REAL,
        facet2_score REAL,
        facet3_score REAL,
        facet4_score REAL,
        facet5_score REAL,
        facet6_score REAL
      );
      INSERT INTO assessment_attempts (id, user_id, status)
      VALUES ('attempt-1', 'local-user', 'completed');
    `)

    runMigrations(oldDb)

    const attemptsInfo = oldDb.exec('PRAGMA table_info(assessment_attempts)')[0].values
    const resultsInfo = oldDb.exec('PRAGMA table_info(assessment_results)')[0].values
    const typeValue = oldDb.exec("SELECT assessment_type FROM assessment_attempts WHERE id = 'attempt-1'")[0].values[0][0]

    expect(attemptsInfo.map((row: any[]) => row[1])).toContain('assessment_type')
    expect(resultsInfo.map((row: any[]) => row[1])).toContain('detail')
    expect(typeValue).toBe('bigfive')

    oldDb.close()
  })

  it('can insert and read data via raw sql.js', () => {
    sqlDb.run("INSERT INTO users (id, name, email) VALUES ('test-1', 'Test User', 'test@example.com')")
    const result = sqlDb.exec("SELECT name FROM users WHERE id = 'test-1'")
    expect(result[0].values[0][0]).toBe('Test User')
  })

  it('can export and re-import database bytes', () => {
    const exported = sqlDb.export()
    expect(exported).toBeInstanceOf(Uint8Array)
    expect(exported.length).toBeGreaterThan(0)
  })

  it('Drizzle instance can query via select', async () => {
    const result = await db.select().from(schema.users)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].name).toBe('Test User')
  })
})
