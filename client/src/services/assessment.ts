/**
 * Assessment Service — Big Five Personality Assessment
 * =====================================================
 * Ported from server/src/routes/assessment.ts
 * Manages Big Five (IPIP NEO-PI-R) personality assessment lifecycle:
 * start, answer, complete, results, history, compare, and insights.
 */

import { eq, and, desc } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import {
  assessmentAttempts,
  assessmentAnswers,
  assessmentResults,
  insights,
  topics,
  notes,
} from '@/db/schema'
import { scheduleSave } from '@/db/persistence'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { callAnthropic, isApiKeyConfigured } from './anthropic'

// ============================================
// Big Five library imports (CJS packages)
// ============================================

// @ts-expect-error — CJS package with no type declarations
import * as questionsLib from '@bigfive-org/questions'
// @ts-expect-error — CJS package with no type declarations
import calculateScoreFn from '@alheimsins/bigfive-calculate-score'
// @ts-expect-error — CJS package with no type declarations
import resultsLib from '@bigfive-org/results'

type Db = SQLJsDatabase<typeof schema>

// ============================================
// Types
// ============================================

export interface BigFiveQuestion {
  id: string
  text: string
  keyed: 'plus' | 'minus'
  domain: string
  facet: number
  num: number
  choices: Array<{ color: number; score: number; text: string }>
}

export interface BigFiveAnswer {
  domain: string
  facet: string
  score: number
}

// Domain labels
const DOMAIN_LABELS: Record<string, string> = {
  N: 'Neuroticism',
  E: 'Extraversion',
  O: 'Openness to Experience',
  A: 'Agreeableness',
  C: 'Conscientiousness',
}

const FACET_LABELS: Record<string, string[]> = {
  N: ['Anxiety', 'Anger', 'Depression', 'Self-Consciousness', 'Immoderation', 'Vulnerability'],
  E: ['Friendliness', 'Gregariousness', 'Assertiveness', 'Activity Level', 'Excitement-Seeking', 'Cheerfulness'],
  O: ['Imagination', 'Artistic Interests', 'Emotionality', 'Adventurousness', 'Intellect', 'Liberalism'],
  A: ['Trust', 'Morality', 'Altruism', 'Cooperation', 'Modesty', 'Sympathy'],
  C: ['Self-Efficacy', 'Orderliness', 'Dutifulness', 'Achievement-Striving', 'Self-Discipline', 'Cautiousness'],
}

// ============================================
// Big Five helpers
// ============================================

function getQuestionsList(lang = 'en'): BigFiveQuestion[] {
  return questionsLib.getItems(lang)
}

function getTestInfo(): { name: string; questions: number; time: number } {
  return questionsLib.getInfo()
}

function processTest(answers: BigFiveAnswer[], lang = 'en') {
  const scores = calculateScoreFn({
    answers: answers.map(a => ({ domain: a.domain, facet: a.facet, score: a.score })),
  })
  const results = resultsLib({ lang, scores })
  return { scores, results }
}

function getResultText(scores: Record<string, any>, lang = 'en'): any[] {
  return resultsLib({ lang, scores })
}

// ============================================
// Reconstructing scores from stored results
// ============================================

function reconstructScores(storedResults: Array<{
  domain: string
  domainScore: number
  facet1Score: number | null
  facet2Score: number | null
  facet3Score: number | null
  facet4Score: number | null
  facet5Score: number | null
  facet6Score: number | null
}>): Record<string, any> {
  const scores: Record<string, any> = {}
  for (const r of storedResults) {
    scores[r.domain] = {
      score: r.domainScore,
      count: 24,
      result: r.domainScore > 3 ? 'high' : r.domainScore < 3 ? 'low' : 'neutral',
      facet: {
        '1': { score: r.facet1Score ?? 0, count: 4, result: (r.facet1Score ?? 0) > 3 ? 'high' : (r.facet1Score ?? 0) < 3 ? 'low' : 'neutral' },
        '2': { score: r.facet2Score ?? 0, count: 4, result: (r.facet2Score ?? 0) > 3 ? 'high' : (r.facet2Score ?? 0) < 3 ? 'low' : 'neutral' },
        '3': { score: r.facet3Score ?? 0, count: 4, result: (r.facet3Score ?? 0) > 3 ? 'high' : (r.facet3Score ?? 0) < 3 ? 'low' : 'neutral' },
        '4': { score: r.facet4Score ?? 0, count: 4, result: (r.facet4Score ?? 0) > 3 ? 'high' : (r.facet4Score ?? 0) < 3 ? 'low' : 'neutral' },
        '5': { score: r.facet5Score ?? 0, count: 4, result: (r.facet5Score ?? 0) > 3 ? 'high' : (r.facet5Score ?? 0) < 3 ? 'low' : 'neutral' },
        '6': { score: r.facet6Score ?? 0, count: 4, result: (r.facet6Score ?? 0) > 3 ? 'high' : (r.facet6Score ?? 0) < 3 ? 'low' : 'neutral' },
      },
    }
  }
  return scores
}

// ============================================
// Personality Insights Generation (AI)
// ============================================

function formatScoresForPrompt(domainScores: Array<{
  domain: string
  domainScore: number
  facetScores: Record<string, number | null>
}>): string {
  const lines: string[] = []
  for (const ds of domainScores) {
    const domainLabel = DOMAIN_LABELS[ds.domain] || ds.domain
    const score = ds.domainScore
    const level = score >= 4 ? 'High' : score >= 3.5 ? 'Above Average' : score >= 2.5 ? 'Average' : score >= 2 ? 'Below Average' : 'Low'
    lines.push(`\n### ${domainLabel} (${ds.domain}): ${score.toFixed(2)}/5 — ${level}`)
    const facetLabels = FACET_LABELS[ds.domain] || []
    for (const [key, facetScore] of Object.entries(ds.facetScores)) {
      if (facetScore === null || facetScore === undefined) continue
      const facetNum = parseInt(key.replace('facet', ''), 10)
      const facetLabel = facetLabels[facetNum - 1] || `Facet ${facetNum}`
      const fLevel = facetScore >= 4 ? 'High' : facetScore >= 3 ? 'Moderate-High' : facetScore >= 2.5 ? 'Average' : 'Low'
      lines.push(`  - ${facetLabel}: ${facetScore.toFixed(2)} (${fLevel})`)
    }
  }
  return lines.join('\n')
}

function formatResultTextForPrompt(resultText: any[]): string {
  if (!resultText || resultText.length === 0) return '(No descriptive text available)'
  return resultText.map(r => {
    const parts = [`**${r.title || r.domain}**: ${r.text || r.description || r.shortDescription || ''}`]
    if (r.facets && Array.isArray(r.facets)) {
      for (const f of r.facets) {
        if (f.text) parts.push(`  - ${f.title || `Facet ${f.facet}`}: ${f.text}`)
      }
    }
    return parts.join('\n')
  }).join('\n\n')
}

interface PersonalityInsight {
  category: string
  claim: string
  confidence: number
  evidence: string
  crossReference?: string
}

interface PersonalityInsightsResult {
  insights: PersonalityInsight[]
  agreements: string[]
  contradictions: string[]
  generated: boolean
}

async function generatePersonalityInsights(
  db: Db,
  attemptId: string,
  domainScores: Array<{ domain: string; domainScore: number; facetScores: Record<string, number | null> }>,
  resultText: any[],
): Promise<PersonalityInsightsResult> {
  if (!isApiKeyConfigured()) {
    return { insights: [], agreements: [], contradictions: [], generated: false }
  }

  try {
    const existingInsights = db.select({
      content: insights.content,
      confidenceScore: insights.confidenceScore,
      verificationStatus: insights.verificationStatus,
      topicTitle: topics.title,
    })
      .from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(and(eq(insights.userId, LOCAL_USER_ID), eq(insights.verificationStatus, 'verified')))
      .all()

    const hasExistingInsights = existingInsights.length > 0
    const scoresText = formatScoresForPrompt(domainScores)
    const descriptionsText = formatResultTextForPrompt(resultText)

    let existingInsightsContext = ''
    if (hasExistingInsights) {
      existingInsightsContext = `\n## Existing Verified Interview Insights\n${existingInsights.slice(0, 20).map(i =>
        `- [From "${i.topicTitle}", confidence: ${i.confidenceScore}%]: "${i.content}"`
      ).join('\n')}`
    }

    const systemPrompt = `You are a personality psychologist for me.md. Generate rich, personalized personality insights from Big Five assessment results. Output ONLY valid JSON.`

    const userPrompt = `Analyze Big Five results and generate 5-10 insights.\n\n## Scores\n${scoresText}\n\n## Descriptions\n${descriptionsText}${existingInsightsContext}\n\nOutput JSON: { "insights": [{ "category": "...", "claim": "...", "confidence": 75, "evidence": "..." }], "agreements": [], "contradictions": [] }`

    const responseText = await callAnthropic({
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
      maxTokens: 4096,
    })

    let cleaned = responseText.trim()
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
    cleaned = cleaned.trim()

    const parsed = JSON.parse(cleaned)
    const validCategories = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism', 'cross_domain']

    const validInsights: PersonalityInsight[] = (parsed.insights || [])
      .filter((item: any) => typeof item === 'object' && item !== null && typeof item.claim === 'string' && typeof item.confidence === 'number')
      .map((item: any) => ({
        category: validCategories.includes(item.category) ? item.category : 'cross_domain',
        claim: item.claim.substring(0, 500),
        confidence: Math.min(Math.max(Math.round(item.confidence), 50), 95),
        evidence: typeof item.evidence === 'string' ? item.evidence.substring(0, 500) : '',
        crossReference: typeof item.crossReference === 'string' ? item.crossReference.substring(0, 500) : undefined,
      }))
      .slice(0, 10)

    return {
      insights: validInsights,
      agreements: Array.isArray(parsed.agreements) ? parsed.agreements.filter((a: any) => typeof a === 'string').slice(0, 5) : [],
      contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions.filter((c: any) => typeof c === 'string').slice(0, 5) : [],
      generated: true,
    }
  } catch (error: any) {
    console.error('[me.md:assessment] Error generating personality insights:', error.message)
    return { insights: [], agreements: [], contradictions: [], generated: false }
  }
}

function storePersonalityInsights(
  db: Db,
  attemptId: string,
  insightsResult: PersonalityInsightsResult,
): { noteId: string; insightIds: string[] } {
  let assessmentTopic = db.select()
    .from(topics)
    .where(and(eq(topics.userId, LOCAL_USER_ID), eq(topics.title, 'Big Five Personality Assessment')))
    .get()

  if (!assessmentTopic) {
    const topicId = crypto.randomUUID()
    assessmentTopic = db.insert(topics).values({
      id: topicId,
      userId: LOCAL_USER_ID,
      title: 'Big Five Personality Assessment',
      description: 'Personality insights generated from the Big Five (IPIP NEO-PI-R) assessment.',
      tags: JSON.stringify(['personality', 'big-five', 'assessment', 'self-knowledge']),
      status: 'extracted',
      priority: 'medium',
      intent: 'explore',
      isPreset: false,
      presetCategory: 'identity',
    }).returning().get()
  }

  const topicId = assessmentTopic!.id
  const noteId = crypto.randomUUID()
  const insightSummary = insightsResult.insights.map(i => `- **${i.category}**: ${i.claim}`).join('\n')
  const agreementsSummary = insightsResult.agreements.length > 0
    ? `\n\n## Agreements with Interview Insights\n${insightsResult.agreements.map(a => `- ${a}`).join('\n')}`
    : ''
  const contradictionsSummary = insightsResult.contradictions.length > 0
    ? `\n\n## Contradictions with Interview Insights\n${insightsResult.contradictions.map(c => `- ${c}`).join('\n')}`
    : ''

  const fullAnalysis = `# AI Personality Analysis\n\nGenerated from Big Five assessment (attempt: ${attemptId}).\n\n## Key Insights\n${insightSummary}${agreementsSummary}${contradictionsSummary}`

  db.insert(notes).values({
    id: noteId,
    sessionId: attemptId,
    topicId,
    userId: LOCAL_USER_ID,
    title: `Big Five AI Analysis — ${new Date().toLocaleDateString()}`,
    contentFullAnalysis: fullAnalysis,
    contentBriefSummary: `Big Five personality analysis with ${insightsResult.insights.length} insights generated.`,
    selectedFormat: 'full_analysis',
  }).run()

  const insightIds: string[] = []
  for (const insight of insightsResult.insights) {
    const insightId = crypto.randomUUID()
    insightIds.push(insightId)
    db.insert(insights).values({
      id: insightId,
      noteId,
      topicId,
      userId: LOCAL_USER_ID,
      content: insight.claim,
      confidenceScore: insight.confidence,
      verificationStatus: 'unverified',
      extractionMethod: 'ai',
      sourceSessionId: null,
    }).run()
  }

  scheduleSave()
  return { noteId, insightIds }
}

// ============================================
// Public API
// ============================================

export function startAssessment(db: Db, language = 'en') {
  const attemptId = crypto.randomUUID()
  db.insert(assessmentAttempts).values({
    id: attemptId,
    userId: LOCAL_USER_ID,
    status: 'in_progress',
  }).run()

  const questions = getQuestionsList(language)
  const testInfo = getTestInfo()

  scheduleSave()

  return {
    attemptId,
    status: 'in_progress',
    testInfo: {
      name: testInfo.name,
      totalQuestions: testInfo.questions,
      estimatedMinutes: testInfo.time,
    },
    questions,
  }
}

export function submitAnswers(
  db: Db,
  attemptId: string,
  answers: Array<{ questionId: string; answerValue: number }>,
) {
  if (!answers || !Array.isArray(answers) || answers.length === 0) {
    throw new Error('Answers must be a non-empty array')
  }

  const attempt = db.select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, LOCAL_USER_ID)))
    .get()

  if (!attempt) throw new Error('Assessment attempt not found')
  if (attempt.status === 'completed') throw new Error('Assessment already completed')

  const savedAnswers: Array<{ id: string; questionId: string; answerValue: number }> = []

  for (const answer of answers) {
    const { questionId, answerValue } = answer
    if (!questionId || typeof questionId !== 'string') throw new Error('Each answer must have a valid questionId string')
    if (typeof answerValue !== 'number' || answerValue < 1 || answerValue > 5) {
      throw new Error(`Invalid answerValue for question ${questionId}. Must be 1-5.`)
    }

    const existing = db.select()
      .from(assessmentAnswers)
      .where(and(eq(assessmentAnswers.attemptId, attemptId), eq(assessmentAnswers.questionId, questionId)))
      .get()

    if (existing) {
      db.update(assessmentAnswers)
        .set({ answerValue, answeredAt: new Date().toISOString() })
        .where(eq(assessmentAnswers.id, existing.id))
        .run()
      savedAnswers.push({ id: existing.id, questionId, answerValue })
    } else {
      const answerId = crypto.randomUUID()
      db.insert(assessmentAnswers).values({ id: answerId, attemptId, questionId, answerValue }).run()
      savedAnswers.push({ id: answerId, questionId, answerValue })
    }
  }

  const totalAnswered = db.select()
    .from(assessmentAnswers)
    .where(eq(assessmentAnswers.attemptId, attemptId))
    .all().length

  const testInfo = getTestInfo()

  scheduleSave()

  return {
    saved: savedAnswers.length,
    totalAnswered,
    totalQuestions: testInfo.questions,
    progress: Math.round((totalAnswered / testInfo.questions) * 100),
  }
}

export async function completeAssessment(db: Db, attemptId: string, language = 'en') {
  const attempt = db.select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, LOCAL_USER_ID)))
    .get()

  if (!attempt) throw new Error('Assessment attempt not found')
  if (attempt.status === 'completed') throw new Error('Assessment already completed')

  const allAnswers = db.select()
    .from(assessmentAnswers)
    .where(eq(assessmentAnswers.attemptId, attemptId))
    .all()

  const testInfo = getTestInfo()
  if (allAnswers.length < testInfo.questions) {
    throw new Error(`Not all questions answered. Answered: ${allAnswers.length}/${testInfo.questions}`)
  }

  const questions = getQuestionsList(language)
  const questionMap = new Map<string, { domain: string; facet: number }>()
  for (const q of questions) {
    questionMap.set(q.id, { domain: q.domain, facet: q.facet })
  }

  const bigFiveAnswers: BigFiveAnswer[] = []
  for (const answer of allAnswers) {
    const qMeta = questionMap.get(answer.questionId)
    if (!qMeta) continue
    bigFiveAnswers.push({ domain: qMeta.domain, facet: String(qMeta.facet), score: answer.answerValue })
  }

  const { scores, results: resultText } = processTest(bigFiveAnswers, language)

  // Store results
  for (const domainResult of resultText) {
    const domainKey = domainResult.domain
    const domainScoreData = scores[domainKey]
    if (!domainScoreData) continue
    const facetScores = domainScoreData.facet || {}

    db.insert(assessmentResults).values({
      id: crypto.randomUUID(),
      attemptId,
      domain: domainKey,
      domainScore: domainScoreData.score,
      facet1Score: facetScores['1']?.score ?? null,
      facet2Score: facetScores['2']?.score ?? null,
      facet3Score: facetScores['3']?.score ?? null,
      facet4Score: facetScores['4']?.score ?? null,
      facet5Score: facetScores['5']?.score ?? null,
      facet6Score: facetScores['6']?.score ?? null,
    }).run()
  }

  db.update(assessmentAttempts)
    .set({ status: 'completed', completedAt: new Date().toISOString() })
    .where(eq(assessmentAttempts.id, attemptId))
    .run()

  scheduleSave()

  // Build domain scores data for insight generation
  const domainScoresData = resultText.map((d: any) => {
    const domainKey = d.domain
    const domainScoreData = scores[domainKey]
    const facetScores = domainScoreData?.facet || {}
    return {
      domain: domainKey,
      domainScore: domainScoreData?.score || 0,
      facetScores: {
        facet1: facetScores['1']?.score ?? null,
        facet2: facetScores['2']?.score ?? null,
        facet3: facetScores['3']?.score ?? null,
        facet4: facetScores['4']?.score ?? null,
        facet5: facetScores['5']?.score ?? null,
        facet6: facetScores['6']?.score ?? null,
      },
    }
  })

  // Fire off AI insight generation (non-blocking)
  generatePersonalityInsights(db, attemptId, domainScoresData, resultText)
    .then(insightsResult => {
      if (insightsResult.generated && insightsResult.insights.length > 0) {
        storePersonalityInsights(db, attemptId, insightsResult)
      }
    })
    .catch(err => {
      console.error('[me.md:assessment] Error in async personality insight generation:', err.message)
    })

  return {
    attemptId,
    status: 'completed',
    completedAt: new Date().toISOString(),
    scores: resultText.map((d: any) => ({
      domain: d.domain,
      title: d.title,
      score: d.score,
      scoreText: d.scoreText,
      shortDescription: d.shortDescription,
    })),
    fullResults: resultText,
  }
}

export function getAssessmentHistory(db: Db) {
  const attempts = db.select()
    .from(assessmentAttempts)
    .where(eq(assessmentAttempts.userId, LOCAL_USER_ID))
    .orderBy(desc(assessmentAttempts.startedAt))
    .all()

  const history = attempts.map(attempt => {
    const results = db.select()
      .from(assessmentResults)
      .where(eq(assessmentResults.attemptId, attempt.id))
      .all()

    const domainScores = results.map(r => ({
      domain: r.domain,
      score: r.domainScore,
      facetScores: {
        facet1: r.facet1Score,
        facet2: r.facet2Score,
        facet3: r.facet3Score,
        facet4: r.facet4Score,
        facet5: r.facet5Score,
        facet6: r.facet6Score,
      },
    }))

    const answerCount = db.select()
      .from(assessmentAnswers)
      .where(eq(assessmentAnswers.attemptId, attempt.id))
      .all().length

    return {
      attemptId: attempt.id,
      status: attempt.status,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      answeredQuestions: answerCount,
      domainScores,
    }
  })

  return { history }
}

export function getLatestAssessment(db: Db, language = 'en') {
  const latestAttempt = db.select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.userId, LOCAL_USER_ID), eq(assessmentAttempts.status, 'completed')))
    .orderBy(desc(assessmentAttempts.completedAt))
    .limit(1)
    .get()

  if (!latestAttempt) return null

  const storedResults = db.select()
    .from(assessmentResults)
    .where(eq(assessmentResults.attemptId, latestAttempt.id))
    .all()

  const scores = reconstructScores(storedResults)

  let resultText: any[] = []
  try {
    resultText = getResultText(scores, language)
  } catch (e: any) {
    console.warn('[me.md:assessment] Could not generate result text:', e.message)
  }

  return {
    attemptId: latestAttempt.id,
    status: latestAttempt.status,
    startedAt: latestAttempt.startedAt,
    completedAt: latestAttempt.completedAt,
    domainScores: storedResults.map(r => ({
      domain: r.domain,
      domainScore: r.domainScore,
      facetScores: {
        facet1: r.facet1Score,
        facet2: r.facet2Score,
        facet3: r.facet3Score,
        facet4: r.facet4Score,
        facet5: r.facet5Score,
        facet6: r.facet6Score,
      },
    })),
    results: resultText,
  }
}

export function getAttemptResults(db: Db, attemptId: string, language = 'en') {
  const attempt = db.select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, LOCAL_USER_ID)))
    .get()

  if (!attempt) throw new Error('Assessment attempt not found')
  if (attempt.status !== 'completed') throw new Error('Assessment not yet completed')

  const storedResults = db.select()
    .from(assessmentResults)
    .where(eq(assessmentResults.attemptId, attemptId))
    .all()

  const scores = reconstructScores(storedResults)

  let resultText: any[] = []
  try {
    resultText = getResultText(scores, language)
  } catch (e: any) {
    console.warn('[me.md:assessment] Could not generate result text:', e.message)
  }

  // Fetch AI-generated personality insights
  let aiInsights: any[] = []
  let aiAgreements: string[] = []
  let aiContradictions: string[] = []

  try {
    const assessmentTopic = db.select()
      .from(topics)
      .where(and(eq(topics.userId, LOCAL_USER_ID), eq(topics.title, 'Big Five Personality Assessment')))
      .get()

    if (assessmentTopic) {
      const assessmentNote = db.select()
        .from(notes)
        .where(and(eq(notes.sessionId, attemptId), eq(notes.topicId, assessmentTopic.id), eq(notes.userId, LOCAL_USER_ID)))
        .get()

      if (assessmentNote) {
        const noteInsights = db.select()
          .from(insights)
          .where(and(eq(insights.noteId, assessmentNote.id), eq(insights.userId, LOCAL_USER_ID)))
          .all()

        aiInsights = noteInsights.map(i => ({
          id: i.id,
          content: i.content,
          confidenceScore: i.confidenceScore,
          verificationStatus: i.verificationStatus,
          extractionMethod: i.extractionMethod,
        }))

        if (assessmentNote.contentFullAnalysis) {
          const fullAnalysis = assessmentNote.contentFullAnalysis
          const agreementsMatch = fullAnalysis.match(/## Agreements with Interview Insights\n([\s\S]*?)(?=\n##|$)/)
          if (agreementsMatch) {
            aiAgreements = agreementsMatch[1].split('\n').filter((l: string) => l.startsWith('- ')).map((l: string) => l.replace(/^- /, '').trim())
          }
          const contradictionsMatch = fullAnalysis.match(/## Contradictions with Interview Insights\n([\s\S]*?)(?=\n##|$)/)
          if (contradictionsMatch) {
            aiContradictions = contradictionsMatch[1].split('\n').filter((l: string) => l.startsWith('- ')).map((l: string) => l.replace(/^- /, '').trim())
          }
        }
      }
    }
  } catch (e: any) {
    console.warn('[me.md:assessment] Could not fetch AI insights:', e.message)
  }

  return {
    attemptId: attempt.id,
    status: attempt.status,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    domainScores: storedResults.map(r => ({
      domain: r.domain,
      domainScore: r.domainScore,
      facetScores: {
        facet1: r.facet1Score,
        facet2: r.facet2Score,
        facet3: r.facet3Score,
        facet4: r.facet4Score,
        facet5: r.facet5Score,
        facet6: r.facet6Score,
      },
    })),
    results: resultText,
    aiAnalysis: {
      insights: aiInsights,
      agreements: aiAgreements,
      contradictions: aiContradictions,
      generated: aiInsights.length > 0,
    },
  }
}

export async function generateInsightsForAttempt(db: Db, attemptId: string, language = 'en') {
  const attempt = db.select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, LOCAL_USER_ID)))
    .get()

  if (!attempt) throw new Error('Assessment attempt not found')
  if (attempt.status !== 'completed') throw new Error('Assessment not yet completed')

  const storedResults = db.select()
    .from(assessmentResults)
    .where(eq(assessmentResults.attemptId, attemptId))
    .all()

  if (storedResults.length === 0) throw new Error('No results found for this attempt')

  const domainScoresData = storedResults.map(r => ({
    domain: r.domain,
    domainScore: r.domainScore,
    facetScores: {
      facet1: r.facet1Score,
      facet2: r.facet2Score,
      facet3: r.facet3Score,
      facet4: r.facet4Score,
      facet5: r.facet5Score,
      facet6: r.facet6Score,
    },
  }))

  const scores = reconstructScores(storedResults)
  let resultText: any[] = []
  try {
    resultText = getResultText(scores, language)
  } catch { /* empty */ }

  const insightsResult = await generatePersonalityInsights(db, attemptId, domainScoresData, resultText)
  if (!insightsResult.generated || insightsResult.insights.length === 0) {
    throw new Error('AI insight generation unavailable or returned no results')
  }

  const stored = storePersonalityInsights(db, attemptId, insightsResult)

  return {
    insightCount: insightsResult.insights.length,
    noteId: stored.noteId,
    insightIds: stored.insightIds,
    agreements: insightsResult.agreements,
    contradictions: insightsResult.contradictions,
  }
}

export function compareAssessments(db: Db, attemptAId: string, attemptBId: string) {
  const getAttemptWithResults = (attemptId: string) => {
    const attempt = db.select()
      .from(assessmentAttempts)
      .where(and(
        eq(assessmentAttempts.id, attemptId),
        eq(assessmentAttempts.userId, LOCAL_USER_ID),
        eq(assessmentAttempts.status, 'completed'),
      ))
      .get()
    if (!attempt) return null

    const results = db.select()
      .from(assessmentResults)
      .where(eq(assessmentResults.attemptId, attemptId))
      .all()

    return {
      attemptId: attempt.id,
      completedAt: attempt.completedAt,
      domainScores: results.map(r => ({
        domain: r.domain,
        score: r.domainScore,
        facetScores: {
          facet1: r.facet1Score,
          facet2: r.facet2Score,
          facet3: r.facet3Score,
          facet4: r.facet4Score,
          facet5: r.facet5Score,
          facet6: r.facet6Score,
        },
      })),
    }
  }

  const a = getAttemptWithResults(attemptAId)
  const b = getAttemptWithResults(attemptBId)
  if (!a || !b) throw new Error('One or both assessment attempts not found or not completed')

  const domainLabels: Record<string, string> = {
    N: 'Neuroticism', E: 'Extraversion', O: 'Openness', A: 'Agreeableness', C: 'Conscientiousness',
  }

  const comparison = ['O', 'C', 'E', 'A', 'N'].map(domain => {
    const scoreA = a.domainScores.find(d => d.domain === domain)
    const scoreB = b.domainScores.find(d => d.domain === domain)
    const domainScoreA = scoreA?.score ?? 0
    const domainScoreB = scoreB?.score ?? 0
    const diff = domainScoreB - domainScoreA
    const percentChange = domainScoreA > 0 ? (diff / domainScoreA) * 100 : 0
    const isSignificant = Math.abs(percentChange) >= 10

    const facetDiffs = [1, 2, 3, 4, 5, 6].map(f => {
      const key = `facet${f}` as string
      const facetsA = scoreA?.facetScores as Record<string, number | null> | undefined
      const facetsB = scoreB?.facetScores as Record<string, number | null> | undefined
      const fA = facetsA?.[key] ?? 0
      const fB = facetsB?.[key] ?? 0
      return { facet: f, scoreA: fA, scoreB: fB, diff: (fB as number) - (fA as number), isSignificant: Math.abs((fB as number) - (fA as number)) >= 0.5 }
    })

    return {
      domain,
      label: domainLabels[domain] || domain,
      scoreA: domainScoreA,
      scoreB: domainScoreB,
      diff,
      percentChange: Math.round(percentChange * 10) / 10,
      isSignificant,
      facets: facetDiffs,
    }
  })

  const significantChanges = comparison.filter(c => c.isSignificant)

  return {
    attemptA: { attemptId: a.attemptId, completedAt: a.completedAt },
    attemptB: { attemptId: b.attemptId, completedAt: b.completedAt },
    comparison,
    significantChanges: significantChanges.map(c => ({
      domain: c.domain,
      label: c.label,
      from: c.scoreA,
      to: c.scoreB,
      percentChange: c.percentChange,
    })),
  }
}

export async function generateChangeInsights(
  db: Db,
  attemptIdOld: string,
  attemptIdNew: string,
) {
  const getAttemptScores = (attemptId: string) => {
    const attempt = db.select()
      .from(assessmentAttempts)
      .where(and(
        eq(assessmentAttempts.id, attemptId),
        eq(assessmentAttempts.userId, LOCAL_USER_ID),
        eq(assessmentAttempts.status, 'completed'),
      ))
      .get()
    if (!attempt) return null

    const results = db.select()
      .from(assessmentResults)
      .where(eq(assessmentResults.attemptId, attemptId))
      .all()

    return {
      attemptId: attempt.id,
      completedAt: attempt.completedAt,
      scores: results.map(r => ({
        domain: r.domain,
        domainScore: r.domainScore,
        facetScores: {
          facet1: r.facet1Score,
          facet2: r.facet2Score,
          facet3: r.facet3Score,
          facet4: r.facet4Score,
          facet5: r.facet5Score,
          facet6: r.facet6Score,
        },
      })),
    }
  }

  const oldAttempt = getAttemptScores(attemptIdOld)
  const newAttempt = getAttemptScores(attemptIdNew)
  if (!oldAttempt || !newAttempt) throw new Error('One or both attempts not found or not completed')

  // Build change insights (rule-based fallback or AI)
  const changeInsights = await _generateChangeInsightsAI(
    oldAttempt.scores,
    newAttempt.scores,
    oldAttempt.completedAt || '',
    newAttempt.completedAt || '',
  )

  // Store change insights in the knowledge graph
  if (changeInsights.insights.length > 0) {
    try {
      let assessmentTopic = db.select()
        .from(topics)
        .where(and(eq(topics.userId, LOCAL_USER_ID), eq(topics.title, 'Big Five Personality Assessment')))
        .get()

      if (!assessmentTopic) {
        const topicId = crypto.randomUUID()
        assessmentTopic = db.insert(topics).values({
          id: topicId,
          userId: LOCAL_USER_ID,
          title: 'Big Five Personality Assessment',
          description: 'Personality insights generated from the Big Five (IPIP NEO-PI-R) assessment.',
          tags: JSON.stringify(['personality', 'big-five', 'assessment', 'self-knowledge']),
          status: 'extracted',
          priority: 'medium',
          intent: 'explore',
          isPreset: false,
          presetCategory: 'identity',
        }).returning().get()
      }

      const noteId = crypto.randomUUID()
      const oldDateStr = oldAttempt.completedAt ? new Date(oldAttempt.completedAt).toLocaleDateString() : 'earlier'
      const newDateStr = newAttempt.completedAt ? new Date(newAttempt.completedAt).toLocaleDateString() : 'recent'
      const insightsList = changeInsights.insights.map((i: string) => `- ${i}`).join('\n')
      const shiftsList = changeInsights.significantShifts.length > 0
        ? `\n\n## Significant Shifts\n${changeInsights.significantShifts.map((s: any) =>
            `- **${s.label}**: ${s.from.toFixed(2)} -> ${s.to.toFixed(2)} — ${s.interpretation}`
          ).join('\n')}`
        : ''

      const fullAnalysis = `# Personality Change Analysis\n\nComparing assessments from ${oldDateStr} to ${newDateStr}.\n\n## Change Insights\n${insightsList}${shiftsList}`

      db.insert(notes).values({
        id: noteId,
        sessionId: attemptIdNew,
        topicId: assessmentTopic!.id,
        userId: LOCAL_USER_ID,
        title: `Personality Changes — ${oldDateStr} to ${newDateStr}`,
        contentFullAnalysis: fullAnalysis,
        contentBriefSummary: `Personality change analysis with ${changeInsights.insights.length} insights.`,
        selectedFormat: 'full_analysis',
      }).run()

      for (const insight of changeInsights.insights) {
        db.insert(insights).values({
          id: crypto.randomUUID(),
          noteId,
          topicId: assessmentTopic!.id,
          userId: LOCAL_USER_ID,
          content: insight,
          confidenceScore: 75,
          verificationStatus: 'unverified',
          extractionMethod: changeInsights.generated ? 'ai' : 'rule_based',
          sourceSessionId: null,
        }).run()
      }

      scheduleSave()
    } catch (storeErr: any) {
      console.warn('[me.md:assessment] Failed to store change insights:', storeErr.message)
    }
  }

  return changeInsights
}

// Internal helper for change insights AI call
async function _generateChangeInsightsAI(
  oldScores: Array<{ domain: string; domainScore: number; facetScores: Record<string, number | null> }>,
  newScores: Array<{ domain: string; domainScore: number; facetScores: Record<string, number | null> }>,
  oldDate: string,
  newDate: string,
) {
  if (!isApiKeyConfigured()) {
    return _generateRuleBasedChangeInsights(oldScores, newScores)
  }

  try {
    const domainChanges: string[] = []
    for (const newD of newScores) {
      const oldD = oldScores.find(o => o.domain === newD.domain)
      if (!oldD) continue
      const domainLabel = DOMAIN_LABELS[newD.domain] || newD.domain
      const diff = newD.domainScore - oldD.domainScore
      const pctChange = oldD.domainScore > 0 ? ((diff / oldD.domainScore) * 100).toFixed(1) : '0'
      domainChanges.push(`${domainLabel} (${newD.domain}): ${oldD.domainScore.toFixed(2)} -> ${newD.domainScore.toFixed(2)} (${diff > 0 ? '+' : ''}${diff.toFixed(2)}, ${pctChange}%)`)

      const facetLabels = FACET_LABELS[newD.domain] || []
      for (let i = 1; i <= 6; i++) {
        const key = `facet${i}`
        const oldF = oldD.facetScores[key]
        const newF = newD.facetScores[key]
        if (oldF !== null && oldF !== undefined && newF !== null && newF !== undefined) {
          const fDiff = (newF as number) - (oldF as number)
          if (Math.abs(fDiff) >= 0.3) {
            domainChanges.push(`  - ${facetLabels[i - 1] || `Facet ${i}`}: ${(oldF as number).toFixed(2)} -> ${(newF as number).toFixed(2)}`)
          }
        }
      }
    }

    const responseText = await callAnthropic({
      messages: [{ role: 'user', content: `Analyze Big Five changes:\n\n${domainChanges.join('\n')}\n\nOutput JSON: { "insights": [...], "significantShifts": [{ "domain": "O", "label": "Openness", "from": 3.5, "to": 4.0, "interpretation": "..." }] }` }],
      system: 'You are a personality psychologist analyzing Big Five score changes. Output ONLY valid JSON.',
      maxTokens: 2048,
    })

    let cleaned = responseText.trim()
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
    cleaned = cleaned.trim()

    const parsed = JSON.parse(cleaned)
    return {
      insights: Array.isArray(parsed.insights) ? parsed.insights.filter((i: unknown) => typeof i === 'string').slice(0, 5) : [],
      significantShifts: Array.isArray(parsed.significantShifts) ? parsed.significantShifts.slice(0, 5) : [],
      generated: true,
    }
  } catch {
    return _generateRuleBasedChangeInsights(oldScores, newScores)
  }
}

function _generateRuleBasedChangeInsights(
  oldScores: Array<{ domain: string; domainScore: number; facetScores: Record<string, number | null> }>,
  newScores: Array<{ domain: string; domainScore: number; facetScores: Record<string, number | null> }>,
) {
  const insightsArr: string[] = []
  const significantShifts: Array<{ domain: string; label: string; from: number; to: number; interpretation: string }> = []

  for (const newD of newScores) {
    const oldD = oldScores.find(o => o.domain === newD.domain)
    if (!oldD) continue
    const domainLabel = DOMAIN_LABELS[newD.domain] || newD.domain
    const diff = newD.domainScore - oldD.domainScore
    const pctChange = oldD.domainScore > 0 ? (diff / oldD.domainScore) * 100 : 0

    if (Math.abs(pctChange) >= 10) {
      const direction = diff > 0 ? 'increased' : 'decreased'
      insightsArr.push(`Your ${domainLabel} ${direction} significantly (${oldD.domainScore.toFixed(1)} -> ${newD.domainScore.toFixed(1)}, ${Math.abs(pctChange).toFixed(0)}% change).`)
      significantShifts.push({
        domain: newD.domain,
        label: domainLabel,
        from: oldD.domainScore,
        to: newD.domainScore,
        interpretation: `${domainLabel} ${direction} by ${Math.abs(pctChange).toFixed(0)}%.`,
      })
    }
  }

  if (insightsArr.length === 0) {
    insightsArr.push('Your personality scores have remained relatively stable since your last assessment.')
  }

  return { insights: insightsArr, significantShifts, generated: false }
}
