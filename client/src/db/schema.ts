import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// Users (single local user — no firebaseUid, no passwordHash)
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email'),
  name: text('name'),
  dateOfBirth: text('date_of_birth'),
  location: text('location'),
  occupation: text('occupation'),
  gender: text('gender'),
  onboardingCompleted: integer('onboarding_completed', { mode: 'boolean' }).default(false),
  importedContext: text('imported_context'),
  themePreference: text('theme_preference').default('light'),
  notificationPreferences: text('notification_preferences'),
  sessionLengthDefault: integer('session_length_default').default(15),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
})

// Use Case Templates
export const useCaseTemplates = sqliteTable('use_case_templates', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  aiUseCaseTag: text('ai_use_case_tag'),
  interviewPrompts: text('interview_prompts'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// Topics
export const topics = sqliteTable('topics', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  tags: text('tags'),
  status: text('status').default('backlog'),
  priority: text('priority').default('medium'),
  intent: text('intent'),
  trigger: text('trigger_text'),
  referenceUrls: text('reference_urls'),
  contextItems: text('context_items'),
  isPreset: integer('is_preset', { mode: 'boolean' }).default(false),
  presetCategory: text('preset_category'),
  useCaseTemplateId: text('use_case_template_id').references(() => useCaseTemplates.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
})

// Sessions
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').default('active'),
  isMiniSession: integer('is_mini_session', { mode: 'boolean' }).default(false),
  suggestedDurationMinutes: integer('suggested_duration_minutes'),
  timeSpentSeconds: integer('time_spent_seconds').default(0),
  researchData: text('research_data'),
  interviewMap: text('interview_map'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
})

// Messages
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  quickReplies: text('quick_replies'),
  suggestsCompletion: integer('suggests_completion', { mode: 'boolean' }).default(false),
  isBookmarked: integer('is_bookmarked', { mode: 'boolean' }).default(false),
  isVoiceInput: integer('is_voice_input', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// Notes
export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
  topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title'),
  contentFullAnalysis: text('content_full_analysis'),
  contentBriefSummary: text('content_brief_summary'),
  contentDecisionFramework: text('content_decision_framework'),
  contentJson: text('content_json'),
  selectedFormat: text('selected_format').default('full_analysis'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
})

// Insights
export const insights = sqliteTable('insights', {
  id: text('id').primaryKey(),
  noteId: text('note_id').references(() => notes.id, { onDelete: 'cascade' }),
  topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  content: text('content').notNull(),
  confidenceScore: integer('confidence_score').default(50),
  verificationStatus: text('verification_status').default('unverified'),
  agreementScore: integer('agreement_score'),
  privacyTier: text('privacy_tier').default('exportable'),
  extractionMethod: text('extraction_method').default('ai'),
  sourceSessionId: text('source_session_id').references(() => sessions.id),
  evidenceCount: integer('evidence_count').default(0),
  evidenceSources: text('evidence_sources'),
  priorAlignment: text('prior_alignment'),
  kind: text('kind'),
  vaultContentHash: text('vault_content_hash'),
  vaultBodyHash: text('vault_body_hash'),
  vaultSyncedAt: text('vault_synced_at'),
  verifiedAt: text('verified_at'),
  reVerifyAt: text('re_verify_at'),
  reVerifyInterval: integer('re_verify_interval'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
})

export const profileFacets = sqliteTable('profile_facets', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  agentBrief: text('agent_brief'),
  generatedAt: text('generated_at').default(sql`(datetime('now'))`),
  insightCount: integer('insight_count').default(0),
})

// Verification History
export const verificationHistory = sqliteTable('verification_history', {
  id: text('id').primaryKey(),
  insightId: text('insight_id').references(() => insights.id, { onDelete: 'cascade' }).notNull(),
  action: text('action').notNull(),
  previousContent: text('previous_content'),
  newContent: text('new_content'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// Insight Conflicts
export const insightConflicts = sqliteTable('insight_conflicts', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  insightAId: text('insight_a_id').references(() => insights.id, { onDelete: 'cascade' }).notNull(),
  insightBId: text('insight_b_id').references(() => insights.id, { onDelete: 'cascade' }).notNull(),
  resolutionStatus: text('resolution_status').default('unresolved'),
  resolutionNote: text('resolution_note'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  resolvedAt: text('resolved_at'),
})

// Topic Connections
export const topicConnections = sqliteTable('topic_connections', {
  id: text('id').primaryKey(),
  sourceTopicId: text('source_topic_id').references(() => topics.id, { onDelete: 'cascade' }).notNull(),
  targetTopicId: text('target_topic_id').references(() => topics.id, { onDelete: 'cascade' }).notNull(),
  connectionType: text('connection_type'),
  relevanceScore: integer('relevance_score'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// Concept Nodes & Edges
export const conceptNodes = sqliteTable('concept_nodes', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }).notNull(),
  insightId: text('insight_id').references(() => insights.id, { onDelete: 'set null' }),
  label: text('label').notNull(),
  weight: real('weight').default(1.0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
})

export const conceptEdges = sqliteTable('concept_edges', {
  id: text('id').primaryKey(),
  sourceNodeId: text('source_node_id').references(() => conceptNodes.id, { onDelete: 'cascade' }).notNull(),
  targetNodeId: text('target_node_id').references(() => conceptNodes.id, { onDelete: 'cascade' }).notNull(),
  relationship: text('relationship'),
  weight: real('weight').default(1.0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// Bookmarks
export const bookmarks = sqliteTable('bookmarks', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// MCP Access Permissions
export const mcpAccessPermissions = sqliteTable('mcp_access_permissions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  agentName: text('agent_name').notNull(),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).default(true),
  lastAccessedAt: text('last_accessed_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
})

// Imported Files
export const importedFiles = sqliteTable('imported_files', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  filename: text('filename').notNull(),
  fileType: text('file_type'),
  processedContent: text('processed_content'),
  contentHash: text('content_hash'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// Assessment
export const assessmentAttempts = sqliteTable('assessment_attempts', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  assessmentType: text('assessment_type').default('bigfive'),
  startedAt: text('started_at').default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
  status: text('status').default('in_progress'),
})

export const assessmentAnswers = sqliteTable('assessment_answers', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id').references(() => assessmentAttempts.id, { onDelete: 'cascade' }).notNull(),
  questionId: text('question_id').notNull(),
  answerValue: integer('answer_value').notNull(),
  answeredAt: text('answered_at').default(sql`(datetime('now'))`),
})

export const assessmentResults = sqliteTable('assessment_results', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id').references(() => assessmentAttempts.id, { onDelete: 'cascade' }).notNull(),
  domain: text('domain').notNull(),
  domainScore: real('domain_score').notNull(),
  facet1Score: real('facet1_score'),
  facet2Score: real('facet2_score'),
  facet3Score: real('facet3_score'),
  facet4Score: real('facet4_score'),
  facet5Score: real('facet5_score'),
  facet6Score: real('facet6_score'),
  detail: text('detail'),
})
