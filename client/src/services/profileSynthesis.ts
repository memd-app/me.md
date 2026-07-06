import { eq } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import { profileFacets } from '@/db/schema'
import { callAnthropic, isApiKeyConfigured } from './anthropic'
import { getBigFiveSummaryLine, getVerifiedExportableInsights } from './profile'
import { extractJson } from './textCleaning'

type Db = SQLJsDatabase<typeof schema>

export interface FacetRecord {
  key: string
  title: string
  body: string
  generatedAt: string
  insightCount: number
}

export const PROFILE_FACETS: ReadonlyArray<{ key: string; title: string; focus: string }> = [
  {
    key: 'identity_values',
    title: 'Identity & Values',
    focus: 'Core values, identity claims, convictions, standards, motivations, and recurring personal commitments.',
  },
  {
    key: 'work_style_ethics',
    title: 'Work Style & Ethics',
    focus: 'How the person prefers to work, what they consider careful work, and the ethics or craft standards they protect.',
  },
  {
    key: 'communication_style',
    title: 'Communication Style',
    focus: 'Preferred tone, directness, medium, feedback style, collaboration norms, and language patterns.',
  },
  {
    key: 'behavioral_patterns',
    title: 'Behavioral Patterns',
    focus: 'Recurring habits, tendencies under pressure, strengths, limits, triggers, and repeatable life patterns.',
  },
  {
    key: 'decision_making',
    title: 'Decision-Making',
    focus: 'Decision criteria, risk posture, tradeoff handling, evidence standards, and when intuition or analysis dominates.',
  },
] as const

export const MAX_SYNTHESIS_INSIGHTS = 200

const PROFILE_FACET_BY_KEY = new Map(PROFILE_FACETS.map(facet => [facet.key, facet]))

const SYSTEM_PROMPT = [
  "You synthesize a person's verified self-knowledge into instruction context another AI agent can load to act more like them.",
  '',
  'Rules:',
  '- Ground every statement in the supplied evidence; never invent. Silence beats padding.',
  '- Each body is markdown instruction context: concrete preferences, rules, and patterns the agent should follow, each with a conviction level such as strongly held, usually, or tentative. It is not a resume or life story. Do not write biography frames like "This person is a...".',
  '- Every facet body ends with a short ### Tensions & open questions subsection naming where evidence disagrees or is thin. Empty-but-present is fine: "No contradictions surfaced in current evidence."',
  '- Use a literate, quiet, precise register. Sentence case. Use the spaced em dash as the house mark. No exclamation marks, no "successfully", no self-praise adjectives, no emoji.',
  '- Second person about the user is fine inside bodies because the artifact is read by an agent about the user.',
].join('\n')

function buildUserPrompt(
  insightsForPrompt: ReturnType<typeof getVerifiedExportableInsights>,
  totalInsightCount: number,
  bigFiveSummary: string | null,
): string {
  const topicGroups = new Map<string, typeof insightsForPrompt>()

  for (const insight of insightsForPrompt) {
    const topic = insight.topicTitle || 'General'
    const group = topicGroups.get(topic) ?? []
    group.push(insight)
    topicGroups.set(topic, group)
  }

  const lines: string[] = []
  lines.push('# Source context')
  lines.push('')
  if (bigFiveSummary) {
    lines.push(`Big Five: ${bigFiveSummary}`)
    lines.push('')
  }
  lines.push(`${totalInsightCount} verified exportable insight${totalInsightCount === 1 ? '' : 's'} supplied; ${insightsForPrompt.length} included below.`)
  lines.push('')
  lines.push('## Facets to write')
  for (const facet of PROFILE_FACETS) {
    lines.push(`- ${facet.key}: ${facet.title} — ${facet.focus}`)
  }
  lines.push('')
  lines.push('# Verified insights')
  lines.push('')

  for (const [topic, group] of topicGroups) {
    lines.push(`## ${topic}`)
    for (const insight of group) {
      lines.push(`- ${JSON.stringify(insight.content)} (confidence: ${insight.confidenceScore ?? 50})`)
    }
    lines.push('')
  }

  lines.push('Write all five facets. Allocate each insight to the facet(s) it informs; an insight may inform more than one. Return JSON only.')
  lines.push('')
  lines.push('Output contract:')
  lines.push('{"facets":[{"key": <one of identity_values, work_style_ethics, communication_style, behavioral_patterns, decision_making>, "title": <matching title>, "body": <markdown string>}]}')
  lines.push('Return exactly the five keys, no prose, no fences.')

  return lines.join('\n')
}

export function parseFacetsResponse(raw: string): Array<{ key: string; title: string; body: string }> {
  const parsed = extractJson<{ facets?: unknown }>(raw)
  const seen = new Set<string>()
  const facets: Array<{ key: string; title: string; body: string }> = []

  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.facets)) {
    for (const item of parsed.facets) {
      if (!item || typeof item !== 'object') continue
      const candidate = item as { key?: unknown; body?: unknown }
      if (typeof candidate.key !== 'string') continue
      if (seen.has(candidate.key)) continue
      const facet = PROFILE_FACET_BY_KEY.get(candidate.key)
      if (!facet) continue
      if (typeof candidate.body !== 'string') continue
      const body = candidate.body.trim()
      if (!body) continue
      seen.add(candidate.key)
      facets.push({ key: facet.key, title: facet.title, body })
    }
  }

  if (facets.length === 0) {
    throw new Error('Profile synthesis returned no usable facets')
  }

  return facets
}

export function getProfileFacets(db: Db): FacetRecord[] {
  const rows = db.select().from(profileFacets).all()
  const byKey = new Map(rows.map(row => [row.key, row]))

  return PROFILE_FACETS
    .map(facet => {
      const row = byKey.get(facet.key)
      if (!row) return null
      return {
        key: facet.key,
        title: facet.title,
        body: row.body,
        generatedAt: row.generatedAt ?? '',
        insightCount: row.insightCount ?? 0,
      }
    })
    .filter((facet): facet is FacetRecord => facet !== null)
}

export function upsertProfileFacets(
  db: Db,
  facets: Array<{ key: string; title: string; body: string }>,
  generatedAt: string,
  insightCount: number,
): void {
  for (const facet of facets) {
    const canonical = PROFILE_FACET_BY_KEY.get(facet.key)
    if (!canonical) continue
    db.delete(profileFacets).where(eq(profileFacets.key, canonical.key)).run()
    db.insert(profileFacets).values({
      id: `facet-${canonical.key}`,
      key: canonical.key,
      title: canonical.title,
      body: facet.body.trim(),
      generatedAt,
      insightCount,
    }).run()
  }
}

export function getFacetStaleness(db: Db): { insightCount: number; generatedAt: string | null; verifiedSince: number } | null {
  const facets = getProfileFacets(db)
  if (facets.length === 0) return null

  const first = facets[0]
  const currentVerifiedCount = getVerifiedExportableInsights(db).length
  return {
    insightCount: first.insightCount,
    generatedAt: first.generatedAt || null,
    verifiedSince: Math.max(0, currentVerifiedCount - first.insightCount),
  }
}

export async function synthesizeFacets(db: Db): Promise<FacetRecord[]> {
  if (!isApiKeyConfigured()) throw new Error('Anthropic API key required')

  const verifiedInsights = getVerifiedExportableInsights(db)
  if (verifiedInsights.length === 0) {
    throw new Error('Verify insights to generate a profile analysis')
  }

  const insightsForPrompt = verifiedInsights.slice(0, MAX_SYNTHESIS_INSIGHTS)
  const bigFiveSummary = getBigFiveSummaryLine(db)
  const responseText = await callAnthropic({
    messages: [{ role: 'user', content: buildUserPrompt(insightsForPrompt, verifiedInsights.length, bigFiveSummary) }],
    system: SYSTEM_PROMPT,
    maxTokens: 4096,
  })
  const parsedFacets = parseFacetsResponse(responseText)
  const generatedAt = new Date().toISOString()
  upsertProfileFacets(db, parsedFacets, generatedAt, verifiedInsights.length)
  return getProfileFacets(db)
}
