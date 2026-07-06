import { describe, expect, it } from 'vitest'
import { admitInsights, type ExtractedInsight, type ExistingInsightRef } from '../insightExtraction'

function candidate(content: string, confidenceScore = 80): ExtractedInsight {
  return {
    content,
    confidenceScore,
    category: 'identity',
    extractionMethod: 'fallback',
  }
}

function existing(
  id: string,
  content: string,
  verificationStatus: 'verified' | 'unverified' | 're_verification_pending',
): ExistingInsightRef {
  return { id, content, verificationStatus, evidenceCount: 0 }
}

describe('admitInsights', () => {
  it('drops duplicates of verified insights', () => {
    const result = admitInsights(
      [candidate('I prefer direct feedback when working on software projects.')],
      [existing('v-1', 'I prefer direct feedback when working on software projects', 'verified')],
      'import:one',
    )

    expect(result.admit).toEqual([])
    expect(result.attach).toEqual([])
    expect(result.drop).toMatchObject([{ reason: 'dup-verified', matchedId: 'v-1' }])
  })

  it('drops duplicates of pending insights', () => {
    const result = admitInsights(
      [candidate('I prefer direct feedback when working on software projects.')],
      [existing('p-1', 'I prefer direct feedback when working on software projects', 'unverified')],
      'import:one',
    )

    expect(result.admit).toEqual([])
    expect(result.attach).toEqual([])
    expect(result.drop).toMatchObject([{ reason: 'dup-pending', matchedId: 'p-1' }])
  })

  it('attaches near duplicates to pending insights only', () => {
    const result = admitInsights(
      [candidate('I prefer explicit feedback when working on software projects.')],
      [existing('p-1', 'I prefer direct feedback when working on software projects', 'unverified')],
      'session:s-1',
    )

    expect(result.admit).toEqual([])
    expect(result.drop).toEqual([])
    expect(result.attach).toMatchObject([{ targetId: 'p-1', sourceRef: 'session:s-1' }])
  })

  it('drops near duplicates of verified insights without attaching', () => {
    const result = admitInsights(
      [candidate('I prefer explicit feedback when working on software projects.')],
      [existing('v-1', 'I prefer direct feedback when working on software projects', 'verified')],
      'assessment:a-1',
    )

    expect(result.admit).toEqual([])
    expect(result.attach).toEqual([])
    expect(result.drop).toMatchObject([{ reason: 'neardup-verified', matchedId: 'v-1' }])
  })

  it('admits novel candidates', () => {
    const result = admitInsights(
      [candidate('Weekend hikes help me reset after stressful weeks.')],
      [existing('v-1', 'I prefer direct feedback when working on software projects', 'verified')],
      'import:one',
    )

    expect(result.admit).toHaveLength(1)
    expect(result.admit[0].content).toBe('Weekend hikes help me reset after stressful weeks.')
    expect(result.attach).toEqual([])
    expect(result.drop).toEqual([])
  })

  it('merges near-identical batch candidates as evidence', () => {
    const result = admitInsights(
      [
        candidate('I prefer direct feedback when working on software projects.', 70),
        candidate('I prefer explicit feedback when working on software projects.', 90),
      ],
      [],
      'import:one',
    )

    expect(result.admit).toHaveLength(1)
    expect(result.admit[0]).toMatchObject({
      content: 'I prefer explicit feedback when working on software projects.',
      confidenceScore: 90,
      evidenceCount: 1,
      evidenceSources: ['import:one'],
    })
    expect(result.attach).toEqual([])
    expect(result.drop).toMatchObject([{ reason: 'dup-batch' }])
  })

  it('admits all first-run candidates that are not batch duplicates', () => {
    const result = admitInsights(
      [
        candidate('I prefer direct feedback when working on software projects.'),
        candidate('Weekend hikes help me reset after stressful weeks.'),
      ],
      [],
      'import:first',
    )

    expect(result.admit.map(item => item.content)).toEqual([
      'I prefer direct feedback when working on software projects.',
      'Weekend hikes help me reset after stressful weeks.',
    ])
    expect(result.attach).toEqual([])
    expect(result.drop).toEqual([])
  })
})
