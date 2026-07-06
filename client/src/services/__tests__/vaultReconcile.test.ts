import { describe, expect, it } from 'vitest'
import { stableHash } from '../obsidianExport'
import {
  assembleNote,
  classifyReconcile,
  extractInsightBody,
  hashBody,
  normalizeBody,
  parseNote,
} from '../vaultReconcile'

const generatedNote = (body: string, frontmatter = 'title: "A"\nsource: "me.md"\nid: "ins-a"') => [
  '---',
  frontmatter,
  '---',
  '',
  body,
  '',
  'Topic: [[Topic - Work]]',
  '',
].join('\n')

describe('vault reconcile core', () => {
  it('parses frontmatter without changing key order', () => {
    const parsed = parseNote([
      '---',
      'title: "Direct feedback"',
      'topic: "Communication"',
      'confidence: 82',
      'source: "me.md"',
      '---',
      '',
      'I prefer direct feedback.',
      '',
      'Topic: [[Topic - Communication]]',
      '',
    ].join('\n'))

    expect(parsed.hasFrontmatter).toBe(true)
    expect(parsed.frontmatter).toEqual([
      ['title', '"Direct feedback"'],
      ['topic', '"Communication"'],
      ['confidence', '82'],
      ['source', '"me.md"'],
    ])
    expect(parsed.body).toContain('I prefer direct feedback.')
  })

  it('extracts the human-owned body zone and ignores machine trailer/index lines', () => {
    const content = [
      '---',
      'title: "A"',
      '---',
      '',
      'Human text.   ',
      '',
      'More text.',
      '',
      'Topic: [[Topic - Work]]',
      '',
      '[[Me - Index]]',
      '',
    ].join('\n')

    expect(extractInsightBody(content)).toBe('Human text.\n\nMore text.')
  })

  it('normalizes body whitespace before hashing', () => {
    expect(normalizeBody('  First line  \nSecond line\t\n\n')).toBe('First line\nSecond line')
    expect(hashBody('First line\nSecond line')).toBe(hashBody('First line  \nSecond line\n\n'))
  })

  it('classifies a missing disk note as recreate', () => {
    expect(classifyReconcile({
      dbBody: 'Body',
      diskContent: null,
      baseBodyHash: hashBody('Body'),
      dbContentHash: 'new',
      lastContentHash: 'old',
    })).toBe('recreate')
  })

  it('adopts a first-sync note when disk and database bodies match', () => {
    expect(classifyReconcile({
      dbBody: 'Body',
      diskContent: generatedNote('Body'),
      baseBodyHash: null,
      dbContentHash: stableHash(generatedNote('Body')),
      lastContentHash: null,
    })).toBe('adopt')
  })

  it('lets the vault win on first sync when disk and database bodies diverge', () => {
    expect(classifyReconcile({
      dbBody: 'Database body',
      diskContent: generatedNote('Vault body'),
      baseBodyHash: null,
      dbContentHash: stableHash(generatedNote('Database body')),
      lastContentHash: null,
    })).toBe('vault-wins')
  })

  it('returns noop when neither body nor generated content changed', () => {
    const content = generatedNote('Body')

    expect(classifyReconcile({
      dbBody: 'Body',
      diskContent: content,
      baseBodyHash: hashBody('Body'),
      dbContentHash: stableHash(content),
      lastContentHash: stableHash(content),
    })).toBe('noop')
  })

  it('detects metadata-only drift when the body is unchanged', () => {
    expect(classifyReconcile({
      dbBody: 'Body',
      diskContent: generatedNote('Body', 'title: "Old"\nconfidence: 60'),
      baseBodyHash: hashBody('Body'),
      dbContentHash: stableHash(generatedNote('Body', 'title: "New"\nconfidence: 90')),
      lastContentHash: stableHash(generatedNote('Body', 'title: "Old"\nconfidence: 60')),
    })).toBe('metadata')
  })

  it('lets the vault win when only the disk body changed', () => {
    expect(classifyReconcile({
      dbBody: 'Base',
      diskContent: generatedNote('Vault changed'),
      baseBodyHash: hashBody('Base'),
      dbContentHash: stableHash(generatedNote('Base')),
      lastContentHash: stableHash(generatedNote('Base')),
    })).toBe('vault-wins')
  })

  it('lets the app win when only the database body changed', () => {
    expect(classifyReconcile({
      dbBody: 'App changed',
      diskContent: generatedNote('Base'),
      baseBodyHash: hashBody('Base'),
      dbContentHash: stableHash(generatedNote('App changed')),
      lastContentHash: stableHash(generatedNote('Base')),
    })).toBe('app-wins')
  })

  it('reports conflict when both bodies changed since the base', () => {
    expect(classifyReconcile({
      dbBody: 'App changed',
      diskContent: generatedNote('Vault changed'),
      baseBodyHash: hashBody('Base'),
      dbContentHash: stableHash(generatedNote('App changed')),
      lastContentHash: stableHash(generatedNote('Base')),
    })).toBe('conflict')
  })

  it('assembles a re-stamped note from database metadata and resolved body', () => {
    const merged = assembleNote({
      id: 'ins-alpha123',
      content: 'Database title source. This body is not used.',
      confidenceScore: 91,
      verifiedAt: '2026-07-05T10:00:00.000Z',
      updatedAt: '2026-07-06T10:00:00.000Z',
      topicId: 'topic-work',
      topicTitle: 'Work',
    }, 'Vault body.\nSecond line.')

    expect(merged.content).toContain('title: "Database title source"')
    expect(merged.content).toContain('topic: "Work"')
    expect(merged.content).toContain('confidence: 91')
    expect(merged.content).toContain('verified: "2026-07-05"')
    expect(merged.content).toContain('Vault body.\nSecond line.')
    expect(merged.content).not.toContain('This body is not used')
    expect(merged.content).toContain('Topic: [[Topic - Work]]')
    expect(merged.bodyHash).toBe(hashBody('Vault body.\nSecond line.'))
    expect(merged.contentHash).toBe(stableHash(merged.content))
  })
})
