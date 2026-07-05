import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { eq, and, or, desc } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { topics, sessions, messages, notes, insights, topicConnections, conceptNodes, bookmarks, users } from '@/db/schema'
import { scheduleSave } from '@/db/persistence'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { isAIAvailable, generatePersonalizedTopicSuggestions } from './ai'
import type { TopicSuggestionContext } from './ai'

type Db = SQLJsDatabase<typeof schema>

// Valid enum values for topic fields
const VALID_STATUSES = ['backlog', 'in_progress', 'extracted', 'refined']
const VALID_PRIORITIES = ['high', 'medium', 'low']
const VALID_INTENTS = ['articulate', 'explore', 'decide', 'document']

// Preset topics data - 16 topics across 5 categories
const PRESET_TOPICS = [
  // Identity (4 topics)
  {
    title: 'Core Values & Beliefs',
    description: 'Explore the fundamental values and beliefs that guide your decisions and shape who you are.',
    category: 'identity',
    intent: 'articulate',
    tags: ['values', 'beliefs', 'identity'],
    suggestedQuestion: 'What are the 3-5 values you would never compromise on, even under pressure?',
  },
  {
    title: 'Personal Identity & Self-Image',
    description: 'How you see yourself, your strengths, and what makes you uniquely you.',
    category: 'identity',
    intent: 'explore',
    tags: ['self-image', 'strengths', 'identity'],
    suggestedQuestion: 'How would your closest friend describe you to someone who has never met you?',
  },
  {
    title: 'Life Philosophy & Worldview',
    description: 'Your overarching philosophy about life, purpose, and meaning.',
    category: 'identity',
    intent: 'articulate',
    tags: ['philosophy', 'worldview', 'meaning'],
    suggestedQuestion: 'What do you believe is the purpose of a well-lived life?',
  },
  // Skills (3 topics)
  {
    title: 'Communication Style',
    description: 'How you communicate in writing, speaking, and different contexts (professional vs personal).',
    category: 'skills',
    intent: 'articulate',
    tags: ['communication', 'writing', 'speaking'],
    suggestedQuestion: 'When you write an important email, what patterns do you notice in your style?',
  },
  {
    title: 'Problem-Solving Approach',
    description: 'Your methods and mental models for tackling challenges and making decisions.',
    category: 'skills',
    intent: 'explore',
    tags: ['problem-solving', 'decision-making', 'thinking'],
    suggestedQuestion: 'Walk me through how you approached the last difficult problem you solved.',
  },
  {
    title: 'Professional Expertise',
    description: 'Your domain knowledge, professional skills, and areas of deep expertise.',
    category: 'skills',
    intent: 'document',
    tags: ['expertise', 'professional', 'skills'],
    suggestedQuestion: 'What is the area where people most often seek your advice or expertise?',
  },
  // Experiences (3 topics)
  {
    title: 'Formative Life Experiences',
    description: 'Key moments and experiences that shaped who you are today.',
    category: 'experiences',
    intent: 'explore',
    tags: ['life-events', 'growth', 'formative'],
    suggestedQuestion: 'What experience in your life changed how you see the world the most?',
  },
  {
    title: 'Career Journey',
    description: 'Your professional path, key transitions, lessons learned, and career defining moments.',
    category: 'experiences',
    intent: 'document',
    tags: ['career', 'professional', 'journey'],
    suggestedQuestion: 'What was the most pivotal career decision you ever made, and what drove it?',
  },
  {
    title: 'Relationships & Social Patterns',
    description: 'How you build and maintain relationships, your social preferences, and interpersonal patterns.',
    category: 'experiences',
    intent: 'explore',
    tags: ['relationships', 'social', 'interpersonal'],
    suggestedQuestion: 'What does a deep, meaningful friendship look like to you?',
  },
  // Perspectives (3 topics)
  {
    title: 'Leadership & Management Style',
    description: 'How you lead, motivate others, handle conflict, and your management philosophy.',
    category: 'perspectives',
    intent: 'articulate',
    tags: ['leadership', 'management', 'team'],
    suggestedQuestion: 'What does great leadership look like to you, and how do you try to embody it?',
  },
  {
    title: 'Creative Process & Inspiration',
    description: 'How you generate ideas, find inspiration, and approach creative work.',
    category: 'perspectives',
    intent: 'explore',
    tags: ['creativity', 'inspiration', 'ideas'],
    suggestedQuestion: 'Where do your best ideas come from? Describe your creative process.',
  },
  {
    title: 'Feedback & Learning Style',
    description: 'How you give and receive feedback, and your preferred ways of learning new things.',
    category: 'perspectives',
    intent: 'explore',
    tags: ['feedback', 'learning', 'growth'],
    suggestedQuestion: 'How do you prefer to receive critical feedback, and how do you give it to others?',
  },
  // Goals (3 topics)
  {
    title: 'Short-term Goals & Priorities',
    description: 'What you are focused on achieving in the next 6-12 months.',
    category: 'goals',
    intent: 'decide',
    tags: ['goals', 'priorities', 'near-term'],
    suggestedQuestion: 'What are the top 3 things you want to accomplish in the next year?',
  },
  {
    title: 'Long-term Vision & Aspirations',
    description: 'Your big-picture aspirations and where you see yourself in 5-10 years.',
    category: 'goals',
    intent: 'explore',
    tags: ['vision', 'aspirations', 'long-term'],
    suggestedQuestion: 'If you could design your ideal life 10 years from now, what would it look like?',
  },
  {
    title: 'Personal Growth Areas',
    description: 'Skills, habits, or qualities you want to develop and improve.',
    category: 'goals',
    intent: 'decide',
    tags: ['growth', 'improvement', 'development'],
    suggestedQuestion: 'What is one area of your life where you feel there is the most room for growth?',
  },
  {
    title: 'Work-Life Balance & Boundaries',
    description: 'How you manage energy, set boundaries, and balance different areas of your life.',
    category: 'goals',
    intent: 'articulate',
    tags: ['balance', 'boundaries', 'wellness'],
    suggestedQuestion: 'What does a truly balanced week look like for you?',
  },
]

// ============================================
// CRUD Operations
// ============================================

export interface CreateTopicData {
  title: string
  description?: string | null
  tags?: string[] | null
  status?: string
  priority?: string
  intent?: string | null
  trigger?: string | null
  referenceUrls?: string[] | null
  contextItems?: string[] | null
  isPreset?: boolean
  presetCategory?: string | null
}

export interface UpdateTopicData {
  title?: string
  description?: string | null
  tags?: string[] | null
  status?: string
  priority?: string
  intent?: string | null
  trigger?: string | null
  referenceUrls?: string[] | null
  contextItems?: string[] | null
}

/**
 * List all topics for the local user, ordered by creation date descending.
 */
export function getTopics(db: Db) {
  return db.select().from(topics)
    .where(eq(topics.userId, LOCAL_USER_ID))
    .orderBy(desc(topics.createdAt))
    .all()
}

/**
 * Get a single topic by ID (with related insights and connections).
 */
export function getTopic(db: Db, id: string) {
  const topic = db.select().from(topics)
    .where(and(eq(topics.id, id), eq(topics.userId, LOCAL_USER_ID)))
    .get()

  if (!topic) return undefined

  const topicInsights = db.select().from(insights)
    .where(and(eq(insights.topicId, id), eq(insights.userId, LOCAL_USER_ID)))
    .all()

  const connections = db.select().from(topicConnections)
    .where(or(eq(topicConnections.sourceTopicId, id), eq(topicConnections.targetTopicId, id)))
    .all()

  const connectedTopicIds = connections
    .map((c: any) => c.sourceTopicId === id ? c.targetTopicId : c.sourceTopicId)
    .filter((tid: string, index: number, self: string[]) => self.indexOf(tid) === index)

  const connectedTopics = connectedTopicIds.map((ctId: string) => {
    const ct = db.select().from(topics)
      .where(and(eq(topics.id, ctId), eq(topics.userId, LOCAL_USER_ID)))
      .get()
    if (!ct) return null
    const conn = connections.find((c: any) =>
      (c.sourceTopicId === id && c.targetTopicId === ctId) ||
      (c.targetTopicId === id && c.sourceTopicId === ctId)
    )
    return {
      id: ct.id,
      title: ct.title,
      status: ct.status,
      connectionType: conn?.connectionType || 'unknown',
      relevanceScore: conn?.relevanceScore || 0,
    }
  }).filter(Boolean)

  return { ...topic, insights: topicInsights, connectedTopics }
}

/**
 * Create a new topic. Returns the created topic row.
 */
export function createTopic(db: Db, data: CreateTopicData) {
  const { title, description, tags, status, priority, intent, trigger, referenceUrls, contextItems, isPreset, presetCategory } = data

  if (!title || (typeof title === 'string' && !title.trim())) {
    throw new Error('Title is required. Please provide a descriptive name for your topic.')
  }

  if (typeof title === 'string' && title.trim().length > 200) {
    throw new Error('Title is too long. Please keep it under 200 characters.')
  }

  if (status !== undefined && status !== null && !VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`)
  }

  if (priority !== undefined && priority !== null && !VALID_PRIORITIES.includes(priority)) {
    throw new Error(`Invalid priority "${priority}". Must be one of: ${VALID_PRIORITIES.join(', ')}`)
  }

  if (intent !== undefined && intent !== null && !VALID_INTENTS.includes(intent)) {
    throw new Error(`Invalid intent "${intent}". Must be one of: ${VALID_INTENTS.join(', ')}`)
  }

  if (tags !== undefined && tags !== null && !Array.isArray(tags)) {
    throw new Error('Tags must be an array of strings')
  }

  if (Array.isArray(tags)) {
    if (tags.length > 20) {
      throw new Error('Too many tags. Maximum of 20 tags allowed.')
    }
    for (const tag of tags) {
      if (typeof tag !== 'string') throw new Error('Each tag must be a string.')
      if (tag.trim().length === 0) throw new Error('Tags cannot be empty strings.')
      if (tag.trim().length > 50) throw new Error(`Tag "${tag.trim().slice(0, 20)}..." is too long. Maximum 50 characters per tag.`)
    }
  }

  if (description && typeof description === 'string' && description.length > 2000) {
    throw new Error('Description is too long. Please keep it under 2000 characters.')
  }

  const sanitizedTags = Array.isArray(tags)
    ? [...new Set(tags.map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 0))]
    : null

  const topicId = crypto.randomUUID()

  const newTopic = db.insert(topics).values({
    id: topicId,
    userId: LOCAL_USER_ID,
    title,
    description: description || null,
    tags: sanitizedTags ? JSON.stringify(sanitizedTags) : null,
    status: status || 'backlog',
    priority: priority || 'medium',
    intent: intent || null,
    trigger: trigger || null,
    referenceUrls: referenceUrls ? JSON.stringify(referenceUrls) : null,
    contextItems: contextItems ? JSON.stringify(contextItems) : null,
    isPreset: isPreset || false,
    presetCategory: presetCategory || null,
  }).returning().get()

  scheduleSave()
  return newTopic
}

/**
 * Update an existing topic. Returns the updated topic row.
 */
export function updateTopic(db: Db, id: string, data: UpdateTopicData) {
  const existing = db.select().from(topics)
    .where(and(eq(topics.id, id), eq(topics.userId, LOCAL_USER_ID)))
    .get()

  if (!existing) {
    throw new Error('Topic not found')
  }

  const { title, description, tags, status, priority, intent, trigger, referenceUrls, contextItems } = data

  if (title !== undefined) {
    if (!title || (typeof title === 'string' && !title.trim())) {
      throw new Error('Title cannot be empty.')
    }
    if (typeof title === 'string' && title.trim().length > 200) {
      throw new Error('Title is too long. Please keep it under 200 characters.')
    }
  }

  if (status !== undefined && status !== null && !VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`)
  }

  if (priority !== undefined && priority !== null && !VALID_PRIORITIES.includes(priority)) {
    throw new Error(`Invalid priority "${priority}". Must be one of: ${VALID_PRIORITIES.join(', ')}`)
  }

  if (intent !== undefined && intent !== null && !VALID_INTENTS.includes(intent)) {
    throw new Error(`Invalid intent "${intent}". Must be one of: ${VALID_INTENTS.join(', ')}`)
  }

  if (tags !== undefined && tags !== null && !Array.isArray(tags)) {
    throw new Error('Tags must be an array of strings')
  }

  if (Array.isArray(tags)) {
    if (tags.length > 20) {
      throw new Error('Too many tags. Maximum of 20 tags allowed.')
    }
    for (const tag of tags) {
      if (typeof tag !== 'string') throw new Error('Each tag must be a string.')
      if (tag.trim().length === 0) throw new Error('Tags cannot be empty strings.')
      if (tag.trim().length > 50) throw new Error(`Tag "${tag.trim().slice(0, 20)}..." is too long. Maximum 50 characters per tag.`)
    }
  }

  if (description !== undefined && description !== null && typeof description === 'string' && description.length > 2000) {
    throw new Error('Description is too long. Please keep it under 2000 characters.')
  }

  const sanitizedTags = Array.isArray(tags)
    ? [...new Set(tags.map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 0))]
    : undefined

  const updated = db.update(topics)
    .set({
      title: title !== undefined ? title : existing.title,
      description: description !== undefined ? description : existing.description,
      tags: sanitizedTags !== undefined ? JSON.stringify(sanitizedTags) : (tags === null ? null : existing.tags),
      status: status !== undefined ? status : existing.status,
      priority: priority !== undefined ? priority : existing.priority,
      intent: intent !== undefined ? intent : existing.intent,
      trigger: trigger !== undefined ? trigger : existing.trigger,
      referenceUrls: referenceUrls !== undefined ? JSON.stringify(referenceUrls) : existing.referenceUrls,
      contextItems: contextItems !== undefined ? JSON.stringify(contextItems) : existing.contextItems,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(topics.id, id), eq(topics.userId, LOCAL_USER_ID)))
    .returning()
    .get()

  scheduleSave()
  return updated
}

/**
 * Delete a topic and all cascading data. Returns info about what was deleted.
 */
export function deleteTopic(db: Db, id: string) {
  const existing = db.select().from(topics)
    .where(and(eq(topics.id, id), eq(topics.userId, LOCAL_USER_ID)))
    .get()

  if (!existing) {
    throw new Error('Topic not found')
  }

  // Count related data before deletion
  const relatedSessions = db.select().from(sessions).where(eq(sessions.topicId, id)).all()
  const sessionIds = relatedSessions.map((s: any) => s.id)

  let messageCount = 0
  let bookmarkCount = 0
  for (const sid of sessionIds) {
    messageCount += db.select().from(messages).where(eq(messages.sessionId, sid)).all().length
    bookmarkCount += db.select().from(bookmarks).where(eq(bookmarks.sessionId, sid)).all().length
  }

  const relatedNotes = db.select().from(notes).where(eq(notes.topicId, id)).all()
  const relatedInsights = db.select().from(insights).where(eq(insights.topicId, id)).all()
  const relatedConnections = db.select().from(topicConnections)
    .where(or(eq(topicConnections.sourceTopicId, id), eq(topicConnections.targetTopicId, id)))
    .all()
  const relatedConceptNodes = db.select().from(conceptNodes).where(eq(conceptNodes.topicId, id)).all()

  const cascaded = {
    sessions: relatedSessions.length,
    messages: messageCount,
    notes: relatedNotes.length,
    insights: relatedInsights.length,
    connections: relatedConnections.length,
    conceptNodes: relatedConceptNodes.length,
    bookmarks: bookmarkCount,
  }

  db.delete(topics).where(eq(topics.id, id)).run()

  scheduleSave()
  return {
    message: 'Topic deleted',
    topicId: id,
    topicTitle: existing.title,
    cascaded,
  }
}

// ============================================
// Presets
// ============================================

/**
 * Get available preset topics, grouped by category, with selection status.
 */
export function getPresetTopics(db: Db) {
  const existingPresets = db.select().from(topics)
    .where(and(eq(topics.userId, LOCAL_USER_ID), eq(topics.isPreset, true)))
    .all()

  const existingTitles = new Set(existingPresets.map((t: any) => t.title))

  const categories: Record<string, { label: string; presets: Array<typeof PRESET_TOPICS[number] & { alreadySelected: boolean }> }> = {
    identity: { label: 'Identity', presets: [] },
    skills: { label: 'Skills', presets: [] },
    experiences: { label: 'Experiences', presets: [] },
    perspectives: { label: 'Perspectives', presets: [] },
    goals: { label: 'Goals', presets: [] },
  }

  const presetsWithStatus = PRESET_TOPICS.map(preset => ({
    ...preset,
    alreadySelected: existingTitles.has(preset.title),
  }))

  for (const preset of presetsWithStatus) {
    if (categories[preset.category]) {
      categories[preset.category].presets.push(preset)
    }
  }

  return { presets: presetsWithStatus, categories }
}

/**
 * Create selected preset topics for the user. Skips duplicates.
 */
export function selectPresetTopics(db: Db, selectedTopics: string[]) {
  if (!selectedTopics || !Array.isArray(selectedTopics) || selectedTopics.length === 0) {
    throw new Error('Please select at least one topic')
  }

  const existingPresets = db.select().from(topics)
    .where(and(eq(topics.userId, LOCAL_USER_ID), eq(topics.isPreset, true)))
    .all()
  const existingTitles = new Set(existingPresets.map((t: any) => t.title))

  const createdTopics = []

  for (const selectedTitle of selectedTopics) {
    const presetDef = PRESET_TOPICS.find(p => p.title === selectedTitle)
    if (!presetDef) continue
    if (existingTitles.has(selectedTitle)) continue

    const topicId = crypto.randomUUID()
    const newTopic = db.insert(topics).values({
      id: topicId,
      userId: LOCAL_USER_ID,
      title: presetDef.title,
      description: presetDef.description,
      tags: JSON.stringify(presetDef.tags),
      status: 'backlog',
      priority: 'medium',
      intent: presetDef.intent,
      trigger: presetDef.suggestedQuestion,
      isPreset: true,
      presetCategory: presetDef.category,
    }).returning().get()

    createdTopics.push(newTopic)
  }

  scheduleSave()
  return {
    message: `Created ${createdTopics.length} preset topic(s)`,
    topics: createdTopics,
    count: createdTopics.length,
  }
}

// ============================================
// Suggestions
// ============================================

/**
 * Get AI-powered personalized topic suggestions, or preset fallbacks for cold start / no AI.
 */
export async function getTopicSuggestions(db: Db) {
  const userTopics = db.select().from(topics).where(eq(topics.userId, LOCAL_USER_ID)).all()
  const userRecord = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()

  const verifiedInsights = db.select({
    content: insights.content,
    topicId: insights.topicId,
    confidenceScore: insights.confidenceScore,
  }).from(insights).where(
    and(eq(insights.userId, LOCAL_USER_ID), eq(insights.verificationStatus, 'verified'))
  ).all()

  const insightsWithTopics = verifiedInsights.map((insight: any) => {
    const topic = userTopics.find((t: any) => t.id === insight.topicId)
    return {
      content: insight.content,
      topicTitle: topic?.title || 'Unknown Topic',
      confidenceScore: insight.confidenceScore || 50,
    }
  })

  // Cold start: if user has fewer than 3 topics or no verified insights, return presets only
  if (userTopics.length < 3 || verifiedInsights.length === 0) {
    const existingTitles = new Set(userTopics.map((t: any) => t.title.toLowerCase()))

    const coldStartSuggestions = PRESET_TOPICS
      .filter(p => !existingTitles.has(p.title.toLowerCase()))
      .slice(0, 5)
      .map(p => ({
        title: p.title,
        description: p.description,
        category: p.category,
        intent: p.intent,
        tags: p.tags,
        suggestedQuestion: p.suggestedQuestion,
        rationale: 'Recommended starter topic to build your personal knowledge base.',
        source: 'preset' as const,
      }))

    return {
      suggestions: coldStartSuggestions,
      source: 'preset' as const,
      message: 'Showing starter topic suggestions. Complete more sessions to unlock personalized AI suggestions.',
    }
  }

  // Check if AI is available
  if (!isAIAvailable()) {
    const existingTitles = new Set(userTopics.map((t: any) => t.title.toLowerCase()))
    const fallbackSuggestions = PRESET_TOPICS
      .filter(p => !existingTitles.has(p.title.toLowerCase()))
      .slice(0, 5)
      .map(p => ({
        title: p.title,
        description: p.description,
        category: p.category,
        intent: p.intent,
        tags: p.tags,
        suggestedQuestion: p.suggestedQuestion,
        rationale: 'Suggested based on common self-knowledge areas.',
        source: 'preset' as const,
      }))

    return {
      suggestions: fallbackSuggestions,
      source: 'preset' as const,
      message: 'AI suggestions are currently unavailable. Showing recommended topics.',
    }
  }

  // Get topic connections for cross-topic analysis
  const allConnections = db.select().from(topicConnections).all()
  const userConnections = allConnections
    .filter((c: any) => {
      const sourceMatch = userTopics.some((t: any) => t.id === c.sourceTopicId)
      const targetMatch = userTopics.some((t: any) => t.id === c.targetTopicId)
      return sourceMatch && targetMatch
    })
    .map((c: any) => {
      const sourceT = userTopics.find((t: any) => t.id === c.sourceTopicId)
      const targetT = userTopics.find((t: any) => t.id === c.targetTopicId)
      return {
        sourceTopic: sourceT?.title || 'Unknown',
        targetTopic: targetT?.title || 'Unknown',
        connectionType: c.connectionType,
      }
    })

  const suggestionContext: TopicSuggestionContext = {
    userName: userRecord?.name || '',
    occupation: userRecord?.occupation || '',
    existingTopics: userTopics.map((t: any) => ({
      title: t.title,
      status: t.status || 'backlog',
      tags: t.tags,
      intent: t.intent,
      presetCategory: t.presetCategory,
    })),
    verifiedInsights: insightsWithTopics,
    topicConnections: userConnections,
  }

  const aiSuggestions = await generatePersonalizedTopicSuggestions(suggestionContext)

  if (!aiSuggestions || aiSuggestions.length === 0) {
    const existingTitles = new Set(userTopics.map((t: any) => t.title.toLowerCase()))
    const fallbackSuggestions = PRESET_TOPICS
      .filter(p => !existingTitles.has(p.title.toLowerCase()))
      .slice(0, 5)
      .map(p => ({
        title: p.title,
        description: p.description,
        category: p.category,
        intent: p.intent,
        tags: p.tags,
        suggestedQuestion: p.suggestedQuestion,
        rationale: 'Suggested based on common self-knowledge areas.',
        source: 'preset' as const,
      }))

    return {
      suggestions: fallbackSuggestions,
      source: 'preset' as const,
      message: 'Could not generate personalized suggestions at this time. Showing recommended topics.',
    }
  }

  const existingTitles = new Set(userTopics.map((t: any) => t.title.toLowerCase()))
  const filteredSuggestions = aiSuggestions
    .filter(s => !existingTitles.has(s.title.toLowerCase()))
    .map(s => ({
      ...s,
      source: 'ai' as const,
    }))

  return {
    suggestions: filteredSuggestions,
    source: 'ai' as const,
    message: `Generated ${filteredSuggestions.length} personalized topic suggestions based on your ${verifiedInsights.length} verified insights across ${userTopics.length} topics.`,
  }
}

/**
 * Accept a topic suggestion (from AI or preset) and create it as a real topic.
 */
export function acceptTopicSuggestion(db: Db, data: {
  title: string
  description?: string | null
  category?: string | null
  intent?: string | null
  tags?: string[] | null
  suggestedQuestion?: string | null
}) {
  const { title, description, category, intent, tags, suggestedQuestion } = data

  if (!title || (typeof title === 'string' && !title.trim())) {
    throw new Error('Title is required')
  }

  const sanitizedTags = Array.isArray(tags)
    ? [...new Set(tags.map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 0))]
    : null

  const topicId = crypto.randomUUID()

  const newTopic = db.insert(topics).values({
    id: topicId,
    userId: LOCAL_USER_ID,
    title: title.trim(),
    description: description || null,
    tags: sanitizedTags ? JSON.stringify(sanitizedTags) : null,
    status: 'backlog',
    priority: 'medium',
    intent: intent || 'explore',
    trigger: suggestedQuestion || null,
    isPreset: false,
    presetCategory: category || null,
  }).returning().get()

  scheduleSave()
  return {
    topic: newTopic,
    message: `Created topic "${title.trim()}" from suggestion`,
  }
}

// ============================================
// Title Check (utility)
// ============================================

/**
 * Check if a topic with the given title already exists for the local user.
 */
export function checkTopicTitle(db: Db, title: string) {
  if (!title || !title.trim()) {
    throw new Error('Title is required')
  }

  const trimmedTitle = title.trim().toLowerCase()
  const userTopics = db.select().from(topics).where(eq(topics.userId, LOCAL_USER_ID)).all()
  const duplicates = userTopics.filter((t: any) => t.title.trim().toLowerCase() === trimmedTitle)

  return {
    exists: duplicates.length > 0,
    count: duplicates.length,
    existingTopics: duplicates.map((t: any) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      createdAt: t.createdAt,
    })),
  }
}

// ============================================
// Topic Connections
// ============================================

/**
 * Create cross-topic connections from a source topic.
 */
export function createTopicConnections(db: Db, sourceTopicId: string, connections: Array<{ targetTopicId: string; relevanceScore?: number }>) {
  const sourceTopic = db.select().from(topics)
    .where(and(eq(topics.id, sourceTopicId), eq(topics.userId, LOCAL_USER_ID)))
    .get()

  if (!sourceTopic) {
    throw new Error('Source topic not found')
  }

  if (!connections || !Array.isArray(connections) || connections.length === 0) {
    throw new Error('connections array is required')
  }

  const created = []
  for (const conn of connections) {
    const { targetTopicId, relevanceScore } = conn

    const targetTopic = db.select().from(topics)
      .where(and(eq(topics.id, targetTopicId), eq(topics.userId, LOCAL_USER_ID)))
      .get()

    if (!targetTopic) continue

    // Check for existing connection
    const existing = db.select().from(topicConnections).where(
      or(
        and(
          eq(topicConnections.sourceTopicId, sourceTopicId),
          eq(topicConnections.targetTopicId, targetTopicId)
        ),
        and(
          eq(topicConnections.sourceTopicId, targetTopicId),
          eq(topicConnections.targetTopicId, sourceTopicId)
        )
      )
    ).get()

    if (existing) continue

    const connectionId = crypto.randomUUID()
    const saved = db.insert(topicConnections).values({
      id: connectionId,
      sourceTopicId,
      targetTopicId,
      connectionType: 'multi_bucket',
      relevanceScore: Math.min(Math.max(relevanceScore || 0, 0), 100),
    }).returning().get()

    created.push({
      ...saved,
      targetTopicTitle: targetTopic.title,
    })
  }

  scheduleSave()
  return { connections: created, count: created.length }
}

export { PRESET_TOPICS }
