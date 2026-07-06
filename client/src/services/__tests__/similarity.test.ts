import { describe, expect, it } from 'vitest'
import {
  DUPLICATE_THRESHOLD,
  NEAR_DUP_THRESHOLD,
  combinedScore,
  jaroWinkler,
  normalizeInsight,
  tokenSetRatio,
} from '../similarity'

describe('similarity service', () => {
  describe('jaroWinkler', () => {
    it('scores identical strings as 1', () => {
      expect(jaroWinkler('direct feedback', 'direct feedback')).toBe(1)
    })

    it('scores disjoint strings low', () => {
      expect(jaroWinkler('abc', 'xyz')).toBeLessThan(0.3)
    })

    it('is symmetric', () => {
      const a = 'I prefer direct feedback'
      const b = 'I prefer explicit feedback'
      expect(jaroWinkler(a, b)).toBe(jaroWinkler(b, a))
    })
  })

  it('normalizes insight text by stripping punctuation, case, stopwords, and whitespace', () => {
    expect(normalizeInsight('  This, is MY direct-feedback   style!  ')).toBe('direct feedback style')
  })

  describe('tokenSetRatio', () => {
    it('scores identical token sets as 1', () => {
      expect(tokenSetRatio('I value direct feedback', 'direct feedback is what I value')).toBe(1)
    })

    it('scores disjoint token sets as 0', () => {
      expect(tokenSetRatio('direct feedback', 'quiet mornings')).toBe(0)
    })

    it('scores partial overlap as Jaccard', () => {
      expect(tokenSetRatio('direct feedback systems', 'direct planning systems')).toBeCloseTo(0.5)
    })
  })

  describe('combinedScore', () => {
    it('scores identical and punctuation-only variants as duplicates', () => {
      expect(combinedScore('I prefer direct feedback.', 'I prefer direct feedback')).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD)
      expect(combinedScore('Direct, explicit feedback!', 'direct explicit feedback')).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD)
    })

    it('scores near variants in the near-duplicate band', () => {
      const score = combinedScore(
        'I prefer direct feedback when working on software projects',
        'I prefer explicit feedback when working on software projects',
      )
      expect(score).toBeGreaterThanOrEqual(NEAR_DUP_THRESHOLD)
      expect(score).toBeLessThan(DUPLICATE_THRESHOLD)
    })

    it('scores unrelated sentences below the near-duplicate threshold', () => {
      expect(combinedScore(
        'I prefer direct feedback when working on software projects',
        'Weekend hikes help me reset after stressful weeks',
      )).toBeLessThan(NEAR_DUP_THRESHOLD)
    })
  })
})
