import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import type { SQLJsDatabase as DrizzleDb } from 'drizzle-orm/sql-js'
import * as schema from './schema'

let sqlDb: SqlJsDatabase | null = null
let drizzleDb: DrizzleDb<typeof schema> | null = null

const DB_KEY = 'memd_database'
const DB_STORE = 'memd_store'

// ---- IndexedDB helpers ----

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_STORE, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function loadFromIDB(): Promise<Uint8Array | null> {
  const idb = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readonly')
    const store = tx.objectStore(DB_STORE)
    const req = store.get(DB_KEY)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => idb.close()
  })
}

async function saveToIDB(data: Uint8Array): Promise<void> {
  const idb = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readwrite')
    const store = tx.objectStore(DB_STORE)
    store.put(data, DB_KEY)
    tx.oncomplete = () => { idb.close(); resolve() }
    tx.onerror = () => { idb.close(); reject(tx.error) }
  })
}

// ---- Schema creation SQL ----

export const CREATE_TABLES_SQL = `
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
    evidence_count INTEGER DEFAULT 0,
    evidence_sources TEXT,
    vault_content_hash TEXT,
    vault_body_hash TEXT,
    vault_synced_at TEXT,
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
    content_hash TEXT,
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

function columnExists(sqlDb: SqlJsDatabase, table: string, column: string): boolean {
  const res = sqlDb.exec(`PRAGMA table_info(${table})`)
  if (!res.length) return false
  return res[0].values.some(row => row[1] === column)
}

const MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  { table: 'insights', column: 'evidence_count', ddl: 'ALTER TABLE insights ADD COLUMN evidence_count INTEGER DEFAULT 0' },
  { table: 'insights', column: 'evidence_sources', ddl: 'ALTER TABLE insights ADD COLUMN evidence_sources TEXT' },
  { table: 'insights', column: 'vault_content_hash', ddl: 'ALTER TABLE insights ADD COLUMN vault_content_hash TEXT' },
  { table: 'insights', column: 'vault_body_hash', ddl: 'ALTER TABLE insights ADD COLUMN vault_body_hash TEXT' },
  { table: 'insights', column: 'vault_synced_at', ddl: 'ALTER TABLE insights ADD COLUMN vault_synced_at TEXT' },
  { table: 'imported_files', column: 'content_hash', ddl: 'ALTER TABLE imported_files ADD COLUMN content_hash TEXT' },
]

function runMigrations(sqlDb: SqlJsDatabase): void {
  for (const migration of MIGRATIONS) {
    if (!columnExists(sqlDb, migration.table, migration.column)) sqlDb.run(migration.ddl)
  }
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_imported_files_hash ON imported_files(content_hash)')
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_insights_vault_synced ON insights(vault_synced_at)')
}

// ---- Public API ----

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => `/${file}`,
  })

  // Try to load existing database from IndexedDB
  const saved = await loadFromIDB()
  sqlDb = saved ? new SQL.Database(saved) : new SQL.Database()

  // Create tables (IF NOT EXISTS — safe for existing databases)
  sqlDb.run(CREATE_TABLES_SQL)
  runMigrations(sqlDb)

  // Wrap with Drizzle
  drizzleDb = drizzle(sqlDb, { schema })
}

export function getDb(): DrizzleDb<typeof schema> {
  if (!drizzleDb) throw new Error('Database not initialized. Call initDatabase() first.')
  return drizzleDb
}

export function getRawDb(): SqlJsDatabase {
  if (!sqlDb) throw new Error('Database not initialized. Call initDatabase() first.')
  return sqlDb
}

export function exportDbBytes(): Uint8Array {
  return getRawDb().export()
}

export async function saveDatabase(): Promise<void> {
  const data = exportDbBytes()
  await saveToIDB(data)
}

export async function resetDatabase(): Promise<void> {
  sqlDb?.close()
  sqlDb = null
  drizzleDb = null
}
