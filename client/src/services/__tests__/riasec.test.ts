import { describe, expect, it } from 'vitest'
import { hollandCode, scoreRiasec, RIASEC_ORDER, type RiasecQuestion } from '../riasec'

function makeQuestions(): RiasecQuestion[] {
  return RIASEC_ORDER.flatMap((domain, domainIndex) =>
    Array.from({ length: 10 }, (_, itemIndex) => ({
      id: `${domain}-${itemIndex + 1}`,
      text: `${domain} activity ${itemIndex + 1}`,
      keyed: 'plus' as const,
      domain,
      num: domainIndex * 10 + itemIndex + 1,
      choices: [1, 2, 3, 4, 5].map(score => ({ text: String(score), score, color: score })),
    })),
  )
}

describe('hollandCode', () => {
  it('returns RIA for a total tie by canonical order', () => {
    expect(hollandCode({ R: 30, I: 30, A: 30, S: 30, E: 30, C: 30 })).toBe('RIA')
  })

  it('orders clear top scales by descending score', () => {
    expect(hollandCode({ R: 12, I: 42, A: 27, S: 41, E: 19, C: 33 })).toBe('ISC')
  })

  it('breaks a tie between first and second canonically', () => {
    expect(hollandCode({ R: 40, I: 40, A: 35, S: 30, E: 25, C: 20 })).toBe('RIA')
  })
})

describe('scoreRiasec', () => {
  it('sums answers by scale and derives the Holland code', () => {
    const questions = makeQuestions()
    const targetScores = { R: 41, I: 38, A: 35, S: 22, E: 18, C: 12 }
    const answers = questions.map(question => {
      const domainQuestions = questions.filter(q => q.domain === question.domain)
      const index = domainQuestions.findIndex(q => q.id === question.id)
      const base = Math.floor(targetScores[question.domain] / 10)
      const remainder = targetScores[question.domain] % 10
      return {
        questionId: question.id,
        answerValue: base + (index < remainder ? 1 : 0),
      }
    })

    expect(scoreRiasec(answers, questions)).toEqual({
      scales: targetScores,
      code: 'RIA',
    })
  })

  it('uses canonical order when all answers are unsure', () => {
    const questions = makeQuestions()
    const answers = questions.map(question => ({ questionId: question.id, answerValue: 3 }))

    const result = scoreRiasec(answers, questions)

    expect(result.scales).toEqual({ R: 30, I: 30, A: 30, S: 30, E: 30, C: 30 })
    expect(result.code).toBe('RIA')
  })

  it('uses canonical order when two scales tie for the third slot', () => {
    const result = hollandCode({ R: 45, I: 44, A: 30, S: 30, E: 10, C: 10 })

    expect(result).toBe('RIA')
  })

  it('keeps complete scale sums inside the 10 to 50 range', () => {
    const questions = makeQuestions()
    const answers = questions.map(question => ({ questionId: question.id, answerValue: question.domain === 'R' ? 5 : 1 }))

    const result = scoreRiasec(answers, questions)

    for (const score of Object.values(result.scales)) {
      expect(score).toBeGreaterThanOrEqual(10)
      expect(score).toBeLessThanOrEqual(50)
    }
  })
})
