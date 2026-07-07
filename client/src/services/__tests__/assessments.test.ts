import { beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { CREATE_TABLES_SQL } from '@/db/database'
import { startAssessment, submitAnswers } from '../assessment'
import { completeRiasecAttempt, getRiasecAttemptResults, hollandCode, RIASEC_ORDER } from '../riasec'
import { callAnthropic, isApiKeyConfigured } from '../anthropic'
import {
  getAssessmentSummary,
  getBigFiveSummaryLine,
  getRiasecSummaryLine,
  getValuesSummaryLine,
} from '../profile'
import {
  completeValuesAssessment,
  getValuesAttemptResults,
  SCHWARTZ_KEYS,
  VALUES_TOPIC_TITLE,
} from '../values'

vi.mock('../anthropic', () => ({
  isApiKeyConfigured: vi.fn(),
  callAnthropic: vi.fn(),
}))

describe('generalized assessments', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeEach(async () => {
    const SQL = await initSqlJs()
    const sqlDb = new SQL.Database()
    sqlDb.run(CREATE_TABLES_SQL)
    db = drizzle(sqlDb, { schema })
    db.run("INSERT INTO users (id, name) VALUES ('local-user', 'Test User')")
    vi.mocked(isApiKeyConfigured).mockReturnValue(false)
    vi.mocked(callAnthropic).mockReset()
  })

  it('round-trips a RIASEC attempt through shared attempts and results', async () => {
    const started = startAssessment(db, 'en', 'riasec')
    const answers = started.questions.map((question: any) => ({
      questionId: question.id,
      answerValue: question.domain === 'R' ? 5 : question.domain === 'I' ? 4 : 3,
    }))

    submitAnswers(db, started.attemptId, answers)
    const completed = await completeRiasecAttempt(db, started.attemptId)
    const attemptRow = db.select().from(schema.assessmentAttempts).where(eq(schema.assessmentAttempts.id, started.attemptId)).get()
    const results = getRiasecAttemptResults(db, started.attemptId)

    expect(attemptRow?.assessmentType).toBe('riasec')
    expect(completed.code).toBe(hollandCode(completed.scales))
    expect(results.scales).toHaveLength(6)
    expect(results.code).toBe(completed.code)
    expect(results.scales.map(scale => scale.domain)).toEqual([...RIASEC_ORDER])
  })

  it('composes assessment summary lines from available assessment types', () => {
    const completedAt = '2026-07-07T10:00:00.000Z'
    db.run(`
      INSERT INTO assessment_attempts (id, user_id, status, completed_at, assessment_type)
      VALUES
        ('bigfive-1', 'local-user', 'completed', '${completedAt}', 'bigfive'),
        ('riasec-1', 'local-user', 'completed', '${completedAt}', 'riasec'),
        ('values-1', 'local-user', 'completed', '${completedAt}', 'values')
    `)
    db.run(`
      INSERT INTO assessment_results (id, attempt_id, domain, domain_score, facet1_score, facet2_score, facet3_score, facet4_score, facet5_score, facet6_score, detail)
      VALUES
        ('bf-o', 'bigfive-1', 'O', 96, 16, 16, 16, 16, 16, 16, NULL),
        ('bf-c', 'bigfive-1', 'C', 72, 12, 12, 12, 12, 12, 12, NULL),
        ('bf-e', 'bigfive-1', 'E', 72, 12, 12, 12, 12, 12, 12, NULL),
        ('bf-a', 'bigfive-1', 'A', 72, 12, 12, 12, 12, 12, 12, NULL),
        ('bf-n', 'bigfive-1', 'N', 72, 12, 12, 12, 12, 12, 12, NULL),
        ('r-r', 'riasec-1', 'R', 41, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        ('r-i', 'riasec-1', 'I', 38, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        ('r-a', 'riasec-1', 'A', 35, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        ('r-s', 'riasec-1', 'S', 20, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        ('r-e', 'riasec-1', 'E', 19, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        ('r-c', 'riasec-1', 'C', 18, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        ('v-self', 'values-1', 'self_direction', 82, NULL, NULL, NULL, NULL, NULL, NULL, 'Independent choices.'),
        ('v-bene', 'values-1', 'benevolence', 79, NULL, NULL, NULL, NULL, NULL, NULL, 'Care for close people.'),
        ('v-power', 'values-1', 'power', 21, NULL, NULL, NULL, NULL, NULL, NULL, 'Low status signal.'),
        ('v-trad', 'values-1', 'tradition', 24, NULL, NULL, NULL, NULL, NULL, NULL, 'Low inherited custom signal.')
    `)

    expect(getBigFiveSummaryLine(db)).toContain('Openness to Experience 4.0 (High)')
    expect(getRiasecSummaryLine(db)).toBe('Holland code RIA — Realistic 41, Investigative 38, Artistic 35 (top scales of 6)')
    expect(getValuesSummaryLine(db)).toBe('Values — strongest: self-direction 82, benevolence 79; least active: power 21, tradition 24')
    expect(getAssessmentSummary(db)).toContain('Big Five: Openness to Experience')
    expect(getAssessmentSummary(db)).toContain('Interests: Holland code RIA')
    expect(getAssessmentSummary(db)).toContain('Values: Values — strongest')
  })

  it('stores guided Values results with detail rationales and recovers note metadata', async () => {
    vi.mocked(isApiKeyConfigured).mockReturnValue(true)
    const mapping = {
      values: SCHWARTZ_KEYS.map((key, index) => ({
        key,
        score: 100 - index * 7,
        rationale: `Transcript evidence for ${key}.`,
      })),
      dominant: ['self_direction', 'stimulation'],
      least_active: ['benevolence', 'universalism'],
    }
    vi.mocked(callAnthropic)
      .mockResolvedValueOnce(JSON.stringify(mapping))
      .mockResolvedValueOnce('[]')

    db.run(`
      INSERT INTO topics (id, user_id, title, description)
      VALUES ('values-topic', 'local-user', '${VALUES_TOPIC_TITLE}', 'Values assessment')
    `)
    db.run(`
      INSERT INTO sessions (id, topic_id, user_id, status)
      VALUES ('values-session', 'values-topic', 'local-user', 'active')
    `)
    db.run(`
      INSERT INTO messages (id, session_id, role, content)
      VALUES
        ('assistant-1', 'values-session', 'assistant', 'What have you refused to trade away?'),
        ('user-1', 'values-session', 'user', 'I turned down a role because it would cost me autonomy.'),
        ('assistant-2', 'values-session', 'assistant', 'What did that protect?'),
        ('user-2', 'values-session', 'user', 'It protected the ability to choose my own standards.')
    `)

    const completed = await completeValuesAssessment(db, 'values-session')
    const results = getValuesAttemptResults(db, completed.attemptId)
    const detailRows = db.select().from(schema.assessmentResults).where(eq(schema.assessmentResults.attemptId, completed.attemptId)).all()

    expect(completed.dominant).toEqual(['self_direction', 'stimulation'])
    expect(results.values).toHaveLength(10)
    expect(results.values[0].rationale).toContain('Transcript evidence')
    expect(results.dominant).toEqual(['self_direction', 'stimulation'])
    expect(results.least_active).toEqual(['benevolence', 'universalism'])
    expect(detailRows.every(row => typeof row.detail === 'string' && row.detail.length > 0)).toBe(true)
  })

  it('returns null when no assessment summaries exist', () => {
    expect(getAssessmentSummary(db)).toBeNull()
  })
})
