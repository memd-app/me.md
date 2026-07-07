import { and, desc, eq } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import {
  assessmentAnswers,
  assessmentAttempts,
  assessmentResults,
  insights,
  topics,
} from '@/db/schema'
import { scheduleSave } from '@/db/persistence'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { callAnthropic, isApiKeyConfigured } from './anthropic'
import { extractJson } from './textCleaning'
import {
  getAssessmentAiAnalysis,
  getQuestionsList,
  getTestInfo,
  storeAssessmentInsights,
  type AssessmentInsightsResult,
  type AssessmentInsight,
} from './assessment'

type Db = SQLJsDatabase<typeof schema>

export type RiasecScale = 'R' | 'I' | 'A' | 'S' | 'E' | 'C'

export interface RiasecQuestion {
  id: string
  text: string
  keyed: 'plus'
  domain: RiasecScale
  num: number
  choices: Array<{ text: string; score: number; color: number }>
}

export const RIASEC_ORDER: RiasecScale[] = ['R', 'I', 'A', 'S', 'E', 'C']

export const RIASEC_LABELS: Record<RiasecScale, string> = {
  R: 'Realistic',
  I: 'Investigative',
  A: 'Artistic',
  S: 'Social',
  E: 'Enterprising',
  C: 'Conventional',
}

const RIASEC_TOPIC_TITLE = 'Interest Profile (RIASEC)'

function emptyScales(): Record<RiasecScale, number> {
  return { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 }
}

export function hollandCode(scales: Record<RiasecScale, number>): string {
  return RIASEC_ORDER
    .map(domain => ({ domain, score: scales[domain] }))
    .sort((a, b) => b.score - a.score || RIASEC_ORDER.indexOf(a.domain) - RIASEC_ORDER.indexOf(b.domain))
    .slice(0, 3)
    .map(item => item.domain)
    .join('')
}

export function scoreRiasec(
  answers: Array<{ questionId: string; answerValue: number }>,
  questions: RiasecQuestion[],
): { scales: Record<RiasecScale, number>; code: string } {
  const questionById = new Map(questions.map(question => [question.id, question]))
  const scales = emptyScales()

  for (const answer of answers) {
    const question = questionById.get(answer.questionId)
    if (!question) continue
    scales[question.domain] += answer.answerValue
  }

  return { scales, code: hollandCode(scales) }
}

function riasecLevel(score: number): 'High' | 'Moderate' | 'Low' {
  if (score >= 40) return 'High'
  if (score >= 30) return 'Moderate'
  return 'Low'
}

function orderedScaleRows(scales: Record<RiasecScale, number>) {
  return RIASEC_ORDER.map(domain => ({
    domain,
    label: RIASEC_LABELS[domain],
    score: scales[domain],
    level: riasecLevel(scales[domain]),
  }))
}

function readScalesFromResults(rows: Array<{ domain: string; domainScore: number }>): Record<RiasecScale, number> {
  const scales = emptyScales()
  for (const row of rows) {
    if ((RIASEC_ORDER as string[]).includes(row.domain)) {
      scales[row.domain as RiasecScale] = row.domainScore
    }
  }
  return scales
}

function formatRiasecScoresForPrompt(scales: Record<RiasecScale, number>, code: string): string {
  return RIASEC_ORDER.map(domain => {
    const score = scales[domain]
    const codePosition = code.indexOf(domain)
    const codeLabel = codePosition === -1 ? '' : `, ${codePosition + 1} of Holland code ${code}`
    return `- ${RIASEC_LABELS[domain]} (${domain}): ${score}/50 — ${riasecLevel(score)}${codeLabel}`
  }).join('\n')
}

async function generateRiasecInsights(
  db: Db,
  _attemptId: string,
  scales: Record<RiasecScale, number>,
  code: string,
): Promise<AssessmentInsightsResult> {
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

    const existingInsightsContext = existingInsights.length > 0
      ? `\n## Existing Verified Interview Insights\n${existingInsights.slice(0, 20).map(i =>
        `- [From "${i.topicTitle}", confidence: ${i.confidenceScore}%]: "${i.content}"`
      ).join('\n')}`
      : ''

    const systemPrompt = `<role>
You interpret O*NET Interest Profiler (RIASEC) results into grounded interest insights for me.md.
Every claim traces to a named scale score or the Holland code.
</role>
<rules>
- Ground each insight in a named scale (Realistic/Investigative/Artistic/Social/Enterprising/
  Conventional) or the 3-letter Holland code. No score support -> no claim.
- Provisional, not verdicts: these await the person's review. No career prescriptions, no "you
  should"; describe orientation, not destiny.
- category MUST be one of: realistic, investigative, artistic, social, enterprising, conventional,
  cross_interest.
- Only assert an agreement/contradiction with a listed verified interview insight when a scale
  genuinely supports it; else return empty arrays.
</rules>
<output_contract>
One JSON object, no prose, no fences:
{"insights":[{"category":string,"claim":string(<=300 chars),"confidence":int 50-95,
 "evidence":string(cite the scale, e.g. "Investigative 41/50, top of code RIA")}],
 "agreements":string[],"contradictions":string[]}
</output_contract>`

    const userPrompt = `Generate 5-10 interest insights from these O*NET Interest Profiler results.

## Scores
${formatRiasecScoresForPrompt(scales, code)}

## Holland code
${code}${existingInsightsContext}

<confidence_calibration>
- 50-64: single moderate scale.
- 65-79: one clear high or low scale.
- 80-95: code apex plus a second aligned scale.
Never default to a round number; let the scores set it.
</confidence_calibration>

Return the JSON object only.`

    const responseText = await callAnthropic({
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
      maxTokens: 4096,
    })

    const parsed = extractJson<{ insights?: unknown[]; agreements?: unknown[]; contradictions?: unknown[] }>(responseText)
    if (!parsed) throw new Error('Could not parse RIASEC insight JSON.')
    const validCategories = ['realistic', 'investigative', 'artistic', 'social', 'enterprising', 'conventional', 'cross_interest']

    const validInsights: AssessmentInsight[] = (Array.isArray(parsed.insights) ? parsed.insights : [])
      .filter((item: any) => typeof item === 'object' && item !== null && typeof item.claim === 'string' && typeof item.confidence === 'number')
      .map((item: any) => ({
        category: validCategories.includes(item.category) ? item.category : 'cross_interest',
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
    console.error('[me.md:riasec] Error generating RIASEC insights:', error.message)
    return { insights: [], agreements: [], contradictions: [], generated: false }
  }
}

export async function completeRiasecAttempt(db: Db, attemptId: string, language = 'en') {
  const attempt = db.select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, LOCAL_USER_ID)))
    .get()

  if (!attempt) throw new Error('Assessment attempt not found')
  if (attempt.status === 'completed') throw new Error('Assessment already completed')
  if ((attempt.assessmentType ?? 'bigfive') !== 'riasec') throw new Error('Assessment attempt is not RIASEC')

  const allAnswers = db.select()
    .from(assessmentAnswers)
    .where(eq(assessmentAnswers.attemptId, attemptId))
    .all()

  const testInfo = getTestInfo('riasec')
  if (allAnswers.length < testInfo.questions) {
    throw new Error(`Not all questions answered. Answered: ${allAnswers.length}/${testInfo.questions}`)
  }

  const questions = getQuestionsList('riasec', language)
  const { scales, code } = scoreRiasec(allAnswers, questions)

  for (const domain of RIASEC_ORDER) {
    db.insert(assessmentResults).values({
      id: crypto.randomUUID(),
      attemptId,
      domain,
      domainScore: scales[domain],
      facet1Score: null,
      facet2Score: null,
      facet3Score: null,
      facet4Score: null,
      facet5Score: null,
      facet6Score: null,
      detail: null,
    }).run()
  }

  const completedAt = new Date().toISOString()
  db.update(assessmentAttempts)
    .set({ status: 'completed', completedAt })
    .where(eq(assessmentAttempts.id, attemptId))
    .run()

  scheduleSave()

  generateRiasecInsights(db, attemptId, scales, code)
    .then(insightsResult => {
      if (insightsResult.generated && insightsResult.insights.length > 0) {
        storeAssessmentInsights(db, attemptId, insightsResult, {
          topicTitle: RIASEC_TOPIC_TITLE,
          topicDescription: 'Interest insights generated from the O*NET Interest Profiler short form.',
          tags: ['interests', 'riasec', 'assessment', 'self-knowledge'],
          notePrefix: 'Interest profile',
          noteIntro: 'Generated from O*NET Interest Profiler results',
        })
      }
    })
    .catch(err => {
      console.error('[me.md:riasec] Error in async RIASEC insight generation:', err.message)
    })

  return {
    attemptId,
    status: 'completed',
    completedAt,
    code,
    scales,
    scores: orderedScaleRows(scales),
  }
}

export function getRiasecAttemptResults(db: Db, attemptId: string) {
  const attempt = db.select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, LOCAL_USER_ID)))
    .get()

  if (!attempt) throw new Error('Assessment attempt not found')
  if (attempt.status !== 'completed') throw new Error('Assessment not yet completed')
  if ((attempt.assessmentType ?? 'bigfive') !== 'riasec') throw new Error('Assessment attempt is not RIASEC')

  const storedResults = db.select()
    .from(assessmentResults)
    .where(eq(assessmentResults.attemptId, attemptId))
    .all()

  const scales = readScalesFromResults(storedResults)
  const code = hollandCode(scales)

  return {
    attemptId: attempt.id,
    assessmentType: 'riasec' as const,
    status: attempt.status,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    code,
    scales: orderedScaleRows(scales),
    aiAnalysis: getAssessmentAiAnalysis(db, attemptId, RIASEC_TOPIC_TITLE),
  }
}

export function getLatestRiasec(db: Db) {
  const latestAttempt = db.select()
    .from(assessmentAttempts)
    .where(and(
      eq(assessmentAttempts.userId, LOCAL_USER_ID),
      eq(assessmentAttempts.status, 'completed'),
      eq(assessmentAttempts.assessmentType, 'riasec'),
    ))
    .orderBy(desc(assessmentAttempts.completedAt))
    .limit(1)
    .get()

  if (!latestAttempt) return null
  return getRiasecAttemptResults(db, latestAttempt.id)
}

export function getRiasecSummaryLine(db: Db): string | null {
  const latest = getLatestRiasec(db)
  if (!latest || latest.scales.length === 0) return null
  const top = latest.code.split('').map(domain => latest.scales.find(scale => scale.domain === domain)).filter(Boolean)
  if (top.length < 3) return null
  return `Holland code ${latest.code} — ${top.map(scale => `${scale!.label} ${scale!.score}`).join(', ')} (top scales of 6)`
}

export function getRiasecExportData(db: Db): {
  hasRiasec: boolean
  code: string
  scales: Array<{ domain: RiasecScale; label: string; score: number; level: string }>
  attemptId?: string
} {
  const latest = getLatestRiasec(db)
  if (!latest) return { hasRiasec: false, code: '', scales: [] }
  return {
    hasRiasec: true,
    code: latest.code,
    scales: latest.scales,
    attemptId: latest.attemptId,
  }
}

export async function generateInsightsForRiasecAttempt(db: Db, attemptId: string) {
  const result = getRiasecAttemptResults(db, attemptId)
  const scales = result.scales.reduce<Record<RiasecScale, number>>((acc, row) => {
    acc[row.domain] = row.score
    return acc
  }, emptyScales())
  const insightsResult = await generateRiasecInsights(db, attemptId, scales, result.code)
  if (!insightsResult.generated || insightsResult.insights.length === 0) {
    throw new Error('AI insight generation unavailable or returned no results')
  }

  const stored = storeAssessmentInsights(db, attemptId, insightsResult, {
    topicTitle: RIASEC_TOPIC_TITLE,
    topicDescription: 'Interest insights generated from the O*NET Interest Profiler short form.',
    tags: ['interests', 'riasec', 'assessment', 'self-knowledge'],
    notePrefix: 'Interest profile',
    noteIntro: 'Generated from O*NET Interest Profiler results',
  })

  return {
    insightCount: insightsResult.insights.length,
    noteId: stored.noteId,
    insightIds: stored.insightIds,
    agreements: insightsResult.agreements,
    contradictions: insightsResult.contradictions,
  }
}
