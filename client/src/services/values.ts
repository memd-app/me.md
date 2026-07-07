import { and, desc, eq } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import {
  assessmentAttempts,
  assessmentResults,
  messages,
  notes,
  sessions,
  topics,
} from '@/db/schema'
import { scheduleSave } from '@/db/persistence'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { callAnthropic, isApiKeyConfigured } from './anthropic'
import { extractJson } from './textCleaning'
import { completeSession } from './sessions'
import {
  extractInsights,
  formatInterviewTranscript,
  type PriorAlignment,
} from './insightExtraction'
import { fetchExistingInsightRefs } from './admissionPersistence'
import { storeAssessmentInsights, type AssessmentInsight } from './assessment'

type Db = SQLJsDatabase<typeof schema>

export type SchwartzValue =
  | 'self_direction'
  | 'stimulation'
  | 'hedonism'
  | 'achievement'
  | 'power'
  | 'security'
  | 'conformity'
  | 'tradition'
  | 'benevolence'
  | 'universalism'

export const SCHWARTZ_KEYS: SchwartzValue[] = [
  'self_direction',
  'stimulation',
  'hedonism',
  'achievement',
  'power',
  'security',
  'conformity',
  'tradition',
  'benevolence',
  'universalism',
]

export const SCHWARTZ_LABELS: Record<SchwartzValue, string> = {
  self_direction: 'Self-Direction',
  stimulation: 'Stimulation',
  hedonism: 'Hedonism',
  achievement: 'Achievement',
  power: 'Power',
  security: 'Security',
  conformity: 'Conformity',
  tradition: 'Tradition',
  benevolence: 'Benevolence',
  universalism: 'Universalism',
}

export const SCHWARTZ_QUADRANTS: Array<{ key: string; title: string; values: SchwartzValue[] }> = [
  { key: 'openness_to_change', title: 'Openness to Change', values: ['self_direction', 'stimulation', 'hedonism'] },
  { key: 'self_enhancement', title: 'Self-Enhancement', values: ['achievement', 'power'] },
  { key: 'conservation', title: 'Conservation', values: ['security', 'conformity', 'tradition'] },
  { key: 'self_transcendence', title: 'Self-Transcendence', values: ['benevolence', 'universalism'] },
]

export const VALUES_TOPIC_TITLE = 'Values — guided assessment'

export interface ValuesMapping {
  values: Array<{ key: SchwartzValue; score: number; rationale: string }>
  dominant: SchwartzValue[]
  least_active: SchwartzValue[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function valueKeyLabel(key: SchwartzValue): string {
  return key.replace(/_/g, '-')
}

function repairedJsonParse<T>(raw: string): T | null {
  const direct = extractJson<T>(raw)
  if (direct) return direct

  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.search(/[\[{]/)
  if (start === -1) return null
  s = s.slice(start)
  s = s.replace(/,\s*([}\]])/g, '$1')
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

function isSchwartzValue(value: unknown): value is SchwartzValue {
  return typeof value === 'string' && (SCHWARTZ_KEYS as string[]).includes(value)
}

export function parseValuesMapping(raw: string): ValuesMapping | null {
  const parsed = repairedJsonParse<{ values?: unknown[]; dominant?: unknown[]; least_active?: unknown[] }>(raw)
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.values)) return null

  const byKey = new Map<SchwartzValue, { key: SchwartzValue; score: number; rationale: string }>()
  const seen = new Set<SchwartzValue>()

  for (const item of parsed.values) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as { key?: unknown; score?: unknown; rationale?: unknown }
    if (!isSchwartzValue(candidate.key)) continue
    if (seen.has(candidate.key)) return null
    seen.add(candidate.key)
    const rawScore = typeof candidate.score === 'number' && Number.isFinite(candidate.score) ? candidate.score : 0
    const rationale = typeof candidate.rationale === 'string' ? candidate.rationale.trim().slice(0, 240) : ''
    byKey.set(candidate.key, {
      key: candidate.key,
      score: clamp(Math.round(rawScore), 0, 100),
      rationale,
    })
  }

  if (SCHWARTZ_KEYS.some(key => !byKey.has(key))) return null

  const dominant = (Array.isArray(parsed.dominant) ? parsed.dominant : [])
    .filter(isSchwartzValue)
    .slice(0, 2)
  const leastActive = (Array.isArray(parsed.least_active) ? parsed.least_active : [])
    .filter(isSchwartzValue)
    .slice(0, 2)

  return {
    values: SCHWARTZ_KEYS.map(key => byKey.get(key)!),
    dominant,
    least_active: leastActive,
  }
}

function formatValuesAnalysis(mapping: ValuesMapping): string {
  const valueRows = mapping.values
    .map(value => `- ${SCHWARTZ_LABELS[value.key]} (${valueKeyLabel(value.key)}): ${value.score}/100 — ${value.rationale}`)
    .join('\n')

  return [
    '## Values mapping',
    `Dominant: ${mapping.dominant.map(key => valueKeyLabel(key)).join(', ') || 'not identified'}`,
    `Least active: ${mapping.least_active.map(key => valueKeyLabel(key)).join(', ') || 'not identified'}`,
    '',
    valueRows,
  ].join('\n')
}

async function mapValuesTranscript(transcript: string): Promise<ValuesMapping> {
  if (!isApiKeyConfigured()) throw new Error('Anthropic API key required')

  const clippedTranscript = transcript.length > 24000
    ? `${transcript.slice(0, 24000)}\n\n[Transcript truncated to fit; map only what appears above.]`
    : transcript

  const systemPrompt = `<role>
You map an interview transcript onto Schwartz's ten basic human values for me.md. You score from
evidence in the transcript only — never from priors about the person's job or demographics.
</role>
<rules>
- Score each of the ten values 0-100 by how strongly the transcript evidences it. Absence of
  evidence is a low score, not a guess.
- Each rationale is 1-2 sentences and must quote or paraphrase something the person actually
  said. No rationale without transcript support.
- Name the 2 dominant (highest-evidence) and 2 least-active values. These must be consistent with
  the scores.
- Neutral, non-judgemental; values are orientations, not virtues or faults.
</rules>
<output_contract>
One JSON object, no prose, no fences:
{"values":[{"key":<one of self_direction|stimulation|hedonism|achievement|power|security|
  conformity|tradition|benevolence|universalism>,"score":int 0-100,
  "rationale":string(<=240 chars)}],
 "dominant":[<key>,<key>], "least_active":[<key>,<key>]}
</output_contract>`

  const userPrompt = `Map the following onto the ten values. Return the JSON object only.

## Transcript
${clippedTranscript}`

  const responseText = await callAnthropic({
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt,
    maxTokens: 4096,
  })
  const mapping = parseValuesMapping(responseText)
  if (!mapping) throw new Error('Could not parse values mapping.')
  return mapping
}

export function getOrCreateValuesTopic(db: Db) {
  const existing = db.select()
    .from(topics)
    .where(and(eq(topics.userId, LOCAL_USER_ID), eq(topics.title, VALUES_TOPIC_TITLE)))
    .get()

  if (existing) return existing

  const topic = db.insert(topics).values({
    id: crypto.randomUUID(),
    userId: LOCAL_USER_ID,
    title: VALUES_TOPIC_TITLE,
    description: 'A guided conversation that maps concrete trade-offs onto Schwartz values.',
    tags: JSON.stringify(['values', 'schwartz', 'assessment', 'identity']),
    status: 'backlog',
    priority: 'medium',
    intent: 'explore',
    isPreset: true,
    presetCategory: 'identity',
  }).returning().get()

  scheduleSave()
  return topic
}

function noteForAttempt(db: Db, attemptId: string) {
  const topic = db.select()
    .from(topics)
    .where(and(eq(topics.userId, LOCAL_USER_ID), eq(topics.title, VALUES_TOPIC_TITLE)))
    .get()
  if (!topic) return null

  return db.select()
    .from(notes)
    .where(and(eq(notes.userId, LOCAL_USER_ID), eq(notes.topicId, topic.id)))
    .all()
    .find(note => Boolean(note.contentFullAnalysis?.includes(`attempt: ${attemptId}`))) ?? null
}

function mappingMetaFromNote(db: Db, attemptId: string): Pick<ValuesMapping, 'dominant' | 'least_active'> | null {
  const note = noteForAttempt(db, attemptId)
  if (!note?.contentJson) return null
  try {
    const parsed = JSON.parse(note.contentJson) as Partial<ValuesMapping>
    return {
      dominant: Array.isArray(parsed.dominant) ? parsed.dominant.filter(isSchwartzValue).slice(0, 2) : [],
      least_active: Array.isArray(parsed.least_active) ? parsed.least_active.filter(isSchwartzValue).slice(0, 2) : [],
    }
  } catch {
    return null
  }
}

function valuesFromRows(rows: Array<{ domain: string; domainScore: number; detail: string | null }>) {
  return rows
    .filter(row => isSchwartzValue(row.domain))
    .map(row => ({
      key: row.domain as SchwartzValue,
      label: SCHWARTZ_LABELS[row.domain as SchwartzValue],
      score: row.domainScore,
      rationale: row.detail ?? '',
    }))
}

function deriveDominant(values: Array<{ key: SchwartzValue; score: number }>): SchwartzValue[] {
  return [...values].sort((a, b) => b.score - a.score || SCHWARTZ_KEYS.indexOf(a.key) - SCHWARTZ_KEYS.indexOf(b.key)).slice(0, 2).map(value => value.key)
}

function deriveLeastActive(values: Array<{ key: SchwartzValue; score: number }>): SchwartzValue[] {
  return [...values].sort((a, b) => a.score - b.score || SCHWARTZ_KEYS.indexOf(a.key) - SCHWARTZ_KEYS.indexOf(b.key)).slice(0, 2).map(value => value.key)
}

export async function completeValuesAssessment(db: Db, sessionId: string): Promise<ValuesMapping & { attemptId: string }> {
  const sessionRow = db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!sessionRow) throw new Error('Session not found')
  const topic = db.select().from(topics).where(eq(topics.id, sessionRow.topicId)).get()
  if (!topic) throw new Error('Values topic not found')

  const sessionMessages = db.select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()
  const userMsgs = sessionMessages.filter(message => message.role === 'user')
  const assistantMsgs = sessionMessages.filter(message => message.role === 'assistant')
  const transcript = formatInterviewTranscript(userMsgs, assistantMsgs)
  const mapping = await mapValuesTranscript(transcript)

  // Mapping succeeded — only now retire the session, so a mapping failure
  // leaves it active and re-finishable.
  completeSession(db, sessionId)

  const attemptId = crypto.randomUUID()
  const completedAt = new Date().toISOString()
  db.insert(assessmentAttempts).values({
    id: attemptId,
    userId: LOCAL_USER_ID,
    assessmentType: 'values',
    status: 'completed',
    completedAt,
  }).run()

  for (const value of mapping.values) {
    db.insert(assessmentResults).values({
      id: crypto.randomUUID(),
      attemptId,
      domain: value.key,
      domainScore: value.score,
      facet1Score: null,
      facet2Score: null,
      facet3Score: null,
      facet4Score: null,
      facet5Score: null,
      facet6Score: null,
      detail: value.rationale,
    }).run()
  }

  try {
  const existing = fetchExistingInsightRefs(db)
  const existingVerified = existing
    .filter(ref => ref.verificationStatus === 'verified')
    .map(ref => ({ content: ref.content, confidenceScore: 50 }))
  const { getAssessmentSummary } = await import('./profile')
  const extracted = await extractInsights({
    content: transcript,
    sourceType: 'interview',
    topicTitle: VALUES_TOPIC_TITLE,
    topicDescription: topic.description || undefined,
    existingVerifiedInsights: existingVerified,
    assessmentSummary: getAssessmentSummary(db) ?? undefined,
  })

  const insightsForStorage: AssessmentInsight[] = extracted.map(insight => ({
    category: insight.category,
    claim: insight.content,
    confidence: insight.confidenceScore,
    extractionMethod: insight.extractionMethod,
    kind: insight.kind,
    priorAlignment: insight.priorAlignment as PriorAlignment,
  }))

  storeAssessmentInsights(db, attemptId, {
    insights: insightsForStorage,
    agreements: [],
    contradictions: [],
    generated: true,
  }, {
    topicTitle: VALUES_TOPIC_TITLE,
    topicDescription: 'A guided conversation that maps concrete trade-offs onto Schwartz values.',
    tags: ['values', 'schwartz', 'assessment', 'identity'],
    notePrefix: 'Values profile',
    noteIntro: 'Generated from guided values assessment',
    sourceRef: `values:${attemptId}`,
    extraAnalysis: formatValuesAnalysis(mapping),
    contentJson: JSON.stringify(mapping),
  })
  } catch (error) {
    // Results are already stored; insight extraction is best-effort.
    console.warn('[me.md:values] insight extraction after mapping failed:', error)
  }

  scheduleSave()
  return { attemptId, ...mapping }
}

export function getValuesAttemptResults(db: Db, attemptId: string) {
  const attempt = db.select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, LOCAL_USER_ID)))
    .get()

  if (!attempt) throw new Error('Assessment attempt not found')
  if (attempt.status !== 'completed') throw new Error('Assessment not yet completed')
  if (attempt.assessmentType !== 'values') throw new Error('Assessment attempt is not Values')

  const rows = db.select()
    .from(assessmentResults)
    .where(eq(assessmentResults.attemptId, attemptId))
    .all()
  const values = valuesFromRows(rows).sort((a, b) => SCHWARTZ_KEYS.indexOf(a.key) - SCHWARTZ_KEYS.indexOf(b.key))
  const noteMeta = mappingMetaFromNote(db, attemptId)
  const dominant = noteMeta?.dominant.length ? noteMeta.dominant : deriveDominant(values)
  const leastActive = noteMeta?.least_active.length ? noteMeta.least_active : deriveLeastActive(values)

  return {
    attemptId,
    assessmentType: 'values' as const,
    status: attempt.status,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    values,
    dominant,
    least_active: leastActive,
  }
}

export function getLatestValues(db: Db) {
  const latestAttempt = db.select()
    .from(assessmentAttempts)
    .where(and(
      eq(assessmentAttempts.userId, LOCAL_USER_ID),
      eq(assessmentAttempts.status, 'completed'),
      eq(assessmentAttempts.assessmentType, 'values'),
    ))
    .orderBy(desc(assessmentAttempts.completedAt))
    .limit(1)
    .get()

  if (!latestAttempt) return null
  return getValuesAttemptResults(db, latestAttempt.id)
}

export function getValuesSummaryLine(db: Db): string | null {
  const latest = getLatestValues(db)
  if (!latest || latest.values.length === 0) return null
  const byKey = new Map(latest.values.map(value => [value.key, value]))
  const dominant = (latest.dominant.length ? latest.dominant : deriveDominant(latest.values))
    .map(key => byKey.get(key))
    .filter(Boolean)
  const leastActive = (latest.least_active.length ? latest.least_active : deriveLeastActive(latest.values))
    .map(key => byKey.get(key))
    .filter(Boolean)
  if (dominant.length === 0 || leastActive.length === 0) return null
  return `Values — strongest: ${dominant.map(value => `${valueKeyLabel(value!.key)} ${value!.score}`).join(', ')}; least active: ${leastActive.map(value => `${valueKeyLabel(value!.key)} ${value!.score}`).join(', ')}`
}

export function getValuesExportData(db: Db): {
  hasValues: boolean
  dominant: Array<{ key: SchwartzValue; label: string }>
  least_active: Array<{ key: SchwartzValue; label: string }>
  attemptId?: string
} {
  const latest = getLatestValues(db)
  if (!latest) return { hasValues: false, dominant: [], least_active: [] }
  return {
    hasValues: true,
    dominant: latest.dominant.map(key => ({ key, label: SCHWARTZ_LABELS[key] })),
    least_active: latest.least_active.map(key => ({ key, label: SCHWARTZ_LABELS[key] })),
    attemptId: latest.attemptId,
  }
}
