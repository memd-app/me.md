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
  agentBrief: string | null
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
  "You synthesize a person's verified self-knowledge into two registers per facet: a **portrait** the person reads about themselves, and an **agent brief** another AI agent loads to act more like them.",
  '',
  'Shared rules for both registers:',
  '- Ground every statement in the supplied evidence; never invent — silence beats padding.',
  '- Use the COPY.md register: literate, quiet, precise. Sentence case. Use the spaced em dash as the house mark. No exclamation marks, no "successfully", no self-praise adjectives, no emoji.',
  '',
  'PORTRAIT register rules:',
  '- Interpretive essay prose for the person to read about themselves. Synthesize across insights — name the through-lines and their likely why, draw conclusions and second-order observations ("the pattern beneath these is…", "what this suggests is…").',
  '- Weave evidence into sentences; never bullet-list facts. No more than one short list per facet, and only when a genuine enumeration earns it.',
  '- Written in the second person about the reader per the COPY.md register — first person about the reader in second person: "You choose…", "You return, again and again, to…". Analytical, not flattering; a literate magazine profile, not a horoscope.',
  '- Connect to the Big Five line where it corroborates or complicates the reading. Do not recite scores; use them as corroboration only, and only when the line is present.',
  '- The Tensions & open questions material moves into the portrait as flowing prose — italic-worthy observations woven into the essay ("There is a tension here worth naming: …"), not a bullet subsection. The portrait has no ### Tensions heading.',
  '- 150–300 words per facet.',
  '',
  'AGENT_BRIEF register rules:',
  '- Markdown instruction context of concrete preferences, rules, and patterns the agent should follow, each with a conviction level such as strongly held, usually, or tentative.',
  '- It is not a resume or life story. Do not write biography frames like "This person is a...".',
  '- End with a short ### Tensions & open questions subsection naming where evidence disagrees or is thin. Empty-but-present is fine: "No contradictions surfaced in current evidence."',
  '- This is the current register — preserve it verbatim in spirit; the bullet tensions subsection lives here, not in the portrait.',
  '',
  'Write the portrait first (the analysis). Then derive the agent brief from it.',
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
  lines.push('{"facets":[{"key": <one of identity_values, work_style_ethics, communication_style, behavioral_patterns, decision_making>, "title": <matching title>, "portrait": <markdown essay, 150-300 words, prose>, "agent_brief": <markdown instruction context ending in ### Tensions & open questions>}]}')
  lines.push('Write the portrait first, then derive the agent_brief. Return exactly the five keys, no prose, no fences.')

  return lines.join('\n')
}

// A completion cut off mid-facet leaves unparseable JSON. Salvage every facet
// object that closed cleanly rather than discarding the whole response.
function repairTruncatedFacets(raw: string): { facets?: unknown } | null {
  const start = raw.indexOf('{')
  if (start === -1) return null
  const slice = raw.slice(start)
  const objects: unknown[] = []
  const re = /\{[^{}]*"key"\s*:\s*"[^"]+"[\s\S]*?"portrait"\s*:\s*"(?:[^"\\]|\\.)*"(?:\s*,\s*"agent_brief"\s*:\s*"(?:[^"\\]|\\.)*")?\s*(?:\}|(?=,\s*"agent_brief"|$))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(slice)) !== null) {
    try {
      const fragment = m[0].trim()
      objects.push(JSON.parse(fragment.endsWith('}') ? fragment : `${fragment}}`))
    } catch {
      // skip fragments that still fail to parse
    }
  }
  return objects.length > 0 ? { facets: objects } : null
}

export function parseFacetsResponse(raw: string): Array<{ key: string; title: string; body: string; agentBrief: string | null }> {
  let parsed = extractJson<{ facets?: unknown }>(raw)
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { facets?: unknown }).facets)) {
    parsed = repairTruncatedFacets(raw)
  }
  const seen = new Set<string>()
  const facets: Array<{ key: string; title: string; body: string; agentBrief: string | null }> = []

  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.facets)) {
    for (const item of parsed.facets) {
      if (!item || typeof item !== 'object') continue
      const candidate = item as { key?: unknown; portrait?: unknown; agent_brief?: unknown }
      if (typeof candidate.key !== 'string') continue
      if (seen.has(candidate.key)) continue
      const facet = PROFILE_FACET_BY_KEY.get(candidate.key)
      if (!facet) continue
      if (typeof candidate.portrait !== 'string') continue
      const body = candidate.portrait.trim()
      if (!body) continue
      const agentBrief = typeof candidate.agent_brief === 'string' && candidate.agent_brief.trim()
        ? candidate.agent_brief.trim()
        : null
      seen.add(candidate.key)
      facets.push({ key: facet.key, title: facet.title, body, agentBrief })
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
        agentBrief: row.agentBrief ?? null,
        generatedAt: row.generatedAt ?? '',
        insightCount: row.insightCount ?? 0,
      }
    })
    .filter((facet): facet is FacetRecord => facet !== null)
}

export function upsertProfileFacets(
  db: Db,
  facets: Array<{ key: string; title: string; body: string; agentBrief: string | null }>,
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
      agentBrief: facet.agentBrief,
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
    maxTokens: 16384,
  })
  const parsedFacets = parseFacetsResponse(responseText)
  const generatedAt = new Date().toISOString()
  upsertProfileFacets(db, parsedFacets, generatedAt, verifiedInsights.length)
  return getProfileFacets(db)
}
