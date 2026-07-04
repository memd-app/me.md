import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from '@/db/schema'
import {
  createTopic,
  getTopics,
  getTopic,
  updateTopic,
  deleteTopic,
  getPresetTopics,
  selectPresetTopics,
  acceptTopicSuggestion,
  checkTopicTitle,
  createTopicConnections,
  PRESET_TOPICS,
} from '../topics'
import { CREATE_TABLES_SQL } from '@/db/database'

// Mock scheduleSave since IndexedDB is not available in Node
vi.mock('@/db/persistence', () => ({
  scheduleSave: vi.fn(),
}))

// Mock AI service (not needed for CRUD tests)
vi.mock('../ai', () => ({
  isAIAvailable: vi.fn().mockReturnValue(false),
  generatePersonalizedTopicSuggestions: vi.fn().mockResolvedValue(null),
}))


describe('topics service', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeAll(async () => {
    const SQL = await initSqlJs()
    const sqlDb = new SQL.Database()
    sqlDb.run('PRAGMA foreign_keys = ON;')
    sqlDb.run(CREATE_TABLES_SQL)
    db = drizzle(sqlDb, { schema })
  })

  beforeEach(() => {
    // Clean topics table before each test, then re-insert user
    db.run(`DELETE FROM topics`)
    db.run(`DELETE FROM users`)
    db.run(`INSERT OR IGNORE INTO users (id, name) VALUES ('local-user', 'Test User')`)
  })

  // ---- CRUD ----

  it('creates a topic and retrieves it', () => {
    const topic = createTopic(db, {
      title: 'Career Goals',
      description: 'My career aspirations',
      intent: 'explore',
    })
    expect(topic.title).toBe('Career Goals')
    expect(topic.id).toBeDefined()
    expect(topic.status).toBe('backlog')
    expect(topic.priority).toBe('medium')
    expect(topic.intent).toBe('explore')

    const fetched = getTopic(db, topic.id)
    expect(fetched?.title).toBe('Career Goals')
    expect(fetched?.insights).toEqual([])
    expect(fetched?.connectedTopics).toEqual([])
  })

  it('lists all topics for user', () => {
    createTopic(db, { title: 'Topic A' })
    createTopic(db, { title: 'Topic B' })
    const allTopics = getTopics(db)
    expect(allTopics.length).toBe(2)
  })

  it('updates a topic', () => {
    const topic = createTopic(db, { title: 'Old Title' })
    updateTopic(db, topic.id, { title: 'New Title' })
    const updated = getTopic(db, topic.id)
    expect(updated?.title).toBe('New Title')
  })

  it('deletes a topic', () => {
    const topic = createTopic(db, { title: 'Delete Me' })
    const result = deleteTopic(db, topic.id)
    expect(result.message).toBe('Topic deleted successfully')
    expect(result.topicTitle).toBe('Delete Me')
    const fetched = getTopic(db, topic.id)
    expect(fetched).toBeUndefined()
  })

  it('returns undefined for non-existent topic', () => {
    const fetched = getTopic(db, 'non-existent-id')
    expect(fetched).toBeUndefined()
  })

  // ---- Validation ----

  it('throws when creating topic with empty title', () => {
    expect(() => createTopic(db, { title: '' })).toThrow('Title is required')
  })

  it('throws when creating topic with title over 200 chars', () => {
    expect(() => createTopic(db, { title: 'x'.repeat(201) })).toThrow('too long')
  })

  it('throws for invalid status', () => {
    expect(() => createTopic(db, { title: 'Test', status: 'invalid' })).toThrow('Invalid status')
  })

  it('throws for invalid priority', () => {
    expect(() => createTopic(db, { title: 'Test', priority: 'invalid' })).toThrow('Invalid priority')
  })

  it('throws for invalid intent', () => {
    expect(() => createTopic(db, { title: 'Test', intent: 'invalid' })).toThrow('Invalid intent')
  })

  it('sanitizes tags on create', () => {
    const topic = createTopic(db, {
      title: 'Tagged',
      tags: [' Career ', 'GOALS', 'career'],
    })
    const parsed = JSON.parse(topic.tags!)
    expect(parsed).toEqual(['career', 'goals'])
  })

  // ---- Update validation ----

  it('throws when updating to empty title', () => {
    const topic = createTopic(db, { title: 'Valid' })
    expect(() => updateTopic(db, topic.id, { title: '' })).toThrow('Title cannot be empty')
  })

  it('throws when updating non-existent topic', () => {
    expect(() => updateTopic(db, 'fake-id', { title: 'Nope' })).toThrow('Topic not found')
  })

  it('throws when deleting non-existent topic', () => {
    expect(() => deleteTopic(db, 'fake-id')).toThrow('Topic not found')
  })

  // ---- Presets ----

  it('returns preset topics grouped by category', () => {
    const result = getPresetTopics(db)
    expect(result.presets.length).toBe(PRESET_TOPICS.length)
    expect(result.categories.identity.presets.length).toBeGreaterThan(0)
    expect(result.categories.goals.presets.length).toBeGreaterThan(0)
    // None should be selected yet
    expect(result.presets.every(p => !p.alreadySelected)).toBe(true)
  })

  it('selects preset topics and skips duplicates', () => {
    const firstTitle = PRESET_TOPICS[0].title
    const secondTitle = PRESET_TOPICS[1].title

    const result1 = selectPresetTopics(db, [firstTitle, secondTitle])
    expect(result1.count).toBe(2)

    // Select again - should skip duplicates
    const result2 = selectPresetTopics(db, [firstTitle])
    expect(result2.count).toBe(0)

    // Check preset status
    const presets = getPresetTopics(db)
    const selected = presets.presets.filter(p => p.alreadySelected)
    expect(selected.length).toBe(2)
  })

  it('throws when selecting with empty array', () => {
    expect(() => selectPresetTopics(db, [])).toThrow('Please select at least one topic')
  })

  // ---- Accept Suggestion ----

  it('accepts a topic suggestion', () => {
    const result = acceptTopicSuggestion(db, {
      title: 'AI Suggested Topic',
      description: 'A topic suggested by AI',
      category: 'skills',
      intent: 'explore',
      tags: ['ai', 'suggestion'],
      suggestedQuestion: 'Tell me about this.',
    })
    expect(result.topic.title).toBe('AI Suggested Topic')
    expect(result.topic.isPreset).toBe(false)
    expect(result.topic.presetCategory).toBe('skills')

    const fetched = getTopic(db, result.topic.id)
    expect(fetched?.title).toBe('AI Suggested Topic')
  })

  it('throws when accepting suggestion with empty title', () => {
    expect(() => acceptTopicSuggestion(db, { title: '' })).toThrow('Title is required')
  })

  // ---- Title Check ----

  it('detects duplicate titles', () => {
    createTopic(db, { title: 'Unique Topic' })
    const check = checkTopicTitle(db, 'unique topic') // case-insensitive
    expect(check.exists).toBe(true)
    expect(check.count).toBe(1)
  })

  it('reports no duplicates for new title', () => {
    const check = checkTopicTitle(db, 'Brand New Topic')
    expect(check.exists).toBe(false)
    expect(check.count).toBe(0)
  })

  // ---- Connections ----

  it('creates connections between topics', () => {
    const topicA = createTopic(db, { title: 'Topic A' })
    const topicB = createTopic(db, { title: 'Topic B' })

    const result = createTopicConnections(db, topicA.id, [
      { targetTopicId: topicB.id, relevanceScore: 75 },
    ])
    expect(result.count).toBe(1)
    expect(result.connections[0].relevanceScore).toBe(75)

    // Verify connection shows up in getTopic
    const fetched = getTopic(db, topicA.id)
    expect(fetched?.connectedTopics.length).toBe(1)
  })

  it('skips duplicate connections', () => {
    const topicA = createTopic(db, { title: 'Topic A' })
    const topicB = createTopic(db, { title: 'Topic B' })

    createTopicConnections(db, topicA.id, [
      { targetTopicId: topicB.id, relevanceScore: 50 },
    ])
    // Try to create same connection again
    const result = createTopicConnections(db, topicA.id, [
      { targetTopicId: topicB.id, relevanceScore: 80 },
    ])
    expect(result.count).toBe(0)
  })

  it('throws for connection from non-existent source topic', () => {
    expect(() => createTopicConnections(db, 'fake-id', [
      { targetTopicId: 'also-fake' },
    ])).toThrow('Source topic not found')
  })
})
