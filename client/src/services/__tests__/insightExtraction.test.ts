import { describe, expect, it, vi } from 'vitest'
import {
  extractInsights,
  KIND_TO_CATEGORY,
  MIN_SELF_RELEVANCE,
  normalizeAiCandidates,
  selfReferenceGate,
} from '../insightExtraction'

vi.mock('../anthropic', () => ({
  isApiKeyConfigured: vi.fn().mockReturnValue(false),
  callAnthropic: vi.fn(),
}))

const allowedCategories = ['identity', 'skills', 'experiences', 'perspectives', 'goals']

describe('KIND_TO_CATEGORY', () => {
  it('maps every insight kind to an existing category', () => {
    const kinds = [
      'belief',
      'value',
      'trait',
      'habit',
      'preference',
      'goal',
      'motivation',
      'relationship_pattern',
      'self_assessment',
    ]

    expect(Object.keys(KIND_TO_CATEGORY).sort()).toEqual(kinds.sort())
    expect(Object.values(KIND_TO_CATEGORY).every(category => allowedCategories.includes(category))).toBe(true)
  })
})

describe('normalizeAiCandidates', () => {
  it('keeps self-relevant items at the threshold and drops items below it', () => {
    const { kept, droppedByPersonhood } = normalizeAiCandidates([
      {
        content: 'Prefers written communication over meetings.',
        confidenceScore: 80,
        kind: 'preference',
        self_relevance: MIN_SELF_RELEVANCE - 1,
      },
      {
        content: 'Approaches problems methodically rather than intuitively.',
        confidenceScore: 84,
        kind: 'trait',
        self_relevance: MIN_SELF_RELEVANCE,
      },
    ])

    expect(kept).toEqual([
      {
        content: 'Approaches problems methodically rather than intuitively.',
        confidenceScore: 84,
        category: KIND_TO_CATEGORY.trait,
      },
    ])
    expect(droppedByPersonhood).toBe(1)
  })

  it('drops missing or invalid kinds and derives category from kind', () => {
    const { kept, droppedByPersonhood } = normalizeAiCandidates([
      {
        content: 'Values honesty over harmony when giving feedback.',
        confidenceScore: 88,
        self_relevance: 95,
      },
      {
        content: 'Maintains a personal knowledge vault.',
        confidenceScore: 72,
        kind: 'fact',
        self_relevance: 70,
      },
      {
        content: 'Considers himself a strong starter but a weak finisher.',
        confidenceScore: 86,
        kind: 'self_assessment',
        self_relevance: 92,
        category: 'goals',
      },
    ])

    expect(kept).toEqual([
      {
        content: 'Considers himself a strong starter but a weak finisher.',
        confidenceScore: 86,
        category: KIND_TO_CATEGORY.self_assessment,
      },
    ])
    expect(droppedByPersonhood).toBe(2)
  })

  it('ignores malformed items without counting them as personhood drops', () => {
    const { kept, droppedByPersonhood } = normalizeAiCandidates([
      null,
      'not an object',
      { confidenceScore: 70, kind: 'trait', self_relevance: 90 },
      { content: 'Believes small teams outperform large ones.', confidenceScore: 'high', kind: 'belief', self_relevance: 90 },
    ])

    expect(kept).toEqual([])
    expect(droppedByPersonhood).toBe(0)
  })
})

describe('selfReferenceGate', () => {
  it.each([
    [
      'Runs automated weekly harvest processes over their personal knowledge vault that cross-check multiple memory sources',
      'system',
    ],
    ['Migrated the database to a new server last week', 'system'],
    ['I believe small teams move faster than large ones', 'self'],
    ['I run a weekly review of my own commitments', 'self'],
    ['Prefers written communication over meetings', 'frame'],
    ['Builds redundant verification into systems he depends on - distrusts single sources of truth', 'frame'],
    ['Grew up in a small coastal town in Portugal', 'neutral'],
    ['The server always restarts at midnight', 'system'],
  ] as const)('classifies "%s" as %s', (content, verdict) => {
    expect(selfReferenceGate(content)).toBe(verdict)
  })
})

describe('fallback extraction personhood gate', () => {
  it('drops system sentences while keeping first-person self-knowledge', async () => {
    const results = await extractInsights({
      sourceType: 'import_text',
      content: [
        'Runs automated weekly harvest processes over their personal knowledge vault that cross-check multiple memory sources.',
        'I value tools I can inspect and repair myself.',
      ].join('\n'),
    })

    expect(results.map(result => result.content)).not.toContain(
      'Runs automated weekly harvest processes over their personal knowledge vault that cross-check multiple memory sources.',
    )
    expect(results).toContainEqual(expect.objectContaining({
      content: 'I value tools I can inspect and repair myself.',
      extractionMethod: 'fallback',
    }))
    expect(results.every(result => result.confidenceScore <= 45)).toBe(true)
  })
})
