import { describe, expect, it, vi } from 'vitest'
import {
  extractInsights,
  KIND_TO_CATEGORY,
  KNOWN_PROFILE_CAP,
  MIN_SELF_RELEVANCE,
  normalizeAiCandidates,
  selectKnownProfileInsights,
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
        kind: 'trait',
        category: KIND_TO_CATEGORY.trait,
        priorAlignment: 'novel',
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
        kind: 'self_assessment',
        category: KIND_TO_CATEGORY.self_assessment,
        priorAlignment: 'novel',
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

  it('caps tension confidence and keeps corroborated confidence', () => {
    const { kept } = normalizeAiCandidates([
      {
        content: 'Prefers direct disagreement over quiet consensus.',
        confidenceScore: 90,
        kind: 'preference',
        self_relevance: 90,
        prior_alignment: 'tension',
      },
      {
        content: 'Values concise written communication.',
        confidenceScore: 80,
        kind: 'value',
        self_relevance: 90,
        prior_alignment: 'corroborated',
      },
    ])

    expect(kept).toEqual([
      {
        content: 'Prefers direct disagreement over quiet consensus.',
        confidenceScore: 60,
        kind: 'preference',
        category: KIND_TO_CATEGORY.preference,
        priorAlignment: 'tension',
      },
      {
        content: 'Values concise written communication.',
        confidenceScore: 80,
        kind: 'value',
        category: KIND_TO_CATEGORY.value,
        priorAlignment: 'corroborated',
      },
    ])
  })

  it('defaults missing or unknown prior alignment to novel without capping confidence', () => {
    const { kept } = normalizeAiCandidates([
      {
        content: 'Keeps decisions explicit before acting.',
        confidenceScore: 92,
        kind: 'habit',
        self_relevance: 90,
      },
      {
        content: 'Prefers clear ownership boundaries.',
        confidenceScore: 89,
        kind: 'preference',
        self_relevance: 90,
        prior_alignment: 'unclear',
      },
    ])

    expect(kept.map(item => ({ confidenceScore: item.confidenceScore, priorAlignment: item.priorAlignment }))).toEqual([
      { confidenceScore: 92, priorAlignment: 'novel' },
      { confidenceScore: 89, priorAlignment: 'novel' },
    ])
  })
})

describe('selectKnownProfileInsights', () => {
  it('caps known profile insights', () => {
    const verified = Array.from({ length: 40 }, (_, index) => ({
      content: `Verified profile insight ${index}`,
      confidenceScore: index,
    }))

    expect(selectKnownProfileInsights(verified, 'profile')).toHaveLength(KNOWN_PROFILE_CAP)
  })

  it('ranks topic-token overlap before input order and confidence for equal overlap', () => {
    const selected = selectKnownProfileInsights([
      { content: 'Prefers quiet reflective work.', confidenceScore: 95 },
      { content: 'Values product strategy conversations.', confidenceScore: 70 },
      { content: 'Uses product strategy to choose work.', confidenceScore: 90 },
    ], 'Product strategy', 3)

    expect(selected.map(item => item.content)).toEqual([
      'Uses product strategy to choose work.',
      'Values product strategy conversations.',
      'Prefers quiet reflective work.',
    ])
  })

  it('orders by confidence when topic title is empty', () => {
    const selected = selectKnownProfileInsights([
      { content: 'First low confidence item.', confidenceScore: 40 },
      { content: 'Second high confidence item.', confidenceScore: 90 },
      { content: 'Third medium confidence item.', confidenceScore: 70 },
    ], undefined, 2)

    expect(selected.map(item => item.confidenceScore)).toEqual([90, 70])
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
      kind: null,
    }))
    expect(results.every(result => result.confidenceScore <= 45)).toBe(true)
  })
})
