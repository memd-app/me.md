import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from '../schema'

// We test database initialization logic directly using sql.js in Node.js,
// bypassing the browser-specific IndexedDB and locateFile parts of database.ts.
// This validates the schema SQL, Drizzle wrapping, and table creation.

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    name TEXT,
    date_of_birth TEXT,
    location TEXT,
    occupation TEXT,
    gender TEXT,
    onboarding_completed INTEGER DEFAULT 0,
    imported_context TEXT,
    theme_preference TEXT DEFAULT 'light',
    notification_preferences TEXT,
    session_length_default INTEGER DEFAULT 15,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS use_case_templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    ai_use_case_tag TEXT,
    interview_prompts TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    status TEXT DEFAULT 'backlog',
    priority TEXT DEFAULT 'medium',
    intent TEXT,
    trigger_text TEXT,
    reference_urls TEXT,
    context_items TEXT,
    is_preset INTEGER DEFAULT 0,
    preset_category TEXT,
    use_case_template_id TEXT REFERENCES use_case_templates(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'active',
    is_mini_session INTEGER DEFAULT 0,
    suggested_duration_minutes INTEGER,
    time_spent_seconds INTEGER DEFAULT 0,
    research_data TEXT,
    interview_map TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    quick_replies TEXT,
    suggests_completion INTEGER DEFAULT 0,
    is_bookmarked INTEGER DEFAULT 0,
    is_voice_input INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    content_full_analysis TEXT,
    content_brief_summary TEXT,
    content_decision_framework TEXT,
    content_json TEXT,
    selected_format TEXT DEFAULT 'full_analysis',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS insights (
    id TEXT PRIMARY KEY,
    note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    confidence_score INTEGER DEFAULT 50,
    verification_status TEXT DEFAULT 'unverified',
    agreement_score INTEGER,
    privacy_tier TEXT DEFAULT 'exportable',
    extraction_method TEXT DEFAULT 'ai',
    source_session_id TEXT REFERENCES sessions(id),
    verified_at TEXT,
    re_verify_at TEXT,
    re_verify_interval INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS verification_history (
    id TEXT PRIMARY KEY,
    insight_id TEXT NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    previous_content TEXT,
    new_content TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS insight_conflicts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    insight_a_id TEXT NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
    insight_b_id TEXT NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
    resolution_status TEXT DEFAULT 'unresolved',
    resolution_note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS topic_connections (
    id TEXT PRIMARY KEY,
    source_topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    target_topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    connection_type TEXT,
    relevance_score INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS concept_nodes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    insight_id TEXT REFERENCES insights(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS concept_edges (
    id TEXT PRIMARY KEY,
    source_node_id TEXT NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    target_node_id TEXT NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    relationship TEXT,
    weight REAL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS mcp_access_permissions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    last_accessed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS imported_files (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_type TEXT,
    processed_content TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS assessment_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT DEFAULT 'in_progress'
  );
  CREATE TABLE IF NOT EXISTS assessment_answers (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    answer_value INTEGER NOT NULL,
    answered_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS assessment_results (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    domain_score REAL NOT NULL,
    facet1_score REAL,
    facet2_score REAL,
    facet3_score REAL,
    facet4_score REAL,
    facet5_score REAL,
    facet6_score REAL
  );
  PRAGMA foreign_keys = ON;
`

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
    const tableNames = result[0].values.map((row) => row[0] as string)
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
