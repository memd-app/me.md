import { callAnthropic, isApiKeyConfigured } from './anthropic'
import { insights, notes, topics } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import type { SQLJsDatabase as SqlJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '../db/schema'

// ============================================
// Personality Insights Service
// ============================================
// Generates AI-powered personality insights from Big Five assessment scores.
// Uses Claude to create rich, personalized insights that go beyond generic
// result descriptions by contextualizing scores relative to the user's
// existing knowledge graph.

// Domain label mapping
const DOMAIN_LABELS: Record<string, string> = {
  N: 'Neuroticism',
  E: 'Extraversion',
  O: 'Openness to Experience',
  A: 'Agreeableness',
  C: 'Conscientiousness',
}

// Facet label mapping
const FACET_LABELS: Record<string, string[]> = {
  N: ['Anxiety', 'Anger', 'Depression', 'Self-Consciousness', 'Immoderation', 'Vulnerability'],
  E: ['Friendliness', 'Gregariousness', 'Assertiveness', 'Activity Level', 'Excitement-Seeking', 'Cheerfulness'],
  O: ['Imagination', 'Artistic Interests', 'Emotionality', 'Adventurousness', 'Intellect', 'Liberalism'],
  A: ['Trust', 'Morality', 'Altruism', 'Cooperation', 'Modesty', 'Sympathy'],
  C: ['Self-Efficacy', 'Orderliness', 'Dutifulness', 'Achievement-Striving', 'Self-Discipline', 'Cautiousness'],
}

export interface PersonalityInsight {
  category: string
  claim: string
  confidence: number
  evidence: string
  crossReference?: string
}

export interface PersonalityInsightsResult {
  insights: PersonalityInsight[]
  agreements: string[]
  contradictions: string[]
  generated: boolean
}

/**
 * Format domain scores into a human-readable summary for the AI prompt.
 */
function formatScoresForPrompt(domainScores: Array<{
  domain: string
  domainScore: number
  facetScores: Record<string, number | null>
}>): string {
  const lines: string[] = []

  for (const ds of domainScores) {
    const domainLabel = DOMAIN_LABELS[ds.domain] || ds.domain
    const score = ds.domainScore
    const level = score >= 4 ? 'High' : score >= 3.5 ? 'Above Average' : score >= 2.5 ? 'Average' : score >= 2 ? 'Below Average' : 'Low'

    lines.push(`\n### ${domainLabel} (${ds.domain}): ${score.toFixed(2)}/5 — ${level}`)

    // Add facet breakdown
    const facetLabels = FACET_LABELS[ds.domain] || []
    const facetEntries = Object.entries(ds.facetScores)
    for (const [key, facetScore] of facetEntries) {
      if (facetScore === null || facetScore === undefined) continue
      // key is like "facet1", "facet2", etc. - extract the number
      const facetNum = parseInt(key.replace('facet', ''), 10)
      const facetLabel = facetLabels[facetNum - 1] || `Facet ${facetNum}`
      const fLevel = facetScore >= 4 ? 'High' : facetScore >= 3 ? 'Moderate-High' : facetScore >= 2.5 ? 'Average' : 'Low'
      lines.push(`  - ${facetLabel}: ${facetScore.toFixed(2)} (${fLevel})`)
    }
  }

  return lines.join('\n')
}

/**
 * Format result text descriptions for the AI prompt.
 */
function formatResultTextForPrompt(resultText: any[]): string {
  if (!resultText || resultText.length === 0) return '(No descriptive text available)'

  return resultText.map(r => {
    const parts = [`**${r.title || r.domain}**: ${r.text || r.description || r.shortDescription || ''}`]
    if (r.facets && Array.isArray(r.facets)) {
      for (const f of r.facets) {
        if (f.text) {
          parts.push(`  - ${f.title || `Facet ${f.facet}`}: ${f.text}`)
        }
      }
    }
    return parts.join('\n')
  }).join('\n\n')
}

/**
 * Generate AI-powered personality insights from Big Five scores.
 * This is the main entry point called after test completion.
 */
export async function generatePersonalityInsights(
  db: SqlJsDatabase<typeof schema>,
  userId: string,
  _attemptId: string,
  domainScores: Array<{
    domain: string
    domainScore: number
    facetScores: Record<string, number | null>
  }>,
  resultText: any[],
): Promise<PersonalityInsightsResult> {
  // Check if AI is available
  if (!isApiKeyConfigured()) {
    console.log('[me.md:personality-insights] AI not available, skipping personality insight generation')
    return { insights: [], agreements: [], contradictions: [], generated: false }
  }

  try {
    // Fetch existing interview-derived insights for cross-referencing
    const existingInsights = db.select({
      content: insights.content,
      confidenceScore: insights.confidenceScore,
      verificationStatus: insights.verificationStatus,
      topicTitle: topics.title,
    })
      .from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(
        and(
          eq(insights.userId, userId),
          eq(insights.verificationStatus, 'verified'),
        )
      )
      .all()

    const hasExistingInsights = existingInsights.length > 0

    // Build the prompt
    const scoresText = formatScoresForPrompt(domainScores)
    const descriptionsText = formatResultTextForPrompt(resultText)

    let existingInsightsContext = ''
    if (hasExistingInsights) {
      existingInsightsContext = `\n## Existing Verified Interview Insights\nThe user has the following verified insights from previous interview sessions. Use these to cross-reference and identify agreements or contradictions with the assessment results:\n\n${existingInsights.slice(0, 20).map((i: { topicTitle: string | null; confidenceScore: number | null; content: string }) =>
        `- [From "${i.topicTitle}", confidence: ${i.confidenceScore}%]: "${i.content}"`
      ).join('\n')}`
    }

    const systemPrompt = `You are a personality psychologist and personal knowledge analyst for me.md, a personal knowledge system. Your job is to generate rich, personalized personality insights from Big Five (IPIP NEO-PI-R) assessment results.

You produce structured JSON output. Be specific, nuanced, and grounded in the actual score data. Go beyond generic descriptions — offer genuine psychological insights that help the user understand themselves better.

Output ONLY valid JSON with no markdown code fences, no explanation, and no commentary. Just the raw JSON object.`

    const userPrompt = `Analyze the following Big Five personality assessment results and generate personalized insights.

## Domain and Facet Scores
${scoresText}

## Standard Result Descriptions
${descriptionsText}
${existingInsightsContext}

## Instructions

Generate 5-10 personality insights based on these assessment results. For each insight:

1. **Per-domain insights** (one per domain): A nuanced interpretation of the domain score, highlighting the most notable facet patterns within that domain.
2. **Cross-domain observations** (2-5): Identify interesting patterns ACROSS domains. For example:
   - High Openness + Low Conscientiousness → creative but may struggle with follow-through
   - High Agreeableness + Low Neuroticism → emotionally stable and empathetic
   - High Conscientiousness + High Neuroticism → perfectionistic tendencies
   - Look at specific facet combinations across domains too

${hasExistingInsights ? `3. **Cross-reference with existing insights**: Compare the assessment results with the user's verified interview insights. Identify:
   - **Agreements**: Where the test results align with what the user has previously expressed
   - **Contradictions**: Where the test results suggest something different from the user's self-reported insights (these are especially valuable for self-discovery)` : ''}

## Confidence Scoring
- 70-80: Standard domain interpretation (straightforward reading of the score)
- 80-90: Cross-domain pattern with moderate evidence (2+ domains supporting the insight)
- 85-95: Strong cross-domain pattern confirmed by facet-level data${hasExistingInsights ? '\n- 90-95: Assessment insight that aligns with verified interview data' : ''}

## Output Format (JSON object only)
{
  "insights": [
    {
      "category": "openness|conscientiousness|extraversion|agreeableness|neuroticism|cross_domain",
      "claim": "A clear, declarative personality insight statement",
      "confidence": 75,
      "evidence": "Brief explanation of which scores support this (e.g., 'O: 4.2, O-Intellect: 4.5, combined with C: 3.8')"${hasExistingInsights ? ',\n      "crossReference": "Optional: reference to an existing interview insight that relates to this finding"' : ''}
    }
  ],
  "agreements": [${hasExistingInsights ? '"List of brief statements where test results confirm existing insights"' : ''}],
  "contradictions": [${hasExistingInsights ? '"List of brief statements where test results diverge from existing insights"' : ''}]
}`

    console.log(`[me.md:personality-insights] Calling Claude API for personality insight generation (${domainScores.length} domains, ${existingInsights.length} existing insights)`)

    const responseText = await callAnthropic({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 4096,
    })

    if (!responseText || responseText.trim().length === 0) {
      console.warn('[me.md:personality-insights] Claude returned empty response')
      return { insights: [], agreements: [], contradictions: [], generated: false }
    }

    console.log(`[me.md:personality-insights] Response received (${responseText.length} chars)`)

    // Parse the JSON response
    let cleaned = responseText.trim()
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
    cleaned = cleaned.trim()

    const parsed = JSON.parse(cleaned)

    // Validate and sanitize the response
    const validCategories = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism', 'cross_domain']

    const validInsights: PersonalityInsight[] = (parsed.insights || [])
      .filter((item: any) => {
        return typeof item === 'object' && item !== null &&
          typeof item.claim === 'string' && item.claim.trim().length > 0 &&
          typeof item.confidence === 'number'
      })
      .map((item: any) => ({
        category: validCategories.includes(item.category) ? item.category : 'cross_domain',
        claim: item.claim.substring(0, 500),
        confidence: Math.min(Math.max(Math.round(item.confidence), 50), 95),
        evidence: typeof item.evidence === 'string' ? item.evidence.substring(0, 500) : '',
        crossReference: typeof item.crossReference === 'string' ? item.crossReference.substring(0, 500) : undefined,
      }))
      .slice(0, 10)

    const agreements = Array.isArray(parsed.agreements)
      ? parsed.agreements.filter((a: any) => typeof a === 'string').map((a: string) => a.substring(0, 300)).slice(0, 5)
      : []

    const contradictions = Array.isArray(parsed.contradictions)
      ? parsed.contradictions.filter((c: any) => typeof c === 'string').map((c: string) => c.substring(0, 300)).slice(0, 5)
      : []

    console.log(`[me.md:personality-insights] Generated ${validInsights.length} insights, ${agreements.length} agreements, ${contradictions.length} contradictions`)

    return {
      insights: validInsights,
      agreements,
      contradictions,
      generated: true,
    }
  } catch (error: any) {
    console.error(`[me.md:personality-insights] Error generating insights: ${error.message}`)
    return { insights: [], agreements: [], contradictions: [], generated: false }
  }
}

/**
 * Store generated personality insights in the database.
 * Creates a special note and insight records with source='bigfive_assessment'.
 */
export function storePersonalityInsights(
  db: SqlJsDatabase<typeof schema>,
  userId: string,
  attemptId: string,
  insightsResult: PersonalityInsightsResult,
): { noteId: string; insightIds: string[] } {
  // We need a topic and a note to associate insights with.
  // Check if a "Big Five Personality Assessment" topic already exists for this user.
  let assessmentTopic = db.select()
    .from(topics)
    .where(
      and(
        eq(topics.userId, userId),
        eq(topics.title, 'Big Five Personality Assessment'),
      )
    )
    .get()

  if (!assessmentTopic) {
    // Create the assessment topic
    const topicId = crypto.randomUUID()
    assessmentTopic = db.insert(topics).values({
      id: topicId,
      userId,
      title: 'Big Five Personality Assessment',
      description: 'Personality insights generated from the Big Five (IPIP NEO-PI-R) assessment.',
      tags: JSON.stringify(['personality', 'big-five', 'assessment', 'self-knowledge']),
      status: 'extracted',
      priority: 'medium',
      intent: 'explore',
      isPreset: false,
      presetCategory: 'identity',
    }).returning().get()!

    console.log(`[me.md:personality-insights] Created assessment topic: ${topicId}`)
  }

  const topicId = assessmentTopic.id

  // Create a note for this assessment's insights
  const noteId = crypto.randomUUID()
  const insightSummary = insightsResult.insights.map(i => `- **${i.category}**: ${i.claim}`).join('\n')
  const agreementsSummary = insightsResult.agreements.length > 0
    ? `\n\n## Agreements with Interview Insights\n${insightsResult.agreements.map(a => `- ${a}`).join('\n')}`
    : ''
  const contradictionsSummary = insightsResult.contradictions.length > 0
    ? `\n\n## Contradictions with Interview Insights\n${insightsResult.contradictions.map(c => `- ${c}`).join('\n')}`
    : ''

  const fullAnalysis = `# AI Personality Analysis\n\nGenerated from Big Five assessment (attempt: ${attemptId}).\n\n## Key Insights\n${insightSummary}${agreementsSummary}${contradictionsSummary}`

  db.insert(notes).values({
    id: noteId,
    sessionId: attemptId, // Use attemptId as a pseudo-session reference
    topicId,
    userId,
    title: `Big Five AI Analysis — ${new Date().toLocaleDateString()}`,
    contentFullAnalysis: fullAnalysis,
    contentBriefSummary: `Big Five personality analysis with ${insightsResult.insights.length} insights generated.`,
    selectedFormat: 'full_analysis',
  }).run()

  console.log(`[me.md:personality-insights] Created assessment note: ${noteId}`)

  // Store each insight in the insights table
  const insightIds: string[] = []

  for (const insight of insightsResult.insights) {
    const insightId = crypto.randomUUID()
    insightIds.push(insightId)

    db.insert(insights).values({
      id: insightId,
      noteId,
      topicId,
      userId,
      content: insight.claim,
      confidenceScore: insight.confidence,
      verificationStatus: 'unverified',
      extractionMethod: 'ai',
      sourceSessionId: null,
    }).run()
  }

  console.log(`[me.md:personality-insights] Stored ${insightIds.length} personality insights in database`)

  return { noteId, insightIds }
}

// ============================================
// Change Insights Generation
// ============================================
// Generates AI-powered analysis of how a user's personality scores have changed
// between two assessments.

export interface ChangeInsightsResult {
  insights: string[]
  significantShifts: Array<{
    domain: string
    label: string
    from: number
    to: number
    interpretation: string
  }>
  generated: boolean
}

/**
 * Generate AI-powered change insights comparing two assessment attempts.
 */
export async function generateChangeInsights(
  oldScores: Array<{ domain: string; domainScore: number; facetScores: Record<string, number | null> }>,
  newScores: Array<{ domain: string; domainScore: number; facetScores: Record<string, number | null> }>,
  oldDate: string,
  newDate: string,
): Promise<ChangeInsightsResult> {
  if (!isApiKeyConfigured()) {
    console.log('[me.md:personality-insights] AI not available, generating rule-based change insights')
    return generateRuleBasedChangeInsights(oldScores, newScores, oldDate, newDate)
  }

  try {
    // Build a comparison summary for the prompt
    const domainChanges: string[] = []
    for (const newD of newScores) {
      const oldD = oldScores.find(o => o.domain === newD.domain)
      if (!oldD) continue
      const domainLabel = DOMAIN_LABELS[newD.domain] || newD.domain
      const diff = newD.domainScore - oldD.domainScore
      const pctChange = oldD.domainScore > 0 ? ((diff / oldD.domainScore) * 100).toFixed(1) : '0'
      domainChanges.push(`${domainLabel} (${newD.domain}): ${oldD.domainScore.toFixed(2)} → ${newD.domainScore.toFixed(2)} (${diff > 0 ? '+' : ''}${diff.toFixed(2)}, ${pctChange}%)`)

      // Include facet changes
      const facetLabels = FACET_LABELS[newD.domain] || []
      for (let i = 1; i <= 6; i++) {
        const key = `facet${i}`
        const oldF = oldD.facetScores[key]
        const newF = newD.facetScores[key]
        if (oldF !== null && oldF !== undefined && newF !== null && newF !== undefined) {
          const fDiff = (newF as number) - (oldF as number)
          if (Math.abs(fDiff) >= 0.3) {
            const fLabel = facetLabels[i - 1] || `Facet ${i}`
            domainChanges.push(`  - ${fLabel}: ${(oldF as number).toFixed(2)} → ${(newF as number).toFixed(2)} (${fDiff > 0 ? '+' : ''}${fDiff.toFixed(2)})`)
          }
        }
      }
    }

    const systemPrompt = `You are a personality psychologist analyzing how someone's Big Five personality scores have changed between two assessments. Output ONLY valid JSON with no markdown code fences.`

    const userPrompt = `Analyze the following changes in Big Five personality assessment scores between two time periods.

Previous Assessment: ${oldDate ? new Date(oldDate).toLocaleDateString() : 'Earlier'}
Current Assessment: ${newDate ? new Date(newDate).toLocaleDateString() : 'Recent'}

## Score Changes
${domainChanges.join('\n')}

## Instructions
Generate insights about the changes. Focus on:
1. Domains with significant changes (>10% shift)
2. What the changes might indicate about the person's growth or life circumstances
3. Notable facet-level shifts within domains
4. Cross-domain patterns in the changes

Output JSON:
{
  "insights": ["Insight 1 about the changes...", "Insight 2...", "..."],
  "significantShifts": [
    {
      "domain": "O",
      "label": "Openness",
      "from": 3.5,
      "to": 4.0,
      "interpretation": "Your Openness increased significantly, suggesting..."
    }
  ]
}

Keep insights concise (1-2 sentences each). Generate 2-5 insights.`

    console.log(`[me.md:personality-insights] Generating change insights via AI`)
    const responseText = await callAnthropic({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 2048,
    })

    let cleaned = responseText.trim()
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
    cleaned = cleaned.trim()

    const parsed = JSON.parse(cleaned)

    return {
      insights: Array.isArray(parsed.insights) ? parsed.insights.filter((i: unknown) => typeof i === 'string').slice(0, 5) : [],
      significantShifts: Array.isArray(parsed.significantShifts) ? parsed.significantShifts.slice(0, 5) : [],
      generated: true,
    }
  } catch (error: any) {
    console.error(`[me.md:personality-insights] Error generating change insights: ${error.message}`)
    return generateRuleBasedChangeInsights(oldScores, newScores, oldDate, newDate)
  }
}

/**
 * Rule-based fallback for change insights when AI is not available.
 */
function generateRuleBasedChangeInsights(
  oldScores: Array<{ domain: string; domainScore: number; facetScores: Record<string, number | null> }>,
  newScores: Array<{ domain: string; domainScore: number; facetScores: Record<string, number | null> }>,
  _oldDate: string,
  _newDate: string,
): ChangeInsightsResult {
  const changeInsights: string[] = []
  const significantShifts: ChangeInsightsResult['significantShifts'] = []

  for (const newD of newScores) {
    const oldD = oldScores.find(o => o.domain === newD.domain)
    if (!oldD) continue

    const domainLabel = DOMAIN_LABELS[newD.domain] || newD.domain
    const diff = newD.domainScore - oldD.domainScore
    const pctChange = oldD.domainScore > 0 ? (diff / oldD.domainScore) * 100 : 0

    if (Math.abs(pctChange) >= 10) {
      const direction = diff > 0 ? 'increased' : 'decreased'
      changeInsights.push(
        `Your ${domainLabel} ${direction} significantly since your last test (${oldD.domainScore.toFixed(1)} → ${newD.domainScore.toFixed(1)}, ${Math.abs(pctChange).toFixed(0)}% change).`
      )
      significantShifts.push({
        domain: newD.domain,
        label: domainLabel,
        from: oldD.domainScore,
        to: newD.domainScore,
        interpretation: `${domainLabel} ${direction} by ${Math.abs(pctChange).toFixed(0)}% since the previous assessment.`,
      })
    }
  }

  if (changeInsights.length === 0) {
    changeInsights.push('Your personality scores have remained relatively stable since your last assessment. Small fluctuations are normal and expected.')
  }

  return { insights: changeInsights, significantShifts, generated: false }
}
