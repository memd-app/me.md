import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from '@/db/schema'
import { CREATE_TABLES_SQL } from '@/db/database'
import { exportAsMarkdown } from '../profile'
import {
  getFacetStaleness,
  getProfileFacets,
  parseFacetsResponse,
  PROFILE_FACETS,
  upsertProfileFacets,
} from '../profileSynthesis'

describe('profile synthesis service', () => {
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
    db.run("INSERT OR IGNORE INTO users (id, name, occupation, location) VALUES ('local-user', 'Test User', 'Editor', 'Lisbon')")
  })

  function sqlValue(value: string | number | null): string {
    if (value === null) return 'NULL'
    if (typeof value === 'number') return String(value)
    return `'${value.replace(/'/g, "''")}'`
  }

  function facetPayload(keys = PROFILE_FACETS.map(facet => facet.key)) {
    return {
      facets: keys.map(key => ({
        key,
        title: 'Wrong title from model',
        portrait: `You return to ${key} as a pattern of attention. The evidence suggests this is less a slogan than a repeated way of choosing what gets protected.`,
        agent_brief: `- *usually*: ${key} body.\n\n### Tensions & open questions\nNo contradictions surfaced in current evidence.`,
      })),
    }
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
  }): void {
    db.run(`
      INSERT INTO insights (
        id,
        user_id,
        topic_id,
        content,
        confidence_score,
        verification_status,
        privacy_tier
      )
      VALUES (
        ${sqlValue(params.id)},
        'local-user',
        ${sqlValue(params.topicId ?? null)},
        ${sqlValue(params.content)},
        ${sqlValue(params.confidenceScore ?? 82)},
        ${sqlValue(params.verificationStatus ?? 'verified')},
        ${sqlValue(params.privacyTier ?? 'exportable')}
      )
    `)
  }

  describe('parseFacetsResponse', () => {
    it('parses a clean five-facet JSON response', () => {
      const parsed = parseFacetsResponse(JSON.stringify(facetPayload()))

      expect(parsed).toHaveLength(5)
      expect(parsed.map(facet => facet.key)).toEqual(PROFILE_FACETS.map(facet => facet.key))
    })

    it('parses fenced JSON responses', () => {
      const parsed = parseFacetsResponse([
        '```json',
        JSON.stringify(facetPayload(['identity_values'])),
        '```',
      ].join('\n'))

      expect(parsed).toEqual([
        expect.objectContaining({
          key: 'identity_values',
          title: 'Identity & Values',
          agentBrief: expect.stringContaining('### Tensions & open questions'),
        }),
      ])
    })

    it('parses prose-wrapped JSON responses', () => {
      const parsed = parseFacetsResponse([
        'Here is the synthesis:',
        JSON.stringify(facetPayload(['work_style_ethics', 'decision_making'])),
        'No other changes.',
      ].join('\n'))

      expect(parsed.map(facet => facet.key)).toEqual(['work_style_ethics', 'decision_making'])
    })

    it('drops unknown keys and empty portraits', () => {
      const parsed = parseFacetsResponse(JSON.stringify({
        facets: [
          { key: 'unknown', title: 'Unknown', portrait: 'Should drop', agent_brief: 'Brief' },
          { key: 'identity_values', title: 'Identity & Values', portrait: '   ', agent_brief: 'Brief' },
          { key: 'communication_style', title: 'Communication Style', portrait: 'Keep this', agent_brief: 'Brief' },
        ],
      }))

      expect(parsed).toEqual([{ key: 'communication_style', title: 'Communication Style', body: 'Keep this', agentBrief: 'Brief' }])
    })

    it('normalizes titles from canonical facet keys', () => {
      const parsed = parseFacetsResponse(JSON.stringify({
        facets: [{
          key: 'decision_making',
          title: 'Model supplied title',
          portrait: 'Use evidence carefully.',
          agent_brief: '- *strongly held*: Use evidence carefully.\n\n### Tensions & open questions\nNo contradictions surfaced in current evidence.',
        }],
      }))

      expect(parsed[0]).toEqual({
        key: 'decision_making',
        title: 'Decision-Making',
        body: 'Use evidence carefully.',
        agentBrief: '- *strongly held*: Use evidence carefully.\n\n### Tensions & open questions\nNo contradictions surfaced in current evidence.',
      })
    })

    it('throws when no usable facets are present', () => {
      expect(() => parseFacetsResponse(JSON.stringify({
        facets: [
          { key: 'unknown', portrait: 'Nope' },
          { key: 'identity_values', portrait: '' },
        ],
      }))).toThrow('Profile synthesis returned no usable facets')
    })

    it('returns honest partial results without fabricating missing facets', () => {
      const parsed = parseFacetsResponse(JSON.stringify(facetPayload(['identity_values', 'behavioral_patterns'])))

      expect(parsed.map(facet => facet.key)).toEqual(['identity_values', 'behavioral_patterns'])
    })

    it('falls back to null when agent_brief is missing', () => {
      const parsed = parseFacetsResponse(JSON.stringify({
        facets: [{ key: 'identity_values', portrait: 'You choose directness when the evidence is thin.' }],
      }))

      expect(parsed).toEqual([{
        key: 'identity_values',
        title: 'Identity & Values',
        body: 'You choose directness when the evidence is thin.',
        agentBrief: null,
      }])
    })

    it('repairs truncated new-shape responses and preserves closed portraits', () => {
      const completeFacets = PROFILE_FACETS.slice(0, 4).map(facet => JSON.stringify({
        key: facet.key,
        title: facet.title,
        portrait: `${facet.title} portrait stays complete.`,
        agent_brief: `${facet.title} brief.\n\n### Tensions & open questions\nNo contradictions surfaced in current evidence.`,
      }))
      const truncatedFacet = `{"key":"decision_making","title":"Decision-Making","portrait":"Decision-Making portrait stays complete.","agent_brief":"- *usually*: truncated`
      const parsed = parseFacetsResponse(`{"facets":[${[...completeFacets, truncatedFacet].join(',')}`)

      expect(parsed.map(facet => facet.key)).toEqual(PROFILE_FACETS.map(facet => facet.key))
      expect(parsed[parsed.length - 1]).toEqual({
        key: 'decision_making',
        title: 'Decision-Making',
        body: 'Decision-Making portrait stays complete.',
        agentBrief: null,
      })
    })
  })

  it('stores facets in canonical order and replaces existing rows by key', () => {
    const generatedAt = '2026-07-06T12:00:00.000Z'
    const reversed = parseFacetsResponse(JSON.stringify(facetPayload([...PROFILE_FACETS].reverse().map(facet => facet.key))))

    upsertProfileFacets(db, reversed, generatedAt, 4)

    expect(getProfileFacets(db).map(facet => facet.key)).toEqual(PROFILE_FACETS.map(facet => facet.key))

    const updated = parseFacetsResponse(JSON.stringify({
      facets: PROFILE_FACETS.map(facet => ({
        key: facet.key,
        portrait: `Updated ${facet.key}`,
        agent_brief: facet.key === 'decision_making' ? '' : `Brief ${facet.key}`,
      })),
    }))
    upsertProfileFacets(db, updated, '2026-07-06T13:00:00.000Z', 7)

    const rows = db.select().from(schema.profileFacets).all()
    expect(rows).toHaveLength(5)
    expect(getProfileFacets(db)).toEqual(PROFILE_FACETS.map(facet => ({
      key: facet.key,
      title: facet.title,
      body: `Updated ${facet.key}`,
      agentBrief: facet.key === 'decision_making' ? null : `Brief ${facet.key}`,
      generatedAt: '2026-07-06T13:00:00.000Z',
      insightCount: 7,
    })))
  })

  it('computes facet staleness from current verified exportable insights', () => {
    insertTopic('topic-work', 'Work')
    insertInsight({ id: 'ins-1', topicId: 'topic-work', content: 'I prefer precise updates.' })
    insertInsight({ id: 'ins-2', topicId: 'topic-work', content: 'I write down open questions.' })
    insertInsight({ id: 'ins-private', topicId: 'topic-work', content: 'Private.', privacyTier: 'private' })
    insertInsight({ id: 'ins-unverified', topicId: 'topic-work', content: 'Pending.', verificationStatus: 'unverified' })

    upsertProfileFacets(db, parseFacetsResponse(JSON.stringify(facetPayload(['identity_values']))), '2026-07-06T12:00:00.000Z', 1)

    expect(getFacetStaleness(db)).toEqual({
      insightCount: 1,
      generatedAt: '2026-07-06T12:00:00.000Z',
      verifiedSince: 1,
    })

    upsertProfileFacets(db, parseFacetsResponse(JSON.stringify(facetPayload(['identity_values']))), '2026-07-06T13:00:00.000Z', 2)

    expect(getFacetStaleness(db)).toEqual({
      insightCount: 2,
      generatedAt: '2026-07-06T13:00:00.000Z',
      verifiedSince: 0,
    })
  })

  it('inserts profile analysis before profile insight sections in markdown exports', () => {
    insertTopic('topic-identity', 'Identity')
    insertInsight({
      id: 'ins-identity',
      topicId: 'topic-identity',
      content: 'I value direct communication.',
      confidenceScore: 90,
    })
    upsertProfileFacets(db, parseFacetsResponse(JSON.stringify(facetPayload())), '2026-07-06T12:00:00.000Z', 1)

    const markdown = exportAsMarkdown(db)
    const analysisIndex = markdown.indexOf('## Profile analysis')
    const personalPortraitIndex = markdown.indexOf('## Personal Portrait')

    expect(analysisIndex).toBeGreaterThan(markdown.indexOf('---'))
    expect(analysisIndex).toBeGreaterThan(-1)
    expect(personalPortraitIndex).toBeGreaterThan(analysisIndex)
    expect(markdown).toContain('*Synthesized from your verified insights.*')
    for (const facet of PROFILE_FACETS) {
      expect(markdown).toContain(`### ${facet.title}`)
    }
  })

  it('omits profile analysis from markdown exports when no facets exist', () => {
    insertTopic('topic-identity', 'Identity')
    insertInsight({
      id: 'ins-identity',
      topicId: 'topic-identity',
      content: 'I value direct communication.',
      confidenceScore: 90,
    })

    const markdown = exportAsMarkdown(db)

    expect(markdown).not.toContain('## Profile analysis')
    expect(markdown).toContain('## Personal Portrait')
  })
})
