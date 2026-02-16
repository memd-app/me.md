import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ============================================
// Users
// ============================================
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  firebaseUid: text('firebase_uid').unique().notNull(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash'),
  name: text('name').notNull(),
  dateOfBirth: text('date_of_birth').notNull(),
  location: text('location').notNull(),
  occupation: text('occupation').notNull(),
  gender: text('gender').notNull(),
  onboardingCompleted: integer('onboarding_completed', { mode: 'boolean' }).default(false),
  importedContext: text('imported_context'), // JSON
  themePreference: text('theme_preference').default('light'), // 'light' | 'dark'
  notificationPreferences: text('notification_preferences'), // JSON
  sessionLengthDefault: integer('session_length_default').default(15), // minutes
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// ============================================
// Topics
// ============================================
export const topics = sqliteTable('topics', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  tags: text('tags'), // JSON array
  status: text('status').default('backlog'), // backlog | scheduled | in_progress | extracted | refined
  priority: text('priority').default('medium'), // low | medium | high
  intent: text('intent'), // articulate | explore | decide | document
  trigger: text('trigger'),
  referenceUrls: text('reference_urls'), // JSON array
  contextItems: text('context_items'), // JSON array
  isPreset: integer('is_preset', { mode: 'boolean' }).default(false),
  presetCategory: text('preset_category'), // identity | skills | experiences | perspectives | goals
  useCaseTemplateId: text('use_case_template_id').references(() => useCaseTemplates.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// ============================================
// Use Case Templates
// ============================================
export const useCaseTemplates = sqliteTable('use_case_templates', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  aiUseCaseTag: text('ai_use_case_tag'),
  interviewPrompts: text('interview_prompts'), // JSON
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ============================================
// Sessions
// ============================================
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').default('active'), // active | paused | completed | abandoned
  isMiniSession: integer('is_mini_session', { mode: 'boolean' }).default(false),
  suggestedDurationMinutes: integer('suggested_duration_minutes'), // from user's session_length_default setting
  timeSpentSeconds: integer('time_spent_seconds').default(0),
  researchData: text('research_data'), // JSON
  interviewMap: text('interview_map'), // JSON
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
});

// ============================================
// Messages
// ============================================
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(), // user | assistant
  content: text('content').notNull(),
  quickReplies: text('quick_replies'), // JSON array of 3 suggestions
  suggestsCompletion: integer('suggests_completion', { mode: 'boolean' }).default(false),
  isBookmarked: integer('is_bookmarked', { mode: 'boolean' }).default(false),
  isVoiceInput: integer('is_voice_input', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ============================================
// Notes
// ============================================
export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title'),
  contentFullAnalysis: text('content_full_analysis'),
  contentBriefSummary: text('content_brief_summary'),
  contentDecisionFramework: text('content_decision_framework'),
  contentJson: text('content_json'), // Structured JSON
  selectedFormat: text('selected_format').default('full_analysis'), // full_analysis | brief_summary | decision_framework | json
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// ============================================
// Insights
// ============================================
export const insights = sqliteTable('insights', {
  id: text('id').primaryKey(),
  noteId: text('note_id').references(() => notes.id, { onDelete: 'cascade' }).notNull(),
  topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  content: text('content').notNull(),
  confidenceScore: integer('confidence_score').default(50), // 0-100
  verificationStatus: text('verification_status').default('unverified'), // unverified | verified | rejected | re_verification_pending
  agreementScore: integer('agreement_score'), // 1-10
  privacyTier: text('privacy_tier').default('exportable'), // exportable | never_export
  sourceSessionId: text('source_session_id').references(() => sessions.id),
  verifiedAt: text('verified_at'),
  reVerifyAt: text('re_verify_at'),
  reVerifyInterval: text('re_verify_interval'), // weekly | monthly | quarterly | biannual | annual
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// ============================================
// Insight Conflicts
// ============================================
export const insightConflicts = sqliteTable('insight_conflicts', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  insightAId: text('insight_a_id').references(() => insights.id, { onDelete: 'cascade' }).notNull(),
  insightBId: text('insight_b_id').references(() => insights.id, { onDelete: 'cascade' }).notNull(),
  resolutionStatus: text('resolution_status').default('unresolved'), // unresolved | both_true_different_contexts | a_outdated | b_outdated | clarified
  resolutionNote: text('resolution_note'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  resolvedAt: text('resolved_at'),
});

// ============================================
// Topic Connections
// ============================================
export const topicConnections = sqliteTable('topic_connections', {
  id: text('id').primaryKey(),
  sourceTopicId: text('source_topic_id').references(() => topics.id, { onDelete: 'cascade' }).notNull(),
  targetTopicId: text('target_topic_id').references(() => topics.id, { onDelete: 'cascade' }).notNull(),
  connectionType: text('connection_type'), // multi_bucket | tag_shared | ai_detected
  relevanceScore: integer('relevance_score'), // 0-100
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ============================================
// Concept Nodes (Knowledge Graph)
// ============================================
export const conceptNodes = sqliteTable('concept_nodes', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }).notNull(),
  insightId: text('insight_id').references(() => insights.id, { onDelete: 'set null' }),
  label: text('label').notNull(),
  weight: real('weight').default(1.0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// ============================================
// Concept Edges (Knowledge Graph)
// ============================================
export const conceptEdges = sqliteTable('concept_edges', {
  id: text('id').primaryKey(),
  sourceNodeId: text('source_node_id').references(() => conceptNodes.id, { onDelete: 'cascade' }).notNull(),
  targetNodeId: text('target_node_id').references(() => conceptNodes.id, { onDelete: 'cascade' }).notNull(),
  relationship: text('relationship'),
  weight: real('weight').default(1.0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ============================================
// Verification History
// ============================================
export const verificationHistory = sqliteTable('verification_history', {
  id: text('id').primaryKey(),
  insightId: text('insight_id').references(() => insights.id, { onDelete: 'cascade' }).notNull(),
  action: text('action').notNull(), // verified | rejected | edited | re_verified | re_rejected
  previousContent: text('previous_content'),
  newContent: text('new_content'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ============================================
// Bookmarks
// ============================================
export const bookmarks = sqliteTable('bookmarks', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ============================================
// MCP Access Permissions
// ============================================
export const mcpAccessPermissions = sqliteTable('mcp_access_permissions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  agentName: text('agent_name').notNull(),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).default(true),
  lastAccessedAt: text('last_accessed_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// ============================================
// Password Reset Tokens
// ============================================
export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').unique().notNull(),
  expiresAt: text('expires_at').notNull(),
  used: integer('used', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ============================================
// Session Tokens (Auth)
// ============================================
export const sessionTokens = sqliteTable('session_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tokenHash: text('token_hash').unique().notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ============================================
// Imported Files
// ============================================
export const importedFiles = sqliteTable('imported_files', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  filename: text('filename').notNull(),
  fileType: text('file_type').notNull(),
  processedContent: text('processed_content'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});
