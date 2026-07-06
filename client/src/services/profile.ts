/**
 * Profile Export Service
 * ======================
 * Ported from server/src/routes/profile.ts
 * Generates profile summaries and exports (markdown, JSON) from verified insights.
 */

import { eq, and, desc, count } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import {
  insights,
  topics,
  users,
  notes,
  sessions,
  messages,
  topicConnections,
  importedFiles,
  assessmentAttempts,
  assessmentResults,
} from '@/db/schema'
import { LOCAL_USER_ID } from '@/contexts/UserContext'

type Db = SQLJsDatabase<typeof schema>

// ============================================
// Big Five Personality Constants & Helpers
// ============================================

const BIG_FIVE_DOMAIN_LABELS: Record<string, string> = {
  N: 'Neuroticism',
  E: 'Extraversion',
  O: 'Openness to Experience',
  A: 'Agreeableness',
  C: 'Conscientiousness',
}

const BIG_FIVE_FACET_LABELS: Record<string, string[]> = {
  N: ['Anxiety', 'Anger', 'Depression', 'Self-Consciousness', 'Immoderation', 'Vulnerability'],
  E: ['Friendliness', 'Gregariousness', 'Assertiveness', 'Activity Level', 'Excitement-Seeking', 'Cheerfulness'],
  O: ['Imagination', 'Artistic Interests', 'Emotionality', 'Adventurousness', 'Intellect', 'Liberalism'],
  A: ['Trust', 'Morality', 'Altruism', 'Cooperation', 'Modesty', 'Sympathy'],
  C: ['Self-Efficacy', 'Orderliness', 'Dutifulness', 'Achievement-Striving', 'Self-Discipline', 'Cautiousness'],
}

function normalizeTo5(rawScore: number, questionCount: number): number {
  if (questionCount <= 0) return rawScore
  return Math.round((rawScore / questionCount) * 100) / 100
}

function getScoreLevel(normalizedScore: number): string {
  if (normalizedScore >= 4) return 'High'
  if (normalizedScore >= 3.5) return 'Above Average'
  if (normalizedScore >= 2.5) return 'Average'
  if (normalizedScore >= 2) return 'Below Average'
  return 'Low'
}

// ============================================
// Insight categorization
// ============================================

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  personalPortrait: [
    'value', 'believe', 'belief', 'core', 'trait', 'identity', 'principle',
    'important to me', 'who i am', 'personality', 'character', 'define',
    'fundamental', 'deeply', 'always', 'never', 'matter', 'care about',
    'passionate', 'driven', 'motivated', 'philosophy', 'worldview',
    'perspective', 'conviction', 'authentic', 'integrity', 'moral',
  ],
  communicationStyle: [
    'communicate', 'communication', 'speak', 'talk', 'write', 'writing',
    'email', 'conversation', 'express', 'tone', 'language', 'word',
    'listen', 'feedback', 'direct', 'indirect', 'formal', 'informal',
    'prefer to say', 'way i', 'style', 'approach to', 'respond',
    'message', 'clarity', 'concise', 'verbose', 'articulate',
  ],
  decisionMakingPatterns: [
    'decide', 'decision', 'choose', 'choice', 'evaluate', 'weigh',
    'consider', 'prioritize', 'priority', 'trade-off', 'tradeoff',
    'framework', 'criteria', 'factor', 'process', 'approach',
    'strategy', 'analyze', 'analysis', 'risk', 'opportunity',
    'gut feeling', 'intuition', 'data-driven', 'rational', 'logic',
  ],
  strengthsAndExpertise: [
    'strength', 'strong', 'expert', 'expertise', 'skill', 'skilled',
    'good at', 'excel', 'talent', 'ability', 'capable', 'competent',
    'proficient', 'experience', 'knowledge', 'know how', 'specialize',
    'professional', 'craft', 'master', 'accomplish', 'achievement',
    'excel at', 'best at', 'naturally', 'gifted',
  ],
  toneOfVoice: [
    'tone', 'voice', 'humor', 'humour', 'sarcasm', 'sarcastic',
    'serious', 'casual', 'formal', 'warm', 'cold', 'empathetic',
    'blunt', 'diplomatic', 'friendly', 'reserved', 'enthusiastic',
    'calm', 'passionate', 'measured', 'emotional', 'detached',
    'witty', 'dry', 'encouraging', 'supportive', 'critical',
  ],
}

function safeParseJsonArray(value: string | null): unknown[] {
  if (!value) return []
  try {
    let parsed = JSON.parse(value)
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function categorizeInsight(content: string, topicTitle: string): string[] {
  const combined = `${content.toLowerCase()} ${topicTitle.toLowerCase()}`
  const categories: string[] = []
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.filter(kw => combined.includes(kw)).length >= 1) {
      categories.push(category)
    }
  }
  if (categories.length === 0) categories.push('personalPortrait')
  return categories
}

// ============================================
// Profile section types
// ============================================

interface ProfileSection {
  title: string
  content: string[]
  topicSources: string[]
}

interface ProfileSummary {
  userName: string
  occupation: string
  location: string
  generatedAt: string
  totalVerifiedInsights: number
  topicsExplored: number
  sections: {
    personalPortrait: ProfileSection
    communicationStyle: ProfileSection
    decisionMakingPatterns: ProfileSection
    strengthsAndExpertise: ProfileSection
    toneOfVoice: ProfileSection
    keyThemes: ProfileSection
  }
}

function buildProfileSummary(
  user: { name: string | null; occupation: string | null; location: string | null },
  verifiedInsights: Array<{ content: string; topicTitle: string | null; confidenceScore: number | null }>,
  topicCount: number,
): ProfileSummary {
  const sectionData: Record<string, { content: string[]; topicSources: Set<string> }> = {
    personalPortrait: { content: [], topicSources: new Set() },
    communicationStyle: { content: [], topicSources: new Set() },
    decisionMakingPatterns: { content: [], topicSources: new Set() },
    strengthsAndExpertise: { content: [], topicSources: new Set() },
    toneOfVoice: { content: [], topicSources: new Set() },
    keyThemes: { content: [], topicSources: new Set() },
  }

  for (const insight of verifiedInsights) {
    const topicTitle = insight.topicTitle || 'General'
    const categories = categorizeInsight(insight.content, topicTitle)
    for (const category of categories) {
      if (sectionData[category]) {
        sectionData[category].content.push(insight.content)
        sectionData[category].topicSources.add(topicTitle)
      }
    }
  }

  const topicInsightCounts: Record<string, number> = {}
  for (const insight of verifiedInsights) {
    const t = insight.topicTitle || 'General'
    topicInsightCounts[t] = (topicInsightCounts[t] || 0) + 1
  }

  sectionData.keyThemes.content = Object.entries(topicInsightCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([topic, cnt]) => `${topic} (${cnt} verified insight${cnt > 1 ? 's' : ''})`)
  sectionData.keyThemes.topicSources = new Set(Object.keys(topicInsightCounts))

  const makeSectionObj = (key: string, title: string): ProfileSection => ({
    title,
    content: sectionData[key].content,
    topicSources: Array.from(sectionData[key].topicSources),
  })

  return {
    userName: user.name || 'User',
    occupation: user.occupation || '',
    location: user.location || '',
    generatedAt: new Date().toISOString(),
    totalVerifiedInsights: verifiedInsights.length,
    topicsExplored: topicCount,
    sections: {
      personalPortrait: makeSectionObj('personalPortrait', 'Personal Portrait'),
      communicationStyle: makeSectionObj('communicationStyle', 'Communication Style'),
      decisionMakingPatterns: makeSectionObj('decisionMakingPatterns', 'Decision-Making Patterns'),
      strengthsAndExpertise: makeSectionObj('strengthsAndExpertise', 'Strengths & Expertise'),
      toneOfVoice: makeSectionObj('toneOfVoice', 'Tone of Voice'),
      keyThemes: makeSectionObj('keyThemes', 'Key Themes & Connections'),
    },
  }
}

// ============================================
// Markdown generation
// ============================================

function generateMarkdown(summary: ProfileSummary): string {
  const lines: string[] = []
  lines.push(`# ${summary.userName}'s me.md`)
  lines.push('')
  lines.push(`> Auto-generated personal context profile`)
  lines.push(`> Generated: ${new Date(summary.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`)
  lines.push(`> ${summary.totalVerifiedInsights} verified insights across ${summary.topicsExplored} topics`)
  lines.push('')
  lines.push('---')
  lines.push('')

  const renderSection = (section: ProfileSection, extra?: string) => {
    lines.push(`## ${section.title}`)
    lines.push('')
    if (section.content.length > 0) {
      if (extra) { lines.push(extra); lines.push('') }
      for (const item of section.content) lines.push(`- ${item}`)
      if (section.topicSources.length > 0) {
        lines.push('')
        lines.push(`*Sources: ${section.topicSources.join(', ')}*`)
      }
    } else {
      lines.push(`*No verified insights in this category yet.*`)
    }
    lines.push('')
  }

  renderSection(summary.sections.personalPortrait, `*${summary.occupation} based in ${summary.location}*`)
  renderSection(summary.sections.communicationStyle)
  renderSection(summary.sections.decisionMakingPatterns)
  renderSection(summary.sections.strengthsAndExpertise)
  renderSection(summary.sections.toneOfVoice)

  // Key Themes
  const themes = summary.sections.keyThemes
  lines.push(`## ${themes.title}`)
  lines.push('')
  if (themes.content.length > 0) {
    for (const item of themes.content) lines.push(`- ${item}`)
  } else {
    lines.push('*No themes identified yet.*')
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('*This profile was generated by [me.md](https://memd.app) — your personal knowledge system for AI.*')
  lines.push('')

  return lines.join('\n')
}

// ============================================
// Personality export data
// ============================================

export interface PersonalityExportData {
  hasAssessment: boolean
  latestAttempt: { attemptId: string; completedAt: string | null } | null
  domainScores: Array<{
    domain: string
    domainLabel: string
    score: number
    level: string
    facets: Array<{ name: string; score: number; level: string }>
  }>
  verifiedInsights: Array<{ content: string; confidence: number; category: string }>
  changeTrends: Array<{
    attemptId: string
    completedAt: string | null
    domainScores: Array<{ domain: string; domainLabel: string; score: number }>
  }>
  privacyTier: string
}

export function getPersonalityExportData(db: Db, privacyFilter: 'exportable' | 'all' = 'exportable'): PersonalityExportData {
  const completedAttempts = db.select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.userId, LOCAL_USER_ID), eq(assessmentAttempts.status, 'completed')))
    .orderBy(desc(assessmentAttempts.completedAt))
    .all()

  if (completedAttempts.length === 0) {
    return { hasAssessment: false, latestAttempt: null, domainScores: [], verifiedInsights: [], changeTrends: [], privacyTier: privacyFilter }
  }

  const latestAttempt = completedAttempts[0]
  const latestResults = db.select().from(assessmentResults).where(eq(assessmentResults.attemptId, latestAttempt.id)).all()

  const DOMAIN_QUESTION_COUNT = 24
  const FACET_QUESTION_COUNT = 4

  const domainScores = latestResults.map(r => {
    const facetLabels = BIG_FIVE_FACET_LABELS[r.domain] || []
    const facetScoreValues = [r.facet1Score, r.facet2Score, r.facet3Score, r.facet4Score, r.facet5Score, r.facet6Score]
    const facets = facetScoreValues
      .map((fScore, i) => {
        if (fScore === null || fScore === undefined) return null
        const normalized = normalizeTo5(fScore, FACET_QUESTION_COUNT)
        return { name: facetLabels[i] || `Facet ${i + 1}`, score: normalized, level: getScoreLevel(normalized) }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)

    const normalizedDomain = normalizeTo5(r.domainScore, DOMAIN_QUESTION_COUNT)
    return {
      domain: r.domain,
      domainLabel: BIG_FIVE_DOMAIN_LABELS[r.domain] || r.domain,
      score: normalizedDomain,
      level: getScoreLevel(normalizedDomain),
      facets,
    }
  })

  // Verified personality insights
  const assessmentTopic = db.select().from(topics)
    .where(and(eq(topics.userId, LOCAL_USER_ID), eq(topics.title, 'Big Five Personality Assessment')))
    .get()

  let verifiedInsights: Array<{ content: string; confidence: number; category: string }> = []
  if (assessmentTopic) {
    const insightFilter = privacyFilter === 'exportable'
      ? and(eq(insights.topicId, assessmentTopic.id), eq(insights.userId, LOCAL_USER_ID), eq(insights.verificationStatus, 'verified'), eq(insights.privacyTier, 'exportable'))
      : and(eq(insights.topicId, assessmentTopic.id), eq(insights.userId, LOCAL_USER_ID), eq(insights.verificationStatus, 'verified'))

    verifiedInsights = db.select({ content: insights.content, confidenceScore: insights.confidenceScore })
      .from(insights)
      .where(insightFilter)
      .orderBy(desc(insights.confidenceScore))
      .all()
      .map(i => ({ content: i.content, confidence: i.confidenceScore ?? 50, category: 'personality' }))
  }

  const changeTrends = completedAttempts.map(attempt => {
    const results = db.select().from(assessmentResults).where(eq(assessmentResults.attemptId, attempt.id)).all()
    return {
      attemptId: attempt.id,
      completedAt: attempt.completedAt,
      domainScores: results.map(r => ({
        domain: r.domain,
        domainLabel: BIG_FIVE_DOMAIN_LABELS[r.domain] || r.domain,
        score: normalizeTo5(r.domainScore, DOMAIN_QUESTION_COUNT),
      })),
    }
  })

  return {
    hasAssessment: true,
    latestAttempt: { attemptId: latestAttempt.id, completedAt: latestAttempt.completedAt },
    domainScores,
    verifiedInsights,
    changeTrends: changeTrends.length > 1 ? changeTrends : [],
    privacyTier: privacyFilter,
  }
}

/** One compact line, e.g. "Openness 3.8 (Above Average), Conscientiousness 4.1 (High), ...".
 *  Returns null when no completed assessment exists. */
export function getBigFiveSummaryLine(db: Db): string | null {
  const data = getPersonalityExportData(db, 'all')
  if (!data.hasAssessment || data.domainScores.length === 0) return null
  return data.domainScores
    .map(d => `${d.domainLabel} ${d.score.toFixed(1)} (${d.level})`)
    .join(', ')
}

export function generatePersonalityMarkdown(data: PersonalityExportData): string {
  if (!data.hasAssessment) return ''
  const lines: string[] = []
  lines.push('## Personality Profile (Big Five)')
  lines.push('')
  lines.push('*Based on the IPIP NEO-PI-R 120-item assessment*')
  if (data.latestAttempt?.completedAt) {
    lines.push(`*Latest assessment: ${new Date(data.latestAttempt.completedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}*`)
  }
  lines.push('')

  for (const domain of data.domainScores) {
    lines.push(`### ${domain.domainLabel}`)
    lines.push(`**Score: ${domain.score.toFixed(2)}/5 (${domain.level})**`)
    lines.push('')
    if (domain.facets.length > 0) {
      lines.push('| Facet | Score | Level |')
      lines.push('|-------|-------|-------|')
      for (const facet of domain.facets) {
        lines.push(`| ${facet.name} | ${facet.score.toFixed(2)} | ${facet.level} |`)
      }
      lines.push('')
    }
  }

  if (data.verifiedInsights.length > 0) {
    lines.push('### Verified Personality Insights')
    lines.push('')
    for (const insight of data.verifiedInsights) {
      lines.push(`- ${insight.content} *(confidence: ${insight.confidence}%)*`)
    }
    lines.push('')
  }

  if (data.changeTrends.length > 1) {
    lines.push('### Personality Change Trends')
    lines.push('')
    lines.push('| Date | ' + Object.keys(BIG_FIVE_DOMAIN_LABELS).map(d => BIG_FIVE_DOMAIN_LABELS[d]).join(' | ') + ' |')
    lines.push('|------|' + Object.keys(BIG_FIVE_DOMAIN_LABELS).map(() => '---').join('|') + '|')
    for (const trend of data.changeTrends) {
      const date = trend.completedAt ? new Date(trend.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'
      const scoreMap: Record<string, number> = {}
      for (const ds of trend.domainScores) scoreMap[ds.domain] = ds.score
      lines.push(`| ${date} | ${Object.keys(BIG_FIVE_DOMAIN_LABELS).map(d => (scoreMap[d] ?? 0).toFixed(2)).join(' | ')} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ============================================
// Helpers for fetching verified insights
// ============================================

function getVerifiedExportableInsights(db: Db) {
  return db.select({
    content: insights.content,
    topicTitle: topics.title,
    confidenceScore: insights.confidenceScore,
    privacyTier: insights.privacyTier,
  }).from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(and(eq(insights.userId, LOCAL_USER_ID), eq(insights.verificationStatus, 'verified'), eq(insights.privacyTier, 'exportable')))
    .orderBy(desc(insights.confidenceScore))
    .all()
}

// ============================================
// Public API
// ============================================

export function getExportStatus(db: Db) {
  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  const verifiedInsightsArr = db.select({ content: insights.content })
    .from(insights)
    .where(and(eq(insights.userId, LOCAL_USER_ID), eq(insights.verificationStatus, 'verified'), eq(insights.privacyTier, 'exportable')))
    .all()

  const topicCount = db.select().from(topics).where(eq(topics.userId, LOCAL_USER_ID)).all().length

  return {
    hasVerifiedData: verifiedInsightsArr.length > 0,
    verifiedInsightCount: verifiedInsightsArr.length,
    topicCount,
  }
}

export function getProfileSummary(db: Db) {
  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  const verifiedInsights = getVerifiedExportableInsights(db)
  const userTopics = db.select().from(topics).where(eq(topics.userId, LOCAL_USER_ID)).all()

  return { summary: buildProfileSummary(user, verifiedInsights, userTopics.length) }
}

export function regenerateProfile(db: Db) {
  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  const verifiedInsights = getVerifiedExportableInsights(db)
  const userTopics = db.select().from(topics).where(eq(topics.userId, LOCAL_USER_ID)).all()

  return {
    summary: buildProfileSummary(user, verifiedInsights, userTopics.length),
    message: 'Profile summary regenerated successfully',
  }
}

export function exportAsMarkdown(db: Db): string {
  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  const verifiedInsights = getVerifiedExportableInsights(db)
  const userTopics = db.select().from(topics).where(eq(topics.userId, LOCAL_USER_ID)).all()

  const summary = buildProfileSummary(user, verifiedInsights, userTopics.length)

  // Get imported sources
  const userImports = db.select({
    filename: importedFiles.filename,
    fileType: importedFiles.fileType,
    processedContent: importedFiles.processedContent,
  }).from(importedFiles).where(eq(importedFiles.userId, LOCAL_USER_ID)).all()

  const importSourcesList = userImports.map(imp => {
    let content: Record<string, unknown> = {}
    try { if (imp.processedContent) content = JSON.parse(imp.processedContent) } catch { /* empty */ }
    return {
      title: (content.title as string) || imp.filename,
      type: imp.fileType,
      isProcessed: content.processingStatus === 'processed',
      insightCount: (content.processedInsightCount as number) || 0,
    }
  })

  let markdown = generateMarkdown(summary)

  const personalityData = getPersonalityExportData(db, 'exportable')
  if (personalityData.hasAssessment) {
    markdown += '\n' + generatePersonalityMarkdown(personalityData)
  }

  if (importSourcesList.length > 0) {
    markdown += '\n## Imported Sources\n\n'
    markdown += '*The following external sources were imported and processed to extract insights:*\n\n'
    for (const source of importSourcesList) {
      const typeLabel = source.type === 'chatgpt' ? 'ChatGPT Memory' : source.type === 'url' ? 'URL' : source.type === 'text' ? 'Text' : 'File'
      const processedLabel = source.isProcessed ? ` (${source.insightCount} insights extracted)` : ' (not yet processed)'
      markdown += `- **${source.title}** — ${typeLabel}${processedLabel}\n`
    }
    markdown += '\n'
  }

  return markdown
}

export function exportAsJson(db: Db) {
  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  const verifiedInsightsForSummary = getVerifiedExportableInsights(db)

  // Full metadata insights
  const verifiedInsightsFull = db.select({
    id: insights.id,
    content: insights.content,
    confidenceScore: insights.confidenceScore,
    verificationStatus: insights.verificationStatus,
    agreementScore: insights.agreementScore,
    privacyTier: insights.privacyTier,
    topicId: insights.topicId,
    noteId: insights.noteId,
    sourceSessionId: insights.sourceSessionId,
    verifiedAt: insights.verifiedAt,
    reVerifyAt: insights.reVerifyAt,
    reVerifyInterval: insights.reVerifyInterval,
    createdAt: insights.createdAt,
    updatedAt: insights.updatedAt,
    topicTitle: topics.title,
  }).from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(and(eq(insights.userId, LOCAL_USER_ID), eq(insights.verificationStatus, 'verified'), eq(insights.privacyTier, 'exportable')))
    .orderBy(desc(insights.confidenceScore))
    .all()

  const userTopics = db.select().from(topics).where(eq(topics.userId, LOCAL_USER_ID)).all()
  const topicsWithParsedFields = userTopics.map(t => ({
    ...t,
    tags: safeParseJsonArray(t.tags),
    referenceUrls: safeParseJsonArray(t.referenceUrls),
    contextItems: safeParseJsonArray(t.contextItems),
  }))

  const topicIds = userTopics.map(t => t.id)
  let connections: Array<typeof topicConnections.$inferSelect> = []
  if (topicIds.length > 0) {
    const allConnections = db.select().from(topicConnections).all()
    connections = allConnections.filter(c => topicIds.includes(c.sourceTopicId) || topicIds.includes(c.targetTopicId))
  }

  const summary = buildProfileSummary(user, verifiedInsightsForSummary, userTopics.length)

  // Notes
  const userNotes = db.select({
    id: notes.id,
    sessionId: notes.sessionId,
    topicId: notes.topicId,
    title: notes.title,
    contentFullAnalysis: notes.contentFullAnalysis,
    contentBriefSummary: notes.contentBriefSummary,
    contentDecisionFramework: notes.contentDecisionFramework,
    contentJson: notes.contentJson,
    selectedFormat: notes.selectedFormat,
    createdAt: notes.createdAt,
    updatedAt: notes.updatedAt,
    topicTitle: topics.title,
  }).from(notes)
    .leftJoin(topics, eq(notes.topicId, topics.id))
    .where(eq(notes.userId, LOCAL_USER_ID))
    .orderBy(desc(notes.createdAt))
    .all()

  const notesForExport = userNotes.map(n => {
    let parsedContentJson: unknown = null
    if (n.contentJson) {
      try {
        let parsed = JSON.parse(n.contentJson)
        if (typeof parsed === 'string') parsed = JSON.parse(parsed)
        parsedContentJson = parsed
      } catch { /* empty */ }
    }
    return { ...n, contentJson: parsedContentJson }
  })

  // Sessions
  const userSessions = db.select({
    id: sessions.id,
    topicId: sessions.topicId,
    status: sessions.status,
    isMiniSession: sessions.isMiniSession,
    suggestedDurationMinutes: sessions.suggestedDurationMinutes,
    timeSpentSeconds: sessions.timeSpentSeconds,
    createdAt: sessions.createdAt,
    updatedAt: sessions.updatedAt,
    completedAt: sessions.completedAt,
    topicTitle: topics.title,
  }).from(sessions)
    .leftJoin(topics, eq(sessions.topicId, topics.id))
    .where(eq(sessions.userId, LOCAL_USER_ID))
    .orderBy(desc(sessions.createdAt))
    .all()

  const sessionMessageCounts: Record<string, number> = {}
  if (userSessions.length > 0) {
    const allMsgCounts = db.select({ sessionId: messages.sessionId, msgCount: count() })
      .from(messages)
      .groupBy(messages.sessionId)
      .all()
    for (const row of allMsgCounts) sessionMessageCounts[row.sessionId] = row.msgCount
  }

  const sessionsForExport = userSessions.map(s => ({
    ...s,
    messageCount: sessionMessageCounts[s.id] || 0,
  }))

  // Imports
  const userImports = db.select({
    id: importedFiles.id,
    filename: importedFiles.filename,
    fileType: importedFiles.fileType,
    createdAt: importedFiles.createdAt,
    processedContent: importedFiles.processedContent,
  }).from(importedFiles).where(eq(importedFiles.userId, LOCAL_USER_ID)).all()

  const importSources = userImports.map(imp => {
    let content: Record<string, unknown> = {}
    try { if (imp.processedContent) content = JSON.parse(imp.processedContent) } catch { /* empty */ }
    return {
      id: imp.id,
      filename: imp.filename,
      fileType: imp.fileType,
      title: (content.title as string) || imp.filename,
      summary: (content.summary as string) || null,
      isProcessed: content.processingStatus === 'processed',
      processedInsightCount: (content.processedInsightCount as number) || 0,
      importedAt: imp.createdAt,
    }
  })

  const personalityExport = getPersonalityExportData(db, 'exportable')

  return {
    exportVersion: '1.2',
    exportedAt: new Date().toISOString(),
    source: 'me.md',
    profile: summary,
    personality: personalityExport.hasAssessment ? {
      latestAssessment: personalityExport.latestAttempt,
      domainScores: personalityExport.domainScores,
      verifiedInsights: personalityExport.verifiedInsights,
      changeTrends: personalityExport.changeTrends,
      privacyTier: personalityExport.privacyTier,
    } : null,
    rawData: {
      insights: verifiedInsightsFull,
      topics: topicsWithParsedFields,
      topicConnections: connections,
      notes: notesForExport,
      sessions: sessionsForExport,
      importedSources: importSources,
    },
    metadata: {
      totalVerifiedInsights: verifiedInsightsFull.length,
      totalTopics: userTopics.length,
      totalTopicConnections: connections.length,
      totalNotes: notesForExport.length,
      totalSessions: sessionsForExport.length,
      completedSessions: sessionsForExport.filter(s => s.status === 'completed').length,
      totalImportedSources: importSources.length,
      processedImports: importSources.filter(s => s.isProcessed).length,
      hasPersonalityAssessment: personalityExport.hasAssessment,
      personalityInsightCount: personalityExport.verifiedInsights.length,
      assessmentCount: personalityExport.changeTrends.length || (personalityExport.hasAssessment ? 1 : 0),
    },
  }
}
