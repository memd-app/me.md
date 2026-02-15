// ============================================
// Shared Types for me.md
// Used by both client and server
// ============================================

// User
export interface User {
  id: string;
  firebaseUid: string;
  email: string;
  name: string;
  dateOfBirth: string;
  location: string;
  occupation: string;
  gender: string;
  onboardingCompleted: boolean;
  importedContext: string | null;
  themePreference: 'light' | 'dark';
  notificationPreferences: string | null;
  sessionLengthDefault: number;
  createdAt: string;
  updatedAt: string;
}

// Topic
export type TopicStatus = 'backlog' | 'scheduled' | 'in_progress' | 'extracted' | 'refined';
export type TopicPriority = 'low' | 'medium' | 'high';
export type TopicIntent = 'articulate' | 'explore' | 'decide' | 'document';
export type PresetCategory = 'identity' | 'skills' | 'experiences' | 'perspectives' | 'goals';

export interface Topic {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  tags: string[];
  status: TopicStatus;
  priority: TopicPriority;
  intent: TopicIntent | null;
  trigger: string | null;
  referenceUrls: string[];
  contextItems: string[];
  isPreset: boolean;
  presetCategory: PresetCategory | null;
  useCaseTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Use Case Template
export interface UseCaseTemplate {
  id: string;
  title: string;
  description: string | null;
  aiUseCaseTag: string | null;
  interviewPrompts: object | null;
  createdAt: string;
}

// Session
export type SessionStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export interface Session {
  id: string;
  topicId: string;
  userId: string;
  status: SessionStatus;
  isMiniSession: boolean;
  timeSpentSeconds: number;
  researchData: object | null;
  interviewMap: object | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

// Message
export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  quickReplies: string[] | null;
  suggestsCompletion: boolean;
  isBookmarked: boolean;
  isVoiceInput: boolean;
  createdAt: string;
}

// Note
export type NoteFormat = 'full_analysis' | 'brief_summary' | 'decision_framework' | 'json';

export interface Note {
  id: string;
  sessionId: string;
  topicId: string;
  userId: string;
  title: string | null;
  contentFullAnalysis: string | null;
  contentBriefSummary: string | null;
  contentDecisionFramework: string | null;
  contentJson: string | null;
  selectedFormat: NoteFormat;
  createdAt: string;
  updatedAt: string;
}

// Insight
export type VerificationStatus = 'unverified' | 'verified' | 'rejected' | 're_verification_pending';
export type PrivacyTier = 'exportable' | 'never_export';
export type ReVerifyInterval = 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual';

export interface Insight {
  id: string;
  noteId: string;
  topicId: string;
  userId: string;
  content: string;
  confidenceScore: number;
  verificationStatus: VerificationStatus;
  agreementScore: number | null;
  privacyTier: PrivacyTier;
  sourceSessionId: string | null;
  verifiedAt: string | null;
  reVerifyAt: string | null;
  reVerifyInterval: ReVerifyInterval | null;
  createdAt: string;
  updatedAt: string;
}

// Insight Conflict
export type ConflictResolution = 'unresolved' | 'both_true_different_contexts' | 'a_outdated' | 'b_outdated' | 'clarified';

export interface InsightConflict {
  id: string;
  userId: string;
  insightAId: string;
  insightBId: string;
  resolutionStatus: ConflictResolution;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// Topic Connection
export type ConnectionType = 'multi_bucket' | 'tag_shared' | 'ai_detected';

export interface TopicConnection {
  id: string;
  sourceTopicId: string;
  targetTopicId: string;
  connectionType: ConnectionType | null;
  relevanceScore: number | null;
  createdAt: string;
}

// Knowledge Graph
export interface ConceptNode {
  id: string;
  userId: string;
  topicId: string;
  insightId: string | null;
  label: string;
  weight: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConceptEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationship: string | null;
  weight: number;
  createdAt: string;
}

// Verification History
export type VerificationAction = 'verified' | 'rejected' | 'edited' | 're_verified' | 're_rejected';

export interface VerificationHistoryEntry {
  id: string;
  insightId: string;
  action: VerificationAction;
  previousContent: string | null;
  newContent: string | null;
  createdAt: string;
}

// Bookmark
export interface Bookmark {
  id: string;
  userId: string;
  messageId: string;
  sessionId: string;
  createdAt: string;
}

// MCP Access Permission
export interface McpAccessPermission {
  id: string;
  userId: string;
  agentName: string;
  isEnabled: boolean;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Imported File
export interface ImportedFile {
  id: string;
  userId: string;
  filename: string;
  fileType: string;
  processedContent: string | null;
  createdAt: string;
}

// API Response types
export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  database: {
    connected: boolean;
    tables: string[];
    tableCount: number;
  };
  version: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

// Knowledge Graph visualization types
export interface GraphNode {
  id: string;
  type: 'topic' | 'concept';
  label: string;
  topicId?: string;
  weight: number;
  isExplored: boolean;
  insightCount: number;
  verifiedCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: string | null;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
