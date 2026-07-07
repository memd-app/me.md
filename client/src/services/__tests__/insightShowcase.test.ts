import { describe, expect, it } from 'vitest'
import {
  extractStandfirst,
  selectShowcase,
  splitFacetBody,
  type ShowcaseInsight,
} from '../insightShowcase'

function insight(overrides: Partial<ShowcaseInsight> = {}): ShowcaseInsight {
  return {
    id: overrides.id ?? 'insight-1',
    content: overrides.content ?? 'This is a verified insight with enough words to be quoted clearly.',
    kind: 'kind' in overrides ? overrides.kind ?? null : 'belief',
    confidenceScore: overrides.confidenceScore ?? 80,
    priorAlignment: 'priorAlignment' in overrides ? overrides.priorAlignment ?? null : 'corroborated',
    evidenceCount: overrides.evidenceCount ?? 1,
    topicTitle: 'topicTitle' in overrides ? overrides.topicTitle ?? null : null,
  }
}

describe('selectShowcase', () => {
  it('picks the highest-confidence corroborated insight per kind and excludes novel or tension from quotes', () => {
    const selection = selectShowcase([
      insight({ id: 'belief-low', kind: 'belief', confidenceScore: 60 }),
      insight({ id: 'belief-high', kind: 'belief', confidenceScore: 95 }),
      insight({ id: 'value-novel', kind: 'value', confidenceScore: 99, priorAlignment: 'novel' }),
      insight({ id: 'trait-tension', kind: 'trait', confidenceScore: 98, priorAlignment: 'tension' }),
      insight({ id: 'habit-cor', kind: 'habit', confidenceScore: 70 }),
    ])

    expect(selection.quotes.map(item => item.id)).toEqual(['belief-high', 'habit-cor'])
    expect(selection.quotes.every(item => item.priorAlignment === 'corroborated')).toBe(true)
  })

  it('caps quotes at 6 when 7 or more kinds have corroborated picks and orders them best-first', () => {
    const selection = selectShowcase([
      insight({ id: 'belief-70', kind: 'belief', confidenceScore: 70 }),
      insight({ id: 'value-90', kind: 'value', confidenceScore: 90 }),
      insight({ id: 'trait-80', kind: 'trait', confidenceScore: 80 }),
      insight({ id: 'habit-60', kind: 'habit', confidenceScore: 60 }),
      insight({ id: 'preference-95', kind: 'preference', confidenceScore: 95 }),
      insight({ id: 'goal-75', kind: 'goal', confidenceScore: 75 }),
      insight({ id: 'motivation-85', kind: 'motivation', confidenceScore: 85 }),
    ])

    expect(selection.quotes.map(item => item.id)).toEqual([
      'preference-95',
      'value-90',
      'motivation-85',
      'trait-80',
      'goal-75',
      'belief-70',
    ])
  })

  it('uses deterministic tie-breaks and returns identical output for shuffled input', () => {
    const source = [
      insight({ id: 'belief-low-evidence', kind: 'belief', confidenceScore: 80, evidenceCount: 1 }),
      insight({ id: 'belief-high-evidence', kind: 'belief', confidenceScore: 80, evidenceCount: 4 }),
      insight({ id: 'a-trait', kind: 'trait', confidenceScore: 75, evidenceCount: 2, content: 'Same length content for comparing ids exactly.' }),
      insight({ id: 'b-trait', kind: 'trait', confidenceScore: 75, evidenceCount: 2, content: 'Same length content for comparing ids exactly.' }),
      insight({ id: 'value-shorter', kind: 'value', confidenceScore: 70, evidenceCount: 1, content: 'Shorter tied content still long enough to be quoted.' }),
      insight({ id: 'value-longer', kind: 'value', confidenceScore: 70, evidenceCount: 1, content: 'Longer tied content remains quotable but loses because the shorter one wins.' }),
    ]

    const first = selectShowcase(source)
    const shuffled = selectShowcase([source[5], source[2], source[0], source[4], source[3], source[1]])

    expect(first.quotes.map(item => item.id)).toEqual(['belief-high-evidence', 'a-trait', 'value-shorter'])
    expect(shuffled).toEqual(first)
  })

  it('excludes 39-character and 281-character contents while including 40 and 280', () => {
    const selection = selectShowcase([
      insight({ id: 'too-short', kind: 'belief', content: 'x'.repeat(39), confidenceScore: 99 }),
      insight({ id: 'min', kind: 'belief', content: 'x'.repeat(40), confidenceScore: 80 }),
      insight({ id: 'too-long', kind: 'value', content: 'x'.repeat(281), confidenceScore: 99 }),
      insight({ id: 'max', kind: 'value', content: 'x'.repeat(280), confidenceScore: 70 }),
    ])

    expect(selection.quotes.map(item => item.id)).toEqual(['min', 'max'])
  })

  it('builds a tension pair with same-kind, same-topic, or null counterpart and never uses a tension counterpart', () => {
    const sameKind = selectShowcase([
      insight({ id: 'tension', kind: 'goal', priorAlignment: 'tension', confidenceScore: 90, topicTitle: 'Work' }),
      insight({ id: 'same-kind', kind: 'goal', priorAlignment: 'corroborated', confidenceScore: 70, topicTitle: 'Other' }),
      insight({ id: 'same-topic', kind: 'belief', priorAlignment: 'corroborated', confidenceScore: 99, topicTitle: 'Work' }),
      insight({ id: 'other-tension', kind: 'goal', priorAlignment: 'tension', confidenceScore: 95, topicTitle: 'Work' }),
    ])

    const sameTopic = selectShowcase([
      insight({ id: 'tension', kind: null, priorAlignment: 'tension', confidenceScore: 90, topicTitle: 'Work' }),
      insight({ id: 'same-topic', kind: 'belief', priorAlignment: 'corroborated', confidenceScore: 99, topicTitle: 'Work' }),
      insight({ id: 'same-topic-tension', kind: 'belief', priorAlignment: 'tension', confidenceScore: 80, topicTitle: 'Work' }),
    ])

    const alone = selectShowcase([
      insight({ id: 'tension', kind: null, priorAlignment: 'tension', confidenceScore: 90, topicTitle: null }),
      insight({ id: 'unrelated', kind: 'belief', priorAlignment: 'corroborated', confidenceScore: 99, topicTitle: 'Other' }),
    ])

    expect(sameKind.tensionPair?.tension.id).toBe('other-tension')
    expect(sameKind.tensionPair?.counterpart?.id).toBe('same-kind')
    expect(sameTopic.tensionPair?.counterpart?.id).toBe('same-topic')
    expect(alone.tensionPair?.counterpart).toBeNull()
  })

  it('removes a counterpart from quotes without backfilling', () => {
    const selection = selectShowcase([
      insight({ id: 'belief-counterpart', kind: 'belief', confidenceScore: 99, topicTitle: 'Work' }),
      insight({ id: 'value-quote', kind: 'value', confidenceScore: 98 }),
      insight({ id: 'trait-quote', kind: 'trait', confidenceScore: 97 }),
      insight({ id: 'habit-quote', kind: 'habit', confidenceScore: 96 }),
      insight({ id: 'preference-quote', kind: 'preference', confidenceScore: 95 }),
      insight({ id: 'goal-quote', kind: 'goal', confidenceScore: 94 }),
      insight({ id: 'motivation-backfill', kind: 'motivation', confidenceScore: 93 }),
      insight({ id: 'tension', kind: 'belief', priorAlignment: 'tension', confidenceScore: 90, topicTitle: 'Work' }),
    ])

    expect(selection.tensionPair?.counterpart?.id).toBe('belief-counterpart')
    expect(selection.quotes.map(item => item.id)).toEqual([
      'value-quote',
      'trait-quote',
      'habit-quote',
      'preference-quote',
      'goal-quote',
    ])
  })

  it('returns an empty selection for empty input', () => {
    expect(selectShowcase([])).toEqual({ quotes: [], tensionPair: null })
  })
})

describe('extractStandfirst', () => {
  it('strips heading, bold markers, list markers, and blockquote marks before taking the first sentence', () => {
    const body = [
      '### Identity & Values',
      '> - **Directness** matters in how decisions get made. A second sentence stays out.',
    ].join('\n')

    expect(extractStandfirst(body)).toBe('Directness matters in how decisions get made.')
  })

  it('returns the first sentence from a portrait essay opening', () => {
    const body = 'You choose careful directness when ambiguity would otherwise sprawl. The next sentence belongs in the body, not the standfirst.'

    expect(extractStandfirst(body)).toBe('You choose careful directness when ambiguity would otherwise sprawl.')
  })

  it('returns null for empty or missing body', () => {
    expect(extractStandfirst(null)).toBeNull()
    expect(extractStandfirst('### Heading\n\n> - **')).toBeNull()
  })

  it('returns null when the first sentence is oversized', () => {
    expect(extractStandfirst(`${'x'.repeat(221)}. Second sentence.`)).toBeNull()
  })
})

describe('splitFacetBody', () => {
  it('splits body at the first Tensions heading and drops the heading line', () => {
    const result = splitFacetBody('Main paragraph.\n\n### Tensions & open questions\nThin evidence here.\nMore context.')

    expect(result).toEqual({
      main: 'Main paragraph.',
      tensions: 'Thin evidence here.\nMore context.',
    })
  })

  it('matches the Tensions heading case-insensitively', () => {
    expect(splitFacetBody('Main.\n### tensions\nOpen item.')).toEqual({
      main: 'Main.',
      tensions: 'Open item.',
    })
  })

  it('returns the full body and null tensions when no non-empty Tensions section exists', () => {
    expect(splitFacetBody('Main only.')).toEqual({ main: 'Main only.', tensions: null })
    expect(splitFacetBody('Main.\n### Tensions\n   ')).toEqual({ main: 'Main.', tensions: null })
  })
})
