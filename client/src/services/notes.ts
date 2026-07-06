import { eq, and, desc, ne } from 'drizzle-orm'
import { scheduleSave } from '@/db/persistence'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { notes, sessions, topics, messages, insights, users } from '@/db/schema'
import {
  generateFullAnalysisAI,
  generateJsonContentAI,
  type DistillationContext,
} from './ai'
import { admitInsights, extractInsights, formatInterviewTranscript, type ExtractionContext } from './insightExtraction'
import { applyInsightEvidenceAttachments, fetchExistingInsightRefs, logAdmissionDrops } from './admissionPersistence'
type Db = any // Drizzle sql.js instance

// ============================================
// Distillation Generation Functions (fallback)
// ============================================

interface MessageData {
  role: string
  content: string
  isBookmarked?: boolean | number | null
}

const ALL_NOTE_FORMATS = ['full_analysis', 'brief_summary', 'decision_framework', 'json'] as const
const GENERATED_NOTE_FORMATS = ['full_analysis', 'json'] as const

function generateFullAnalysis(
  topicTitle: string,
  topicDescription: string | null,
  userMessages: MessageData[],
  assistantMessages: MessageData[]
): string {
  const userContent = userMessages.map(m => m.content).join('\n\n')

  const keyQuotes = userMessages
    .filter(m => m.content.length > 30)
    .slice(0, 5)
    .map(m => {
      const sentences = m.content.split(/[.!?]+/).filter(s => s.trim().length > 20)
      return sentences[0]?.trim() || m.content.substring(0, 150)
    })

  const allWords = userContent.toLowerCase().split(/\s+/)
  const meaningfulWords = allWords.filter(w => w.length > 5)
  const wordFreq: Record<string, number> = {}
  meaningfulWords.forEach(w => {
    const clean = w.replace(/[^a-z]/g, '')
    if (clean.length > 5) {
      wordFreq[clean] = (wordFreq[clean] || 0) + 1
    }
  })
  const topConcepts = Object.entries(wordFreq)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 8)
    .map(([word]) => word)

  let analysis = `# Full Analysis: ${topicTitle}\n\n`

  analysis += `## Context\n\n`
  analysis += `This analysis distills insights from an interview session about **${topicTitle}**`
  if (topicDescription) {
    analysis += ` — ${topicDescription}`
  }
  analysis += `.\n\n`
  analysis += `The session covered ${userMessages.length} user responses across ${userMessages.length + assistantMessages.length} total exchanges.\n\n`

  analysis += `## Core Principles\n\n`
  if (keyQuotes.length > 0) {
    analysis += `Based on the conversation, the following core principles emerged:\n\n`
    keyQuotes.slice(0, 3).forEach((quote, i) => {
      analysis += `${i + 1}. > "${quote}"\n\n`
    })
  } else {
    analysis += `Further exploration is needed to identify core principles in this area.\n\n`
  }

  analysis += `## Mental Models & Frameworks\n\n`
  if (topConcepts.length > 0) {
    analysis += `Key concepts that appeared frequently in the discussion:\n\n`
    topConcepts.forEach(concept => {
      analysis += `- **${concept}**: Referenced in the context of ${topicTitle}\n`
    })
    analysis += `\n`
  }

  const frameworkPatterns = userMessages
    .filter(m => m.content.includes('when') || m.content.includes('because') || m.content.includes('always') || m.content.includes('usually') || m.content.includes('tend to'))
    .slice(0, 3)

  if (frameworkPatterns.length > 0) {
    analysis += `Decision-making patterns observed:\n\n`
    frameworkPatterns.forEach(m => {
      const excerpt = m.content.substring(0, 200).trim()
      analysis += `- "${excerpt}${m.content.length > 200 ? '...' : ''}"\n`
    })
    analysis += `\n`
  }

  analysis += `## Key Examples\n\n`
  const exampleMessages = userMessages.filter(m =>
    m.content.includes('example') || m.content.includes('time when') ||
    m.content.includes('instance') || m.content.includes('remember') ||
    m.content.includes('experience') || m.content.length > 100
  ).slice(0, 3)

  if (exampleMessages.length > 0) {
    exampleMessages.forEach((m, i) => {
      const excerpt = m.content.substring(0, 300).trim()
      analysis += `### Example ${i + 1}\n`
      analysis += `> "${excerpt}${m.content.length > 300 ? '...' : ''}"\n\n`
    })
  } else {
    analysis += `No specific examples were shared during this session. Consider exploring concrete experiences in a follow-up session.\n\n`
  }

  analysis += `## Open Questions & Tensions\n\n`

  const uncertainMessages = userMessages.filter(m =>
    m.content.includes('not sure') || m.content.includes("don't know") ||
    m.content.includes('maybe') || m.content.includes('complicated') ||
    m.content.includes('but') || m.content.includes('however') ||
    m.content.includes('on the other hand') || m.content.includes('tension')
  ).slice(0, 3)

  if (uncertainMessages.length > 0) {
    analysis += `Areas of tension or uncertainty identified:\n\n`
    uncertainMessages.forEach(m => {
      const excerpt = m.content.substring(0, 200).trim()
      analysis += `- "${excerpt}${m.content.length > 200 ? '...' : ''}"\n`
    })
    analysis += `\n`
  }

  analysis += `### Questions for Further Exploration\n\n`
  analysis += `- How does this perspective on ${topicTitle} connect to other areas of life?\n`
  analysis += `- What would change if circumstances were different?\n`
  analysis += `- Are there counterexamples that challenge the principles identified above?\n`

  return analysis
}

function generateJsonContent(
  topicTitle: string,
  userMessages: MessageData[],
  assistantMessages: MessageData[]
): string {
  const principles = userMessages
    .filter(m => m.content.length > 50)
    .slice(0, 5)
    .map(m => {
      const sentences = m.content.split(/[.!?]+/).filter(s => s.trim().length > 15)
      return sentences[0]?.trim() || m.content.substring(0, 100).trim()
    })

  const frameworkMessages = userMessages.filter(m =>
    /\b(when|because|always|usually|tend to|approach|strategy|method|process|framework|model|pattern|rule|guideline)\b/i.test(m.content)
  )
  const frameworks = frameworkMessages
    .slice(0, 4)
    .map(m => {
      const sentences = m.content.split(/[.!?]+/).filter(s => s.trim().length > 15)
      return sentences[0]?.trim() || m.content.substring(0, 200).trim()
    })

  const examples = userMessages
    .filter(m => m.content.length > 100 ||
      /\b(example|instance|time when|remember|experience|once|story)\b/i.test(m.content))
    .slice(0, 3)
    .map(m => m.content.substring(0, 300).trim())

  const decisionMessages = userMessages.filter(m =>
    /\b(decide|decided|decision|chose|choose|choice|option|alternative|trade-?off|weigh|consider|prefer|priority|prioritize)\b/i.test(m.content)
  )
  const decisions = decisionMessages
    .slice(0, 4)
    .map(m => {
      const sentences = m.content.split(/[.!?]+/).filter(s => s.trim().length > 15)
      return sentences[0]?.trim() || m.content.substring(0, 200).trim()
    })

  const data = {
    topic: topicTitle,
    sessionDate: new Date().toISOString(),
    messageCount: userMessages.length + assistantMessages.length,
    userResponseCount: userMessages.length,
    principles,
    frameworks,
    examples,
    decisions,
    tags: extractTags(userMessages),
  }

  return JSON.stringify(data, null, 2)
}

function extractTags(userMessages: MessageData[]): string[] {
  const allText = userMessages.map(m => m.content).join(' ').toLowerCase()
  const tags: string[] = []

  const tagPatterns: [string, RegExp][] = [
    ['values', /value|believe|principle|important/i],
    ['experience', /experience|memory|remember|time when/i],
    ['decision-making', /decide|choice|decision|chose/i],
    ['growth', /learn|grow|change|develop/i],
    ['relationships', /relationship|people|friend|family|colleague/i],
    ['career', /work|job|career|professional/i],
    ['creativity', /creative|create|design|build|make/i],
    ['leadership', /lead|manage|team|guide/i],
    ['communication', /communicate|talk|express|write/i],
    ['goals', /goal|aim|target|aspire|want to/i],
  ]

  tagPatterns.forEach(([tag, pattern]) => {
    if (pattern.test(allText)) {
      tags.push(tag)
    }
  })

  return tags.slice(0, 6)
}

// ============================================
// Service Functions
// ============================================

/**
 * Distill a session into a note with AI-powered analysis.
 * Extracts insights and creates cross-topic suggestions.
 */
export async function distillSession(
  db: Db,
  sessionId: string,
  format: string = 'full_analysis'
) {
  const userId = LOCAL_USER_ID

  // Verify session belongs to user
  const session = db.select().from(sessions).where(
    and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  // Check if note already exists for this session
  const existingNote = db.select().from(notes).where(
    eq(notes.sessionId, sessionId)
  ).get()

  if (existingNote) {
    return { note: existingNote, alreadyExists: true }
  }

  // Get topic info
  const topic = db.select().from(topics).where(eq(topics.id, session.topicId)).get()

  if (!topic) {
    throw new Error('Topic not found')
  }

  // Get all messages for this session
  const sessionMessages = db.select().from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  if (sessionMessages.length < 2) {
    throw new Error('Session needs at least one exchange before distillation')
  }

  // Mark session as completed
  db.update(sessions).set({
    status: 'completed',
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, sessionId)).run()

  // Update topic status to extracted
  db.update(topics).set({
    status: 'extracted',
    updatedAt: new Date().toISOString(),
  }).where(eq(topics.id, session.topicId)).run()

  // Generate distillation in active formats (AI-powered with fallback).
  const userMsgs = sessionMessages.filter((m: any) => m.role === 'user')
  const assistantMsgs = sessionMessages.filter((m: any) => m.role === 'assistant')

  // Gather user profile context for richer AI prompts
  const userProfile = db.select().from(users).where(eq(users.id, userId)).get()
  const distillCtx: DistillationContext = {
    topicTitle: topic.title,
    topicDescription: topic.description,
    userMessages: userMsgs,
    assistantMessages: assistantMsgs,
    userName: userProfile?.name || undefined,
    occupation: userProfile?.occupation || undefined,
  }

  const [aiFullAnalysis, aiJsonContent] = await Promise.all([
    generateFullAnalysisAI(distillCtx).catch(() => null),
    generateJsonContentAI(distillCtx).catch(() => null),
  ])

  const fullAnalysis = aiFullAnalysis || generateFullAnalysis(topic.title, topic.description, userMsgs, assistantMsgs)
  const jsonContent = aiJsonContent || generateJsonContent(topic.title, userMsgs, assistantMsgs)

  // Create note
  const noteId = crypto.randomUUID()
  const selectedFormat = GENERATED_NOTE_FORMATS.includes(format as typeof GENERATED_NOTE_FORMATS[number])
    ? format
    : 'full_analysis'

  const newNote = db.insert(notes).values({
    id: noteId,
    sessionId,
    topicId: session.topicId,
    userId,
    title: `Session Notes: ${topic.title}`,
    contentFullAnalysis: fullAnalysis,
    contentJson: jsonContent,
    selectedFormat,
  }).returning().get()

  // Extract insights using the unified insight extraction service
  const existing = fetchExistingInsightRefs(db)
  const existingVerified = existing
    .filter(ref => ref.verificationStatus === 'verified')
    .map(ref => ({
      content: ref.content,
      confidenceScore: 50,
    }))

  const transcript = formatInterviewTranscript(userMsgs, assistantMsgs)
  const extractionCtx: ExtractionContext = {
    content: transcript,
    sourceType: 'interview',
    topicTitle: topic.title,
    topicDescription: topic.description || undefined,
    userName: userProfile?.name || undefined,
    occupation: userProfile?.occupation || undefined,
    existingVerifiedInsights: existingVerified,
  }

  const extractedInsights = await extractInsights(extractionCtx)
  const admission = admitInsights(extractedInsights, existing, `session:${sessionId}`)
  applyInsightEvidenceAttachments(db, admission.attach)
  logAdmissionDrops(admission.drop)
  const savedInsights = []

  for (const insight of admission.admit) {
    const insightId = crypto.randomUUID()
    const saved = db.insert(insights).values({
      id: insightId,
      noteId,
      topicId: session.topicId,
      userId,
      content: insight.content,
      confidenceScore: insight.confidenceScore,
      extractionMethod: insight.extractionMethod || 'ai',
      verificationStatus: 'unverified',
      sourceSessionId: sessionId,
      evidenceCount: insight.evidenceCount,
      evidenceSources: insight.evidenceSources.length > 0 ? JSON.stringify(insight.evidenceSources) : null,
    }).returning().get()
    savedInsights.push(saved)
  }

  // Multi-bucket cross-topic extraction: score relevance to other topics
  const otherTopics = db.select().from(topics).where(
    and(eq(topics.userId, userId), ne(topics.id, session.topicId))
  ).all()

  const suggestedConnections: Array<{ targetTopicId: string; topicTitle: string; relevanceScore: number }> = []

  if (otherTopics.length > 0) {
    const contentSummary = userMsgs
      .map((m: any) => m.content)
      .join(' ')
      .toLowerCase()

    const contentWords = contentSummary
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w: string) => w.length > 3)

    const stopWords = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'they', 'will', 'would', 'could', 'should', 'what', 'when', 'where', 'which', 'their', 'about', 'more', 'some', 'very', 'just', 'also', 'than', 'them', 'into', 'most', 'only', 'your', 'like', 'then', 'make', 'over', 'such', 'much', 'know', 'think', 'really', 'things', 'because', 'something'])
    const meaningfulWords = contentWords.filter((w: string) => !stopWords.has(w))

    const wordFreqMap = new Map<string, number>()
    for (const w of meaningfulWords) {
      wordFreqMap.set(w, (wordFreqMap.get(w) || 0) + 1)
    }

    const topKeywords = [...wordFreqMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word)

    for (const otherTopic of otherTopics) {
      const topicText = `${otherTopic.title} ${otherTopic.description || ''}`.toLowerCase()
      let topicTags: string[] = []
      if (otherTopic.tags) {
        try {
          let parsed = JSON.parse(otherTopic.tags as string)
          if (typeof parsed === 'string') parsed = JSON.parse(parsed)
          topicTags = Array.isArray(parsed) ? parsed : []
        } catch { topicTags = [] }
      }
      const topicTagsLower = topicTags.map((t: string) => t.toLowerCase())

      let score = 0

      for (const keyword of topKeywords) {
        if (topicText.includes(keyword)) {
          score += 5
        }
      }

      for (const tag of topicTagsLower) {
        if (contentSummary.includes(tag)) {
          score += 10
        }
        for (const keyword of topKeywords) {
          if (tag.includes(keyword) || keyword.includes(tag)) {
            score += 8
          }
        }
      }

      const titleWords = topicText.split(/\s+/).filter((w: string) => w.length > 3 && !stopWords.has(w))
      for (const tw of titleWords) {
        if (contentSummary.includes(tw)) {
          score += 7
        }
      }

      score = Math.min(score, 100)

      if (score >= 15) {
        suggestedConnections.push({
          targetTopicId: otherTopic.id,
          topicTitle: otherTopic.title,
          relevanceScore: score,
        })
      }
    }

    suggestedConnections.sort((a, b) => b.relevanceScore - a.relevanceScore)
  }

  // Return the updated session too
  const updatedSession = db.select().from(sessions).where(eq(sessions.id, sessionId)).get()

  scheduleSave()

  return {
    note: newNote,
    insights: savedInsights,
    session: updatedSession,
    suggestedConnections,
  }
}

/**
 * Regenerate note content in a specific format.
 */
export async function regenerateNote(
  db: Db,
  sessionId: string,
  format: string,
  regenerateContent: boolean = false
) {
  const userId = LOCAL_USER_ID

  if (!format || !ALL_NOTE_FORMATS.includes(format as typeof ALL_NOTE_FORMATS[number])) {
    throw new Error('Invalid format. Must be: full_analysis, brief_summary, decision_framework, or json')
  }

  if (regenerateContent && !GENERATED_NOTE_FORMATS.includes(format as typeof GENERATED_NOTE_FORMATS[number])) {
    throw new Error('Regeneration is only available for Full Analysis and JSON formats')
  }

  // Find existing note
  const note = db.select().from(notes).where(
    and(eq(notes.sessionId, sessionId), eq(notes.userId, userId))
  ).get()

  if (!note) {
    throw new Error('Note not found. Distill session first.')
  }

  // If regenerateContent is true, regenerate the specific format from session messages
  if (regenerateContent) {
    const session = db.select().from(sessions).where(
      and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
    ).get()

    if (!session) {
      throw new Error('Session not found')
    }

    const topic = db.select().from(topics).where(eq(topics.id, session.topicId)).get()
    if (!topic) {
      throw new Error('Topic not found')
    }

    const sessionMessages = db.select().from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all()

    const userMsgs = sessionMessages.filter((m: any) => m.role === 'user')
    const assistantMsgs = sessionMessages.filter((m: any) => m.role === 'assistant')

    const regenUserProfile = db.select().from(users).where(eq(users.id, userId)).get()
    const regenCtx: DistillationContext = {
      topicTitle: topic.title,
      topicDescription: topic.description,
      userMessages: userMsgs,
      assistantMessages: assistantMsgs,
      userName: regenUserProfile?.name || undefined,
      occupation: regenUserProfile?.occupation || undefined,
    }

    const updateData: Record<string, string> = {
      selectedFormat: format,
      updatedAt: new Date().toISOString(),
    }

    switch (format) {
      case 'full_analysis': {
        const aiResult = await generateFullAnalysisAI(regenCtx).catch(() => null)
        updateData.contentFullAnalysis = aiResult || generateFullAnalysis(topic.title, topic.description, userMsgs, assistantMsgs)
        break
      }
      case 'json': {
        const aiResult = await generateJsonContentAI(regenCtx).catch(() => null)
        updateData.contentJson = aiResult || generateJsonContent(topic.title, userMsgs, assistantMsgs)
        break
      }
    }

    const updated = db.update(notes).set(updateData).where(eq(notes.id, note.id)).returning().get()
    scheduleSave()
    return { note: updated, regenerated: true }
  }

  // Just update selected format (no content regeneration)
  const updated = db.update(notes).set({
    selectedFormat: format,
    updatedAt: new Date().toISOString(),
  }).where(eq(notes.id, note.id)).returning().get()

  scheduleSave()
  return { note: updated }
}

/**
 * Get all notes for the local user, enriched with topic titles.
 */
export function getNotes(db: Db) {
  const userId = LOCAL_USER_ID

  const userNotes = db.select().from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.createdAt))
    .all()

  const enrichedNotes = userNotes.map((n: any) => {
    const topic = n.topicId ? db.select().from(topics).where(eq(topics.id, n.topicId)).get() : null
    return {
      ...n,
      topicTitle: topic?.title || 'Unknown Topic',
    }
  })

  return { notes: enrichedNotes }
}

/**
 * Get a specific note by ID with related insights.
 */
export function getNote(db: Db, id: string) {
  const userId = LOCAL_USER_ID

  const note = db.select().from(notes).where(
    and(eq(notes.id, id), eq(notes.userId, userId))
  ).get()

  if (!note) {
    throw new Error('Note not found')
  }

  const noteInsights = db.select().from(insights)
    .where(eq(insights.noteId, id))
    .all()

  return { note, insights: noteInsights }
}

/**
 * Get note for a specific session with related insights.
 */
export function getNoteForSession(db: Db, sessionId: string) {
  const userId = LOCAL_USER_ID

  const note = db.select().from(notes).where(
    and(eq(notes.sessionId, sessionId), eq(notes.userId, userId))
  ).get()

  if (!note) {
    throw new Error('No note found for this session')
  }

  const noteInsights = db.select().from(insights)
    .where(eq(insights.noteId, note.id))
    .all()

  return { note, insights: noteInsights }
}

/**
 * Update a note's content and/or format.
 */
export function updateNote(
  db: Db,
  id: string,
  data: {
    contentFullAnalysis?: string
    contentBriefSummary?: string
    contentDecisionFramework?: string
    contentJson?: string
    selectedFormat?: string
    title?: string
  }
) {
  const userId = LOCAL_USER_ID

  const note = db.select().from(notes).where(
    and(eq(notes.id, id), eq(notes.userId, userId))
  ).get()

  if (!note) {
    throw new Error('Note not found')
  }

  const updated = db.update(notes).set({
    contentFullAnalysis: data.contentFullAnalysis !== undefined ? data.contentFullAnalysis : note.contentFullAnalysis,
    contentBriefSummary: data.contentBriefSummary !== undefined ? data.contentBriefSummary : note.contentBriefSummary,
    contentDecisionFramework: data.contentDecisionFramework !== undefined ? data.contentDecisionFramework : note.contentDecisionFramework,
    contentJson: data.contentJson !== undefined ? data.contentJson : note.contentJson,
    selectedFormat: data.selectedFormat !== undefined ? data.selectedFormat : note.selectedFormat,
    title: data.title !== undefined ? data.title : note.title,
    updatedAt: new Date().toISOString(),
  }).where(eq(notes.id, id)).returning().get()

  scheduleSave()
  return { note: updated }
}
