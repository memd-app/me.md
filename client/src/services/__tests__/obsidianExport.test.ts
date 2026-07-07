import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from '@/db/schema'
import { CREATE_TABLES_SQL } from '@/db/database'
import {
  KIND_LABELS,
  RELATED_FLOOR,
  generateInsightNote,
  generateObsidianNotes,
  pickRelated,
  slugify,
  toFrontmatter,
} from '../obsidianExport'
import { parseFacetsResponse, PROFILE_FACETS, upsertProfileFacets } from '../profileSynthesis'

vi.mock('@/db/persistence', () => ({
  scheduleSave: vi.fn(),
}))

describe('obsidian export service', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeAll(async () => {
    const SQL = await initSqlJs()
    const sqlDb = new SQL.Database()
    sqlDb.run('PRAGMA foreign_keys = ON;')
    sqlDb.run(CREATE_TABLES_SQL)
    db = drizzle(sqlDb, { schema })
  })

  beforeEach(() => {
    db.run('DELETE FROM profile_facets')
    db.run('DELETE FROM assessment_results')
    db.run('DELETE FROM assessment_attempts')
    db.run('DELETE FROM insights')
    db.run('DELETE FROM topics')
    db.run('DELETE FROM users')
    db.run("INSERT OR IGNORE INTO users (id, name) VALUES ('local-user', 'Test User')")
  })

  function sqlValue(value: string | number | null): string {
    if (value === null) return 'NULL'
    if (typeof value === 'number') return String(value)
    return `'${value.replace(/'/g, "''")}'`
  }

  function insertTopic(id: string, title: string): void {
    db.run(`
      INSERT INTO topics (id, user_id, title)
      VALUES (${sqlValue(id)}, 'local-user', ${sqlValue(title)})
    `)
  }

  function insertInsight(params: {
    id: string
    content: string
    topicId?: string | null
    confidenceScore?: number
    verificationStatus?: string
    privacyTier?: string
    verifiedAt?: string | null
    updatedAt?: string | null
    kind?: string | null
  }): void {
    db.run(`
      INSERT INTO insights (
        id,
        user_id,
        topic_id,
        content,
        confidence_score,
        verification_status,
        privacy_tier,
        verified_at,
        updated_at,
        kind
      )
      VALUES (
        ${sqlValue(params.id)},
        'local-user',
        ${sqlValue(params.topicId ?? null)},
        ${sqlValue(params.content)},
        ${sqlValue(params.confidenceScore ?? 82)},
        ${sqlValue(params.verificationStatus ?? 'verified')},
        ${sqlValue(params.privacyTier ?? 'exportable')},
        ${sqlValue(params.verifiedAt ?? '2026-06-12T09:30:00.000Z')},
        ${sqlValue(params.updatedAt ?? '2026-06-13T09:30:00.000Z')},
        ${sqlValue(params.kind ?? null)}
      )
    `)
  }

  it('creates safe insight slugs for Obsidian and filesystems', () => {
    const slug = slugify('ins-4af2', 'Path/with:bad#chars|and[]?*<> "`^')

    expect(slug).toBeTruthy()
    expect(slug).not.toBe('.')
    expect(slug).not.toBe('..')
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug).toMatch(/^[\x20-\x7E]+$/)
    expect(slug).not.toMatch(/[\/\\:#^|\[\]?*<>"`]/)
  })

  it('uses the insight id fragment to prevent filename collisions', () => {
    expect(slugify('ins-a1b2c3', 'I prefer direct feedback')).not.toBe(
      slugify('ins-d4e5f6', 'I prefer direct feedback'),
    )

    insertTopic('topic-communication', 'Communication')
    insertInsight({
      id: 'ins-a1b2c3',
      topicId: 'topic-communication',
      content: 'I prefer direct feedback.',
    })
    insertInsight({
      id: 'ins-d4e5f6',
      topicId: 'topic-communication',
      content: 'I prefer direct feedback.',
    })

    const insightPaths = generateObsidianNotes(db).notes
      .map(note => note.path)
      .filter(path => path.startsWith('me.md/Insights/'))

    expect(new Set(insightPaths).size).toBe(2)
    expect(insightPaths).toEqual(expect.arrayContaining([
      expect.stringContaining('ins-a1b2c3'),
      expect.stringContaining('ins-d4e5f6'),
    ]))
  })

  it('writes quoted YAML frontmatter and wiki-links for insight notes', () => {
    insertTopic('topic-communication', 'Communication')
    insertInsight({
      id: 'ins-frontmatter',
      topicId: 'topic-communication',
      content: 'I prefer "direct: feedback" #always. Second sentence.',
    })

    const note = generateObsidianNotes(db).notes.find(item => item.path.startsWith('me.md/Insights/'))
    expect(note).toBeDefined()
    expect(note?.content.startsWith('---\n')).toBe(true)

    const frontmatterEnd = note?.content.indexOf('\n---\n', 4) ?? -1
    expect(frontmatterEnd).toBeGreaterThan(0)
    const frontmatter = note?.content.slice(4, frontmatterEnd) ?? ''
    const titleLine = frontmatter.split('\n').find(line => line.startsWith('title: '))

    expect(titleLine).toMatch(/^title: "/)
    expect(titleLine).toContain('\\"direct: feedback\\"')
    expect(frontmatter).toContain('topic: "Communication"')
    expect(frontmatter).toContain('confidence: 82')
    expect(frontmatter).toContain('verified: "2026-06-12"')
    expect(frontmatter).toContain('status: "verified"')
    expect(frontmatter).toContain('source: "me.md"')
    expect(frontmatter).toContain('id: "ins-frontmatter"')
    expect(note?.content).toContain('Topic: [[Topic - Communication]]')

    expect(toFrontmatter([
      ['title', 'Needs: quotes # and "slashes" \\ ok'],
      ['confidence', 82],
    ])).toContain('title: "Needs: quotes # and \\"slashes\\" \\\\ ok"')
  })

  it('generates status-specific insight paths with stable slugs', () => {
    const row = {
      id: 'ins-status-path',
      content: 'I review pending notes in Obsidian.',
      confidenceScore: 77,
      verifiedAt: null,
      updatedAt: '2026-07-06T10:00:00.000Z',
      topicId: 'topic-work',
      topicTitle: 'Work',
    }

    const pending = generateInsightNote(row, 'pending')
    const verified = generateInsightNote(row, 'verified')
    const rejected = generateInsightNote(row, 'rejected')

    expect(pending.slug).toBe(verified.slug)
    expect(rejected.slug).toBe(verified.slug)
    expect(pending.note.path).toBe(`me.md/Pending/${pending.slug}.md`)
    expect(verified.note.path).toBe(`me.md/Insights/${verified.slug}.md`)
    expect(rejected.note.path).toBe(`me.md/Rejected/${rejected.slug}.md`)
    expect(pending.note.content).toContain('status: "pending"')
    expect(verified.note.content).toContain('status: "verified"')
    expect(rejected.note.content).toContain('status: "rejected"')
  })

  it('regenerates byte-identical notes and hashes for unchanged data', () => {
    insertTopic('topic-communication', 'Communication')
    insertTopic('topic-work', 'Work')
    insertInsight({
      id: 'ins-stable-1',
      topicId: 'topic-communication',
      content: 'I prefer concise updates.',
      confidenceScore: 90,
    })
    insertInsight({
      id: 'ins-stable-2',
      topicId: 'topic-work',
      content: 'I track decisions explicitly.',
      confidenceScore: 75,
    })

    const first = generateObsidianNotes(db)
    const second = generateObsidianNotes(db)
    const firstByPath = new Map(first.notes.map(note => [note.path, note]))

    expect(second.notes.length).toBe(first.notes.length)
    for (const note of second.notes) {
      expect(firstByPath.get(note.path)?.content).toBe(note.content)
      expect(firstByPath.get(note.path)?.hash).toBe(note.hash)
    }
  })

  it('emits index, topic, and insight notes only for verified exportable insights', () => {
    insertTopic('topic-communication', 'Communication')
    insertTopic('topic-work', 'Work')
    insertInsight({
      id: 'ins-exported-1',
      topicId: 'topic-communication',
      content: 'I prefer direct feedback.',
      confidenceScore: 91,
    })
    insertInsight({
      id: 'ins-exported-2',
      topicId: 'topic-work',
      content: 'I avoid jargon in operational writing.',
      confidenceScore: 88,
    })
    insertInsight({
      id: 'ins-exported-3',
      topicId: 'topic-work',
      content: 'I write down open questions before acting.',
      confidenceScore: 70,
    })
    insertInsight({
      id: 'ins-private',
      topicId: 'topic-work',
      content: 'This should not export.',
      privacyTier: 'private',
    })
    insertInsight({
      id: 'ins-unverified',
      topicId: 'topic-communication',
      content: 'This should not export either.',
      verificationStatus: 'unverified',
    })

    const result = generateObsidianNotes(db)
    const paths = result.notes.map(note => note.path)

    expect(result.insightCount).toBe(3)
    expect(result.topicCount).toBe(2)
    expect(paths.filter(path => path === 'me.md/Me - Index.md')).toHaveLength(1)
    expect(paths.filter(path => path.startsWith('me.md/Topics/'))).toHaveLength(2)
    expect(paths.filter(path => path.startsWith('me.md/Insights/'))).toHaveLength(3)
    expect(paths).toEqual(expect.arrayContaining([
      'me.md/Topics/Topic - Communication.md',
      'me.md/Topics/Topic - Work.md',
    ]))
    expect(paths.join('\n')).not.toContain('ins-private')
    expect(paths.join('\n')).not.toContain('ins-unverified')
  })

  it('returns an empty result without throwing when no insights or personality data exist', () => {
    const result = generateObsidianNotes(db)

    expect(result.rootFolder).toBe('me.md')
    expect(result.notes).toEqual([])
    expect(result.insightCount).toBe(0)
    expect(result.topicCount).toBe(0)
    expect(result.hasPersonality).toBe(false)
    expect(result.hasFacets).toBe(false)
    expect(result.facetCount).toBe(0)
  })

  it('includes Big Five note and index link when personality data exists', () => {
    db.run(`
      INSERT INTO assessment_attempts (id, user_id, completed_at, status)
      VALUES ('attempt-1', 'local-user', '2026-06-12T00:00:00.000Z', 'completed')
    `)
    db.run(`
      INSERT INTO assessment_results (
        id,
        attempt_id,
        domain,
        domain_score,
        facet1_score,
        facet2_score,
        facet3_score,
        facet4_score,
        facet5_score,
        facet6_score
      )
      VALUES ('result-1', 'attempt-1', 'O', 96, 16, 15, 14, 13, 12, 11)
    `)

    const result = generateObsidianNotes(db)
    const paths = result.notes.map(note => note.path)
    const index = result.notes.find(note => note.path === 'me.md/Me - Index.md')

    expect(result.hasPersonality).toBe(true)
    expect(paths).toContain('me.md/Personality/Big Five.md')
    expect(index?.content).toContain('## Personality')
    expect(index?.content).toContain('[[Big Five]]')
  })

  it('emits profile facet notes and index links when facets exist', () => {
    const facets = parseFacetsResponse(JSON.stringify({
      facets: PROFILE_FACETS.map((facet, index) => ({
        key: facet.key,
        portrait: `${facet.title} portrait body.`,
        agent_brief: index === PROFILE_FACETS.length - 1
          ? undefined
          : `- *strongly held*: ${facet.title} brief.\n\n### Tensions & open questions\nNo contradictions surfaced in current evidence.`,
      })),
    }))
    upsertProfileFacets(db, facets, '2026-07-06T12:00:00.000Z', 5)

    const result = generateObsidianNotes(db)
    const paths = result.notes.map(note => note.path)
    const index = result.notes.find(note => note.path === 'me.md/Me - Index.md')

    expect(result.hasFacets).toBe(true)
    expect(result.facetCount).toBe(5)
    for (const facet of PROFILE_FACETS) {
      const note = result.notes.find(item => item.path === `me.md/Profile/${facet.title}.md`)
      expect(paths).toContain(`me.md/Profile/${facet.title}.md`)
      expect(note?.content).toContain(`title: "${facet.title}"`)
      expect(note?.content).toContain('type: "profile-facet"')
      expect(note?.content).toContain(`# ${facet.title}`)
      expect(note?.content).toContain(`${facet.title} portrait body.`)
      if (facet.key === PROFILE_FACETS[PROFILE_FACETS.length - 1]?.key) {
        expect(note?.content).not.toContain('## Agent brief')
      } else {
        expect(note?.content).toContain('## Agent brief')
        expect(note?.content).toContain(`${facet.title} brief.`)
      }
      expect(index?.content).toContain(`- [[${facet.title}]]`)
    }
    expect(index?.content).toContain('## Profile')
  })

  it('omits profile facet notes when no facets exist', () => {
    insertTopic('topic-work', 'Work')
    insertInsight({
      id: 'ins-work',
      topicId: 'topic-work',
      content: 'I keep decision logs.',
    })

    const result = generateObsidianNotes(db)
    const paths = result.notes.map(note => note.path)
    const index = result.notes.find(note => note.path === 'me.md/Me - Index.md')

    expect(paths.some(path => path.startsWith('me.md/Profile/'))).toBe(false)
    expect(index?.content).not.toContain('## Profile')
  })

  it('groups topic MOC links by kind in canonical order with an other section', () => {
    insertTopic('topic-communication', 'Communication')
    insertInsight({
      id: 'ins-kind-value',
      topicId: 'topic-communication',
      content: 'I value direct written feedback.',
      confidenceScore: 94,
      kind: 'value',
    })
    insertInsight({
      id: 'ins-kind-belief',
      topicId: 'topic-communication',
      content: 'I believe small teams communicate faster.',
      confidenceScore: 91,
      kind: 'belief',
    })
    insertInsight({
      id: 'ins-kind-trait',
      topicId: 'topic-communication',
      content: 'I approach disagreements methodically.',
      confidenceScore: 88,
      kind: 'trait',
    })
    insertInsight({
      id: 'ins-kind-null',
      topicId: 'topic-communication',
      content: 'I keep open questions visible.',
      confidenceScore: 85,
    })

    const topic = generateObsidianNotes(db).notes.find(note => note.path === 'me.md/Topics/Topic - Communication.md')

    expect(KIND_LABELS.map(([, label]) => label)).toContain('Beliefs')
    expect(topic?.content).toContain('### Beliefs')
    expect(topic?.content).toContain('### Values')
    expect(topic?.content).toContain('### Traits')
    expect(topic?.content).toContain('### Other')
    expect(topic?.content.indexOf('### Beliefs')).toBeLessThan(topic?.content.indexOf('### Values') ?? 0)
    expect(topic?.content.indexOf('### Values')).toBeLessThan(topic?.content.indexOf('### Traits') ?? 0)
    expect(topic?.content.indexOf('### Traits')).toBeLessThan(topic?.content.indexOf('### Other') ?? 0)
    expect(topic?.content).toContain(`- [[${slugify('ins-kind-belief', 'I believe small teams communicate faster')}|I believe small teams communicate faster]]`)
    expect(topic?.content).toContain(`- [[${slugify('ins-kind-null', 'I keep open questions visible')}|I keep open questions visible]]`)
  })

  it('keeps the flat topic MOC byte format when no insight has kind', () => {
    insertTopic('topic-communication', 'Communication')
    insertInsight({
      id: 'ins-flat-1',
      topicId: 'topic-communication',
      content: 'I prefer concise updates.',
      confidenceScore: 90,
    })
    insertInsight({
      id: 'ins-flat-2',
      topicId: 'topic-communication',
      content: 'I write open questions down.',
      confidenceScore: 80,
    })

    const topic = generateObsidianNotes(db).notes.find(note => note.path === 'me.md/Topics/Topic - Communication.md')

    expect(topic?.content).toBe([
      '---',
      'title: "Communication"',
      'source: "me.md"',
      'type: "topic"',
      '---',
      '',
      '# Communication',
      '',
      `- [[${slugify('ins-flat-1', 'I prefer concise updates')}|I prefer concise updates]]`,
      `- [[${slugify('ins-flat-2', 'I write open questions down')}|I write open questions down]]`,
      '',
      '[[Me - Index]]',
      '',
    ].join('\n'))
  })

  it('picks related links deterministically and breaks equal scores by slug', () => {
    const self = { id: 'self', content: 'I prefer concise written updates before review meetings.' }
    const siblings = [
      { id: 'b', content: 'Values compact written status notes.', slug: 'ins-bravo', title: 'Bravo' },
      { id: 'a', content: 'Values compact written status notes.', slug: 'ins-alpha', title: 'Alpha' },
      { id: 'self', content: self.content, slug: 'ins-self', title: 'Self' },
    ]

    const first = pickRelated(self, siblings)
    const second = pickRelated(self, siblings)

    expect(first).toEqual(second)
    expect(first.map(item => item.slug)).toEqual(['ins-alpha', 'ins-bravo'])
  })

  it('excludes related candidates below the floor and at duplicate threshold', () => {
    const self = { id: 'self', content: 'I prefer concise written updates before review meetings.' }
    const related = pickRelated(self, [
      { id: 'same', content: self.content, slug: 'ins-same', title: 'Same' },
      { id: 'noise', content: 'zzzzzzzzzzzzzzzzzz', slug: 'ins-noise', title: 'Noise' },
    ])

    expect(RELATED_FLOOR).toBe(0.15)
    expect(related).toEqual([])
  })

  it('serializes kind and related links as Obsidian frontmatter list properties', () => {
    const row = {
      id: 'ins-related',
      content: 'I prefer concise written updates.',
      confidenceScore: 91,
      verifiedAt: '2026-07-06T10:00:00.000Z',
      updatedAt: '2026-07-06T10:00:00.000Z',
      topicId: 'topic-work',
      topicTitle: 'Work',
      kind: 'preference',
      related: [
        { slug: 'ins-alpha', title: 'Alpha "quote"' },
        { slug: 'ins-beta', title: 'Beta [[link|alias]]' },
      ],
    }

    const { note } = generateInsightNote(row)

    expect(note.content).toContain([
      'confidence: 91',
      'kind: "preference"',
      'related:',
      '  - "[[ins-alpha|Alpha \\"quote\\"]]"',
      '  - "[[ins-beta|Beta link alias]]"',
      'verified: "2026-07-06"',
    ].join('\n'))
  })

  it('keeps generateInsightNote byte-identical when optional graph fields are absent', () => {
    const row = {
      id: 'ins-parity',
      content: 'I prefer direct feedback.',
      confidenceScore: 82,
      verifiedAt: '2026-06-12T09:30:00.000Z',
      updatedAt: '2026-06-13T09:30:00.000Z',
      topicId: 'topic-communication',
      topicTitle: 'Communication',
    }
    const { slug, note } = generateInsightNote(row)

    expect(note.content).toBe([
      '---',
      'title: "I prefer direct feedback"',
      'topic: "Communication"',
      'confidence: 82',
      'verified: "2026-06-12"',
      'status: "verified"',
      'source: "me.md"',
      'id: "ins-parity"',
      '---',
      '',
      'I prefer direct feedback.',
      '',
      'Topic: [[Topic - Communication]]',
      '',
    ].join('\n'))
    expect(note.path).toBe(`me.md/Insights/${slug}.md`)
    expect(note.content).not.toContain('kind:')
    expect(note.content).not.toContain('related:')
  })

  it('orders index topics by size and summarizes linked profile facets', () => {
    insertTopic('topic-work', 'Work')
    insertTopic('topic-communication', 'Communication')
    insertInsight({ id: 'ins-work-1', topicId: 'topic-work', content: 'I keep decision logs.' })
    insertInsight({ id: 'ins-work-2', topicId: 'topic-work', content: 'I review commitments weekly.' })
    insertInsight({ id: 'ins-communication-1', topicId: 'topic-communication', content: 'I prefer concise updates.' })
    const facets = parseFacetsResponse(JSON.stringify({
      facets: PROFILE_FACETS.map(facet => ({
        key: facet.key,
        portrait: `${facet.title} portrait body.`,
        agent_brief: `- *strongly held*: ${facet.title} brief.\n\n### Tensions & open questions\nNo contradictions surfaced in current evidence.`,
      })),
    }))
    upsertProfileFacets(db, facets, '2026-07-06T12:00:00.000Z', 5)

    const index = generateObsidianNotes(db).notes.find(note => note.path === 'me.md/Me - Index.md')
    const workLine = '- [[Topic - Work]] · 2 insights'
    const communicationLine = '- [[Topic - Communication]] · 1 insight'

    expect(index?.content).toContain('> Auto-generated from me.md. 3 verified insights · 2 topics · 5 profile facets.')
    expect(index?.content).toContain(workLine)
    expect(index?.content).toContain(communicationLine)
    expect(index?.content.indexOf(workLine)).toBeLessThan(index?.content.indexOf(communicationLine) ?? 0)
  })
})
