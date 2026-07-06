import { describe, expect, it } from 'vitest'
import {
  NO_TOPIC_KEY,
  PREVIEW_CHARS,
  PREVIEW_LIMIT,
  groupPendingInsights,
  truncatePreview,
  type GroupableInsight,
} from '../reviewGrouping'

function insight(overrides: Partial<GroupableInsight> & { id: string; content?: string }): GroupableInsight {
  return {
    id: overrides.id,
    topicId: 'topicId' in overrides ? overrides.topicId ?? null : 'topic-a',
    topicTitle: 'topicTitle' in overrides ? overrides.topicTitle ?? null : 'Work',
    sourceSessionId: 'sourceSessionId' in overrides ? overrides.sourceSessionId ?? null : null,
    content: 'content' in overrides ? overrides.content ?? '' : `Content for ${overrides.id}`,
  }
}

describe('review grouping', () => {
  it('returns no groups for an empty queue', () => {
    expect(groupPendingInsights([])).toEqual([])
  })

  it('groups a single import insight with count, preview, and origin', () => {
    expect(groupPendingInsights([insight({ id: 'ins-1', content: 'A clear preference.' })])).toEqual([
      {
        key: 'topic-a',
        name: 'Work',
        origin: 'import',
        count: 1,
        insightIds: ['ins-1'],
        preview: ['A clear preference.'],
      },
    ])
  })

  it('groups a single session insight as session origin', () => {
    expect(groupPendingInsights([insight({ id: 'ins-1', sourceSessionId: 'session-1' })])[0].origin).toBe('session')
  })

  it('keeps groups in stable first-appearance order', () => {
    const groups = groupPendingInsights([
      insight({ id: 'newest-b', topicId: 'topic-b', topicTitle: 'Home' }),
      insight({ id: 'newest-a', topicId: 'topic-a', topicTitle: 'Work' }),
      insight({ id: 'older-b', topicId: 'topic-b', topicTitle: 'Home' }),
    ])

    expect(groups.map(group => group.key)).toEqual(['topic-b', 'topic-a'])
  })

  it('uses the no-topic key and name when topic id is null', () => {
    expect(groupPendingInsights([insight({ id: 'ins-1', topicId: null, topicTitle: null })])[0]).toMatchObject({
      key: NO_TOPIC_KEY,
      name: 'No topic',
    })
  })

  it('falls back to no topic for null or blank topic titles', () => {
    const groups = groupPendingInsights([
      insight({ id: 'null-title', topicId: 'topic-a', topicTitle: null }),
      insight({ id: 'blank-title', topicId: 'topic-b', topicTitle: '   ' }),
    ])

    expect(groups.map(group => group.name)).toEqual(['No topic', 'No topic'])
  })

  it('marks a topic with import and session insights as mixed', () => {
    const groups = groupPendingInsights([
      insight({ id: 'imported', sourceSessionId: null }),
      insight({ id: 'session', sourceSessionId: 'session-1' }),
    ])

    expect(groups[0].origin).toBe('mixed')
  })

  it('caps previews and truncates long content with a single ellipsis', () => {
    const long = 'x'.repeat(PREVIEW_CHARS + 12)
    const group = groupPendingInsights([
      insight({ id: 'long', content: long }),
      insight({ id: 'short', content: 'Short content.' }),
      insight({ id: 'third', content: 'Third content.' }),
      insight({ id: 'fourth', content: 'Fourth content.' }),
    ])[0]

    expect(group.preview).toHaveLength(PREVIEW_LIMIT)
    expect(group.preview[0]).toBe(`${'x'.repeat(PREVIEW_CHARS)}…`)
    expect(group.preview[1]).toBe('Short content.')
    expect(truncatePreview('Already short')).toBe('Already short')
  })

  it('preserves insight ids in queue order', () => {
    const group = groupPendingInsights([
      insight({ id: 'ins-1' }),
      insight({ id: 'ins-2' }),
      insight({ id: 'ins-3' }),
    ])[0]

    expect(group.insightIds).toEqual(['ins-1', 'ins-2', 'ins-3'])
  })
})
