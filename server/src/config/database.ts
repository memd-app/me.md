import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../models/schema.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, '..', '..', 'data', 'memd.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

console.log(`[me.md] Connecting to database at: ${DB_PATH}`);

const sqlite = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Create tables if they don't exist (schema push)
function initializeSchema() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      firebase_uid TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      location TEXT NOT NULL,
      occupation TEXT NOT NULL,
      gender TEXT NOT NULL,
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
      "trigger" TEXT,
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
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
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
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      confidence_score INTEGER DEFAULT 50,
      verification_status TEXT DEFAULT 'unverified',
      agreement_score INTEGER,
      privacy_tier TEXT DEFAULT 'exportable',
      source_session_id TEXT REFERENCES sessions(id),
      verified_at TEXT,
      re_verify_at TEXT,
      re_verify_interval TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
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

    CREATE TABLE IF NOT EXISTS verification_history (
      id TEXT PRIMARY KEY,
      insight_id TEXT NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      previous_content TEXT,
      new_content TEXT,
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
      file_type TEXT NOT NULL,
      processed_content TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  console.log('[me.md] Database schema initialized');
}

initializeSchema();

export const db = drizzle(sqlite, {
  schema,
  logger: {
    logQuery(query: string, params: unknown[]) {
      console.log(`[me.md:db] SQL: ${query}`);
      if (params.length > 0) {
        console.log(`[me.md:db] Params: ${JSON.stringify(params)}`);
      }
    },
  },
});
export { sqlite };

console.log('[me.md] Database connection established');
