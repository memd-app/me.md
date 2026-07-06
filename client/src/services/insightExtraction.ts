/**
 * Unified Insight Extraction Service
 * ====================================
 * A single AI-powered pipeline that handles insight extraction from both
 * interview transcripts and imported content. Replaces the previous fragmented
 * approach where interviews used extractInsightsAI() and imports used three
 * separate rule-based functions (extractInsightsFromChatgpt, extractInsightsFromUrl,
 * extractInsightsFromText).
 *
 * All source types flow through the same pipeline:
 *   content → (optional chunking) → AI extraction → standardized output
 *   with a rule-based fallback if the AI is unavailable.
 */

import { callAnthropic, isApiKeyConfigured } from './anthropic'
import { combinedScore, DUPLICATE_THRESHOLD, NEAR_DUP_THRESHOLD } from './similarity'
import { cleanText, extractJson, isDeclarativeStatement, stripFrontmatter } from './textCleaning'

// ============================================
// Types
// ============================================

export type SourceType = 'interview' | 'import_url' | 'import_text' | 'import_chatgpt' | 'import_file'

export interface ExtractionContext {
  /** The content to extract insights from */
  content: string
  /** The type of source content */
  sourceType: SourceType
  /** Optional topic title for context */
  topicTitle?: string
  /** Optional topic description for context */
  topicDescription?: string
  /** User's name for personalization */
  userName?: string
  /** User's occupation for personalization */
  occupation?: string
  /** Existing verified insights for deduplication */
  existingVerifiedInsights?: Array<{ content: string; confidenceScore: number }>
}

export interface ExtractedInsight {
  /** The insight content text */
  content: string
  /** Confidence score 0-100 */
  confidenceScore: number
  /** Suggested category for the insight */
  category: string
  /** How the insight was extracted */
  extractionMethod: 'ai' | 'fallback'
}

export interface ExistingInsightRef {
  id: string
  content: string
  verificationStatus: string
  evidenceCount?: number
}

export interface AdmittedInsight extends ExtractedInsight {
  evidenceCount: number
  evidenceSources: string[]
}

export interface AttachTarget {
  targetId: string
  sourceRef: string
  score: number
}

export interface DroppedCandidate {
  content: string
  reason: 'dup-verified' | 'dup-pending' | 'neardup-verified' | 'dup-batch' | 'cap'
  score: number
  matchedId?: string
}

export interface AdmissionResult {
  admit: AdmittedInsight[]
  attach: AttachTarget[]
  drop: DroppedCandidate[]
}

type MatchSet = 'verified' | 'pending' | 'batch'

interface Match {
  set: MatchSet
  score: number
  id?: string
  index?: number
}

const MATCH_SET_PRECEDENCE: Record<MatchSet, number> = {
  verified: 3,
  pending: 2,
  batch: 1,
}

function betterGlobalMatch(a: Match | null, b: Match | null): Match | null {
  if (!a) return b
  if (!b) return a
  if (b.score > a.score) return b
  if (b.score < a.score) return a
  return MATCH_SET_PRECEDENCE[b.set] > MATCH_SET_PRECEDENCE[a.set] ? b : a
}

function bestExistingMatch(candidate: ExtractedInsight, refs: ExistingInsightRef[], set: 'verified' | 'pending'): Match | null {
  let best: Match | null = null

  for (const ref of refs) {
    const score = combinedScore(candidate.content, ref.content)
    if (!best || score > best.score || (score === best.score && ref.id < (best.id ?? ''))) {
      best = { set, score, id: ref.id }
    }
  }

  return best
}

function bestBatchMatch(candidate: ExtractedInsight, admittedBatch: AdmittedInsight[]): Match | null {
  let best: Match | null = null

  for (let index = 0; index < admittedBatch.length; index += 1) {
    const score = combinedScore(candidate.content, admittedBatch[index].content)
    if (!best || score > best.score || (score === best.score && index < (best.index ?? Number.MAX_SAFE_INTEGER))) {
      best = { set: 'batch', score, index }
    }
  }

  return best
}

/**
 * Deterministic, no DB, no LLM. `sourceRef` identifies this batch, e.g. `import:<id>`,
 * `session:<id>`, `assessment:<id>` -- recorded on attaches/merges as evidence provenance.
 */
export function admitInsights(
  candidates: ExtractedInsight[],
  existing: ExistingInsightRef[],
  sourceRef: string,
): AdmissionResult {
  const verified = existing.filter(ref => ref.verificationStatus === 'verified')
  const pending = existing.filter(ref => ref.verificationStatus !== 'verified')
  const admittedBatch: AdmittedInsight[] = []
  const attach: AttachTarget[] = []
  const drop: DroppedCandidate[] = []

  for (const candidate of candidates) {
    const best = [
      bestExistingMatch(candidate, verified, 'verified'),
      bestExistingMatch(candidate, pending, 'pending'),
      bestBatchMatch(candidate, admittedBatch),
    ].reduce<Match | null>((current, next) => betterGlobalMatch(current, next), null)

    if (!best || best.score < NEAR_DUP_THRESHOLD) {
      admittedBatch.push({ ...candidate, evidenceCount: 0, evidenceSources: [] })
      continue
    }

    if (best.score >= DUPLICATE_THRESHOLD) {
      drop.push({
        content: candidate.content,
        reason: best.set === 'verified' ? 'dup-verified' : best.set === 'pending' ? 'dup-pending' : 'dup-batch',
        score: best.score,
        matchedId: best.id,
      })
      continue
    }

    if (best.set === 'verified') {
      drop.push({
        content: candidate.content,
        reason: 'neardup-verified',
        score: best.score,
        matchedId: best.id,
      })
      continue
    }

    if (best.set === 'pending' && best.id) {
      attach.push({ targetId: best.id, sourceRef, score: best.score })
      continue
    }

    if (best.set === 'batch' && best.index !== undefined) {
      const matched = admittedBatch[best.index]
      matched.evidenceCount += 1
      matched.evidenceSources.push(sourceRef)
      if (candidate.confidenceScore > matched.confidenceScore) {
        matched.content = candidate.content
        matched.confidenceScore = candidate.confidenceScore
      }
      drop.push({
        content: candidate.content,
        reason: 'dup-batch',
        score: best.score,
      })
    }
  }

  return { admit: admittedBatch, attach, drop }
}

// ============================================
// Content Chunking for Large Imports
// ============================================

/** Maximum characters per chunk to stay within token limits (~4 chars/token, target ~3000 tokens of content) */
const MAX_CHUNK_SIZE = 12000

/** Maximum insights per chunk */
const MAX_INSIGHTS_PER_CHUNK = 15

/** Maximum total insights across all chunks */
const MAX_TOTAL_INSIGHTS = 30

/** Maps the LLM wire-contract `kind` onto the existing 5-value category enum.
 *  Downstream (DB columns, admitInsights, UI) sees only the category — untouched. */
export const KIND_TO_CATEGORY: Record<string, string> = {
  belief: 'perspectives',
  value: 'identity',
  trait: 'identity',
  habit: 'experiences',
  preference: 'perspectives',
  goal: 'goals',
  motivation: 'goals',
  relationship_pattern: 'perspectives',
  self_assessment: 'skills',
}

export const MIN_SELF_RELEVANCE = 60

export const PERSONHOOD_KIND_LINES = [
  '- belief: a conviction about how the world, people, or work functions. "Believes small teams outperform large ones."',
  '- value: what they hold important and protect under pressure. "Values honesty over harmony when giving feedback."',
  '- trait: a stable character attribute or disposition. "Approaches problems methodically rather than intuitively."',
  '- habit: a recurring personal behavior pattern they own. "Writes every morning before opening any messages."',
  '- preference: a durable like or dislike that shapes choices. "Prefers written async communication over meetings."',
  '- goal: a personally held aspiration or direction. "Wants to move from consulting into building products."',
  '- motivation: a driver, fear, or need that explains behavior. "Is driven by a fear of depending on things he cannot inspect."',
  '- relationship_pattern: how they characteristically relate to people. "Withdraws rather than argues when trust is broken."',
  '- self_assessment: their own judgment of strengths and limits. "Considers himself a strong starter but a weak finisher."',
] as const

export const SELF_RELEVANCE_CALIBRATION_LINES = [
  '- 90-100: directly about who the person is (a belief, value, trait, or pattern they own).',
  '- 50: an activity fact with weak personal signal ("maintains a personal knowledge vault").',
  '- 20: about a system, project, tool, or event, not the person.',
] as const

/**
 * Split large content into processable chunks, breaking at sentence boundaries.
 */
function chunkContent(content: string): string[] {
  if (content.length <= MAX_CHUNK_SIZE) {
    return [content]
  }

  const chunks: string[] = []
  let remaining = content

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_SIZE) {
      chunks.push(remaining)
      break
    }

    // Find a good break point near the limit (sentence or paragraph boundary)
    let breakPoint = MAX_CHUNK_SIZE

    // Try paragraph break first
    const paragraphBreak = remaining.lastIndexOf('\n\n', MAX_CHUNK_SIZE)
    if (paragraphBreak > MAX_CHUNK_SIZE * 0.5) {
      breakPoint = paragraphBreak + 2
    } else {
      // Try sentence break
      const sentenceBreak = remaining.lastIndexOf('. ', MAX_CHUNK_SIZE)
      if (sentenceBreak > MAX_CHUNK_SIZE * 0.5) {
        breakPoint = sentenceBreak + 2
      }
    }

    chunks.push(remaining.substring(0, breakPoint).trim())
    remaining = remaining.substring(breakPoint).trim()
  }

  return chunks
}

// ============================================
// AI-Powered Extraction
// ============================================

/**
 * Build the system prompt based on source type.
 */
function buildSystemPrompt(ctx: ExtractionContext): string {
  const who = ctx.userName
    ? ` The material belongs to ${ctx.userName}${ctx.occupation ? `, ${ctx.occupation}` : ''}.`
    : ''

  return `<role>
You extract verified-quality personal insights for me.md, a local-first personal-knowledge
tool. An insight is a portable, first-person-true statement about this person that another
tool could use to act more like them.${who}
</role>

<what_counts_as_an_insight>
An insight is durable self-knowledge — something about WHO THIS PERSON IS, not what they
built, ran, shipped, or attended. Extract ONLY these kinds:
- belief: a conviction about how the world, people, or work functions. "Believes small teams outperform large ones."
- value: what they hold important and protect under pressure. "Values honesty over harmony when giving feedback."
- trait: a stable character attribute or disposition. "Approaches problems methodically rather than intuitively."
- habit: a recurring personal behavior pattern they own. "Writes every morning before opening any messages."
- preference: a durable like or dislike that shapes choices. "Prefers written async communication over meetings."
- goal: a personally held aspiration or direction. "Wants to move from consulting into building products."
- motivation: a driver, fear, or need that explains behavior. "Is driven by a fear of depending on things he cannot inspect."
- relationship_pattern: how they characteristically relate to people. "Withdraws rather than argues when trust is broken."
- self_assessment: their own judgment of strengths and limits. "Considers himself a strong starter but a weak finisher."

Do NOT extract — unless the statement reveals a durable personal pattern:
- project/tool/system mechanics (pipelines, servers, configs, automations, repos)
- biographical logistics (dates, addresses, schedules, job titles as bare facts)
- third-party facts (statements about other people, companies, or tools)
- event descriptions (things that happened once: attended, migrated, launched, fixed)

Worked distinction: "Runs automated weekly harvest processes over his knowledge vault" is an
EXCLUDED system fact — it describes machinery. The durable pattern it may reveal — "Builds
redundant verification into systems he depends on — distrusts single sources of truth" — is
an INCLUDED trait. When the content supports it, extract the second form; otherwise extract
nothing.

Litmus test — apply to every candidate before emitting it: Would this sentence belong in a
psychological profile, not a resume or changelog? Would it still describe the person in a
year? If either answer is no, do not emit it.
</what_counts_as_an_insight>

<rules>
- Extract only what the content genuinely supports. It is correct to return an empty array
  when the content is impersonal, generic, or not about this person.
- Never invent, infer beyond the evidence, or restate a question as an insight.
- Write each insight as a clean declarative statement in plain prose. Strip any markdown,
  formatting, list markers, or emoji from your output — content, not syntax.
- If the content is in a language other than English, write insights in that same language.
- Deduplicate against the provided verified insights; skip anything equivalent.
</rules>

<output_contract>
Return a JSON array and nothing else — no prose, no code fences. Each element:
{"content": string (<=300 chars, a full sentence),
 "confidenceScore": integer 50-95,
 "kind": one of "belief"|"value"|"trait"|"habit"|"preference"|"goal"|"motivation"|"relationship_pattern"|"self_assessment",
 "self_relevance": integer 0-100}
self_relevance calibration — how much the statement is about the PERSON:
- 90-100: directly about who the person is (a belief, value, trait, or pattern they own).
- 50: an activity fact with weak personal signal ("maintains a personal knowledge vault").
- 20: about a system, project, tool, or event, not the person.
Items with self_relevance below 60 will be discarded; do not pad scores to survive the cut —
prefer omitting the item.
Empty input or no genuine insights -> return exactly: []
</output_contract>`
}

/**
 * Build the user prompt adapted to the source type.
 */
function buildUserPrompt(ctx: ExtractionContext, contentChunk: string): string {
  const deduplicationSection = ctx.existingVerifiedInsights && ctx.existingVerifiedInsights.length > 0
    ? `\n## Existing Verified Insights (DO NOT duplicate these)
${ctx.existingVerifiedInsights.map(i => `- "${i.content}" (confidence: ${i.confidenceScore})`).join('\n')}
\nAvoid extracting insights that are semantically equivalent to any of the above.\n`
    : ''

  const topicContext = ctx.topicTitle
    ? ` about "${ctx.topicTitle}"${ctx.topicDescription ? ` (${ctx.topicDescription})` : ''}`
    : ''

  // Adapt extraction instructions based on source type
  let sourceInstructions: string
  let insightRange: string

  switch (ctx.sourceType) {
    case 'interview':
      insightRange = '3-10'
      sourceInstructions = `Extract self-knowledge insights from the following interview session${topicContext}.
## Conversation Transcript

${contentChunk}`
      break

    case 'import_chatgpt':
      insightRange = '5-15'
      sourceInstructions = `Extract self-knowledge insights from the following ChatGPT memory export${topicContext}. This content represents structured personal data the user previously shared with ChatGPT.

## ChatGPT Memory Content

${contentChunk}`
      break

    case 'import_url':
      insightRange = '3-10'
      sourceInstructions = `Extract self-knowledge insights from the following web page content${topicContext}. Look for personal relevance only where the content actually supports it.

## Web Page Content

${contentChunk}`
      break

    case 'import_text':
    case 'import_file':
      insightRange = '3-12'
      sourceInstructions = `Extract self-knowledge insights from the following ${ctx.sourceType === 'import_file' ? 'uploaded file' : 'text'} content${topicContext}.

## Imported Content

${contentChunk}`
      break

    default:
      insightRange = '3-10'
      sourceInstructions = `Extract self-knowledge insights from the following content${topicContext}.

## Content

${contentChunk}`
  }

  return `${sourceInstructions}
${deduplicationSection}
<task>
Extract ${insightRange} insights that are specific and grounded in what the content actually
reveals. Prefer fewer, sharper insights over padding. Assign each insight a \`kind\` from the
taxonomy and a \`self_relevance\` score per the calibration. Apply the litmus test:
psychological profile, not resume or changelog; still true of the person in a year.

Do not extract: statements true of anyone ("wants to be happy"), restated prompts, vague
emotional reactions with no substance, or facts about the person's systems, projects,
tooling, or one-off events unless they reveal a durable personal pattern.
</task>

<confidence_calibration>
Score how well the CONTENT supports the insight, not how nice it sounds:
- 50-60: implied or inferred; stated once, hedged, or low specificity.
- 61-75: stated plainly with reasonable specificity; single clear mention.
- 76-85: stated with conviction AND concrete specifics, or reinforced 2+ times.
- 86-95: emphatic, highly specific with context, and recurring across the content.
Worked example — source: "I've turned down two promotions because managing people pulls me
away from the actual engineering, which is the part I can't give up."
-> {"content":"Chooses hands-on engineering over management, having declined promotions to
stay technical","confidenceScore":88,"kind":"preference","self_relevance":95}  (emphatic + specific +
evidenced by a concrete action = high band).
confidenceScore measures evidence strength; self_relevance measures whether the statement is
about the person at all. Score them independently.
</confidence_calibration>

Return the JSON array only.`
}

/** Exported for tests. Validates + normalizes raw parsed items from the LLM.
 *  Returns kept insights (with category derived from kind) and the count dropped
 *  by the personhood filter (invalid/missing kind or self_relevance < 60). */
export function normalizeAiCandidates(
  parsed: unknown[]
): { kept: Array<{ content: string; confidenceScore: number; category: string }>; droppedByPersonhood: number } {
  let droppedByPersonhood = 0
  const kept = parsed
    .filter((item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null)
    .filter(obj =>
      typeof obj.content === 'string' && typeof obj.confidenceScore === 'number')
    .filter(obj => {
      const kindOk = typeof obj.kind === 'string' && obj.kind in KIND_TO_CATEGORY
      const rel = obj.self_relevance
      const relOk = typeof rel === 'number' && Number.isFinite(rel) && rel >= MIN_SELF_RELEVANCE
      if (kindOk && relOk) return true
      droppedByPersonhood += 1
      return false
    })
    .map(obj => ({
      content: (obj.content as string).substring(0, 500),
      confidenceScore: Math.min(Math.max(obj.confidenceScore as number, 50), 95),
      category: KIND_TO_CATEGORY[obj.kind as string],
    }))
    .slice(0, MAX_INSIGHTS_PER_CHUNK)
  return { kept, droppedByPersonhood }
}

/**
 * Call Claude API for insight extraction from a single chunk.
 */
async function callClaudeForInsights(
  systemPrompt: string,
  userPrompt: string
): Promise<Array<{ content: string; confidenceScore: number; category: string }> | null> {
  if (!isApiKeyConfigured()) return null

  try {
    console.log('[me.md:insight-extraction] Calling Claude API for unified insight extraction')
    const responseText = await callAnthropic({
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
      maxTokens: 4096,
    })

    if (!responseText || responseText.trim().length === 0) {
      console.warn('[me.md:insight-extraction] Claude returned empty response.')
      return null
    }

    console.log(`[me.md:insight-extraction] Response received (${responseText.length} chars)`)

    const parsed = extractJson<unknown[]>(responseText)
    if (!Array.isArray(parsed)) return null

    const { kept, droppedByPersonhood } = normalizeAiCandidates(parsed)
    if (droppedByPersonhood > 0) {
      console.log(`[me.md:insight-extraction] Personhood filter dropped ${droppedByPersonhood} candidate(s) (self_relevance < ${MIN_SELF_RELEVANCE} or missing/invalid kind)`)
    }
    return kept
  } catch (error: unknown) {
    const err = error as { message?: string }
    console.warn(`[me.md:insight-extraction] Failed to parse AI extraction result: ${err.message || 'Unknown error'}`)
    return null
  }
}

// ============================================
// Rule-Based Fallback Extraction
// ============================================

/** First-person / possessive self-reference. */
export const FIRST_PERSON_RE =
  /\b(i am|i'm|i was|i have|i've|i believe|i value|i prefer|i enjoy|i love|i hate|i fear|i want|i need|i always|i never|i tend to|i care about|i avoid|i struggle with|my|myself|mine)\b/i

/** Third-person profile frames — vault notes often say "Prefers X" / "Believes Y".
 *  Deliberately EXCLUDES bare "always|never" (only first-person "i always|i never" counts,
 *  via FIRST_PERSON_RE) so "The server always restarts at midnight" cannot sneak through. */
export const PROFILE_FRAME_RE =
  /\b(believes?|values?|prefers?|enjoys?|loves?|hates?|fears?|avoids?|distrusts?|tends? to|cares? about|is (?:motivated|driven) by|aspires? to|strives? to|wants? to be|considers? (?:himself|herself|themselves))\b/i

/** System / project / event vocabulary — the changelog signal. */
export const SYSTEM_EVENT_RE =
  /\b(runs?|running|ran|deploy(?:s|ed|ing)?|configur(?:es?|ed|ing)|install(?:s|ed|ing)?|automat(?:es?|ed|ing)|schedul(?:es?|ed|ing)|migrat(?:es?|ed|ing)|releas(?:es?|ed|ing)|pipelines?|cron|servers?|repos?|repositor(?:y|ies)|databases?|apis?|scripts?|workflows?|harvests?|backups?|v\d+(?:\.\d+)+)\b/i

export type GateVerdict = 'self' | 'frame' | 'neutral' | 'system'

/** Exported for tests. Precedence: self-reference beats system vocabulary —
 *  "I run a weekly pipeline" is still a statement about the person. */
export function selfReferenceGate(content: string): GateVerdict {
  if (FIRST_PERSON_RE.test(content)) return 'self'
  if (PROFILE_FRAME_RE.test(content)) return 'frame'
  if (SYSTEM_EVENT_RE.test(content)) return 'system'
  return 'neutral'
}

/**
 * Honest confidence for a rule-based fragment. The personhood gate is purely lexical: it
 * buys precision by dropping system/event facts at a recall cost for traits phrased like
 * system facts. We report a low, fixed band that says "unverified pattern match":
 *   - 45: first-person self-statement ("I value...", "My approach is...")
 *   - 38: third-person profile frame ("Prefers...", "Believes...")
 *   - 34: mixed personal/system signal, or curated ChatGPT memory floor
 *   - 32: neutral fallback floor
 * These are deliberately below the AI floor (50) so Review sorts them last and the
 * "Rule-based" badge is never contradicted by a confident-looking number.
 */
function ruleBasedConfidence(statement: string, sourceType: SourceType, verdict: GateVerdict): number {
  if ((verdict === 'self' || verdict === 'frame') && SYSTEM_EVENT_RE.test(statement)) return 34
  if (verdict === 'self') return 45
  if (verdict === 'frame') return 38
  return sourceType === 'import_chatgpt' ? 34 : 32
}

/**
 * Categorize a statement by keyword analysis.
 */
function categorizeStatement(statement: string): string {
  const lower = cleanText(statement).toLowerCase()

  if (/\b(skill|expert|experience|professional|work|career|project|competent|proficien)\b/.test(lower)) return 'skills'
  if (/\b(goal|aspir|dream|plan|future|want to|aim|ambition)\b/.test(lower)) return 'goals'
  if (/\b(learn|grew|journey|story|memory|remember|once|when i was)\b/.test(lower)) return 'experiences'
  if (/\b(think|believe|approach|perspective|opinion|view|prefer|style|method)\b/.test(lower)) return 'perspectives'

  return 'identity'
}

/**
 * Get max insights based on source type.
 */
function getMaxInsights(sourceType: SourceType): number {
  switch (sourceType) {
    case 'interview':
      return 10
    case 'import_chatgpt':
      return 30
    case 'import_url':
      return 20
    case 'import_text':
    case 'import_file':
      return 25
    default:
      return 15
  }
}

/**
 * Extract insights using rule-based pattern matching (fallback when AI unavailable).
 */
function extractInsightsFallback(ctx: ExtractionContext): ExtractedInsight[] {
  const results: ExtractedInsight[] = []
  const maxInsights = getMaxInsights(ctx.sourceType)

  const emit = (rawStatement: string, category?: string) => {
    // Gate on the raw fragment so table/heading/task shape remains detectable,
    // then store cleaned text so markdown never reaches content or titles.
    if (!isDeclarativeStatement(rawStatement)) return
    const content = cleanText(rawStatement).slice(0, 500).trim()
    if (content.length < 25) return
    const verdict = selfReferenceGate(content)
    if (verdict === 'system') return // pure system/event statement — not personhood
    results.push({
      content,
      confidenceScore: ruleBasedConfidence(content, ctx.sourceType, verdict),
      category: category ?? categorizeStatement(content),
      extractionMethod: 'fallback',
    })
  }

  // Special handling for ChatGPT structured sections
  if (ctx.sourceType === 'import_chatgpt') {
    // Try to detect structured sections in the content
    const sectionCategoryMap: Record<string, string> = {
      'personal background': 'identity',
      'communication style': 'perspectives',
      'values & beliefs': 'identity',
      'interests & hobbies': 'experiences',
      'professional life': 'skills',
      'decision-making style': 'perspectives',
      'strengths & weaknesses': 'skills',
      'goals & aspirations': 'goals',
      'preferences': 'perspectives',
      'personality traits': 'identity',
    }

    const sectionRegex = /^##?\s*(.+)$/gm
    const positions: Array<{ name: string; start: number }> = []
    let m

    while ((m = sectionRegex.exec(ctx.content)) !== null) {
      positions.push({ name: m[1].trim(), start: m.index + m[0].length })
    }

    if (positions.length > 0) {
      for (let i = 0; i < positions.length; i++) {
        const end = i + 1 < positions.length ? positions[i + 1].start : ctx.content.length
        const body = ctx.content.substring(positions[i].start, end)
        const category = sectionCategoryMap[positions[i].name.toLowerCase()] || 'identity'
        for (const part of body.split(/(?<=[.!?])\s+|\n+/)) emit(part, category)
      }

      if (results.length > 0) {
        return deduplicateInsights(results, ctx.existingVerifiedInsights).slice(0, maxInsights)
      }
    }
  }

  // Splitting on lines first preserves markdown-block shape for the gate to reject.
  for (const line of ctx.content.split(/\n+/)) {
    for (const part of line.split(/(?<=[.!?])\s+/)) emit(part)
  }

  return deduplicateInsights(results, ctx.existingVerifiedInsights).slice(0, maxInsights)
}

// ============================================
// Deduplication
// ============================================

/**
 * Remove duplicate insights (case-insensitive) and filter out
 * insights that are semantically too similar to existing verified insights.
 */
function deduplicateInsights(
  insights: ExtractedInsight[],
  existingVerified?: Array<{ content: string; confidenceScore: number }>
): ExtractedInsight[] {
  // Remove exact duplicates (case-insensitive)
  const seen = new Set<string>()
  const unique = insights.filter(insight => {
    const key = insight.content.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // If we have existing verified insights, filter out near-duplicates
  if (existingVerified && existingVerified.length > 0) {
    const existingLower = existingVerified.map(i => i.content.toLowerCase().trim())
    return unique.filter(insight => {
      const lowerContent = insight.content.toLowerCase().trim()
      // Check for high overlap with existing insights
      return !existingLower.some(existing => {
        // Exact match
        if (existing === lowerContent) return true
        // One contains the other (substring match for significant overlap)
        if (existing.length > 30 && lowerContent.length > 30) {
          if (existing.includes(lowerContent) || lowerContent.includes(existing)) return true
        }
        return false
      })
    })
  }

  return unique
}

// ============================================
// Main Extraction Pipeline
// ============================================

/** Maximum number of AI retry attempts before falling back to rule-based extraction */
const AI_RETRY_ATTEMPTS = 1

/**
 * Attempt a single AI call with retry logic.
 * Returns null only if both the initial call and retry fail.
 */
async function callClaudeForInsightsWithRetry(
  systemPrompt: string,
  userPrompt: string
): Promise<Array<{ content: string; confidenceScore: number; category: string }> | null> {
  // First attempt
  const firstResult = await callClaudeForInsights(systemPrompt, userPrompt)
  if (firstResult) return firstResult

  // Retry logic
  for (let attempt = 1; attempt <= AI_RETRY_ATTEMPTS; attempt++) {
    console.warn(`[me.md:insight-extraction] AI extraction attempt failed, retrying (${attempt}/${AI_RETRY_ATTEMPTS})...`)
    // Brief delay before retry (500ms * attempt)
    await new Promise(resolve => setTimeout(resolve, 500 * attempt))
    const retryResult = await callClaudeForInsights(systemPrompt, userPrompt)
    if (retryResult) {
      console.log(`[me.md:insight-extraction] AI extraction succeeded on retry attempt ${attempt}`)
      return retryResult
    }
  }

  return null
}

/**
 * Apply confidence penalty to fallback-generated insights.
 * Fallback insights are lower quality, so we reduce their confidence scores
 * and cap them to signal that human review is especially important.
 */
function applyFallbackConfidencePenalty(insights: ExtractedInsight[]): ExtractedInsight[] {
  const FALLBACK_MAX_CONFIDENCE = 45 // rule-based can never look AI-confident

  return insights.map(i => ({
    ...i,
    confidenceScore: Math.min(Math.max(i.confidenceScore, 25), FALLBACK_MAX_CONFIDENCE),
  }))
}

/**
 * Extract insights from content using the unified pipeline.
 *
 * This is the main entry point for all insight extraction. It:
 * 1. Chunks large content if needed
 * 2. Attempts AI-powered extraction with Claude (with retry)
 * 3. Falls back to rule-based extraction if AI is unavailable (with logging/flagging)
 * 4. Deduplicates results and applies consistent formatting
 *
 * @param ctx - Extraction context with content, source type, and optional metadata
 * @returns Array of standardized extracted insights
 */
export async function extractInsights(ctx: ExtractionContext): Promise<ExtractedInsight[]> {
  if (!ctx.content || ctx.content.trim().length === 0) {
    return []
  }

  console.log(`[me.md:insight-extraction] Starting unified extraction: sourceType=${ctx.sourceType}, contentLength=${ctx.content.length}`)

  // For interviews, format the content as a conversation transcript if it isn't already
  const processedContent = stripFrontmatter(ctx.content)

  // Chunk large content
  const chunks = chunkContent(processedContent)
  console.log(`[me.md:insight-extraction] Content split into ${chunks.length} chunk(s)`)

  // Track whether fallback was used for any chunk
  let fallbackUsedForChunks = 0
  let aiSuccessForChunks = 0

  // Try AI extraction first
  if (isApiKeyConfigured()) {
    try {
      const systemPrompt = buildSystemPrompt(ctx)
      const allInsights: ExtractedInsight[] = []

      for (const chunk of chunks) {
        const userPrompt = buildUserPrompt(ctx, chunk)
        // Use retry-enabled version: tries once, then retries up to AI_RETRY_ATTEMPTS times
        const aiResult = await callClaudeForInsightsWithRetry(systemPrompt, userPrompt)

        if (aiResult) {
          aiSuccessForChunks++
          for (const item of aiResult) {
            allInsights.push({
              ...item,
              extractionMethod: 'ai',
            })
          }
        } else {
          // AI failed even after retry for this chunk — use fallback with logging
          fallbackUsedForChunks++
          console.warn(`[me.md:insight-extraction] FALLBACK ACTIVATED for chunk (sourceType=${ctx.sourceType}, topic="${ctx.topicTitle || 'unknown'}"): AI extraction failed after ${AI_RETRY_ATTEMPTS + 1} attempt(s). Using rule-based extraction — insights may be lower quality.`)
          const fallbackResults = extractInsightsFallback({
            ...ctx,
            content: chunk,
          })
          // Apply confidence penalty to fallback insights
          const penalizedResults = applyFallbackConfidencePenalty(fallbackResults)
          allInsights.push(...penalizedResults)
        }

        // Stop if we have enough insights
        if (allInsights.length >= MAX_TOTAL_INSIGHTS) break
      }

      // Log summary of extraction methods used
      if (fallbackUsedForChunks > 0) {
        console.warn(`[me.md:insight-extraction] EXTRACTION SUMMARY: ${aiSuccessForChunks} chunk(s) via AI, ${fallbackUsedForChunks} chunk(s) via fallback. Fallback insights have reduced confidence scores and are flagged with extractionMethod='fallback'.`)
      }

      if (allInsights.length > 0) {
        const deduplicated = deduplicateInsights(allInsights, ctx.existingVerifiedInsights)
        console.log(`[me.md:insight-extraction] Extraction complete: ${deduplicated.length} insights (${deduplicated.filter(i => i.extractionMethod === 'ai').length} AI, ${deduplicated.filter(i => i.extractionMethod === 'fallback').length} fallback)`)
        return deduplicated.slice(0, MAX_TOTAL_INSIGHTS)
      }

      // The AI answered every chunk and found nothing. That verdict is the result;
      // do not overrule it with rule-based extraction over the same content.
      if (aiSuccessForChunks > 0 && fallbackUsedForChunks === 0) {
        console.log('[me.md:insight-extraction] AI reviewed all content and found no genuine insights; honoring the empty result.')
        return []
      }
    } catch (error: unknown) {
      const err = error as { message?: string }
      console.warn(`[me.md:insight-extraction] AI extraction pipeline failed entirely, using full fallback: ${err.message || 'Unknown error'}`)
    }
  } else {
    console.warn(`[me.md:insight-extraction] AI is not available (no API key configured). All insights will use rule-based fallback.`)
  }

  // Fallback to rule-based extraction for ALL content
  console.warn(`[me.md:insight-extraction] FULL FALLBACK ACTIVATED for sourceType=${ctx.sourceType}, topic="${ctx.topicTitle || 'unknown'}": All insights generated via rule-based extraction.`)
  const fallbackResults = extractInsightsFallback({ ...ctx, content: processedContent })
  // Apply confidence penalty to all fallback insights
  const penalizedResults = applyFallbackConfidencePenalty(fallbackResults)
  console.log(`[me.md:insight-extraction] Fallback extraction complete: ${penalizedResults.length} insights (all flagged as fallback with reduced confidence)`)
  return penalizedResults
}

/**
 * Helper to format interview messages into a conversation transcript string.
 * Use this when preparing interview content for the unified extraction service.
 */
export function formatInterviewTranscript(
  userMessages: Array<{ role: string; content: string }>,
  assistantMessages: Array<{ role: string; content: string }>
): string {
  const lines: string[] = []
  const maxMessages = Math.max(userMessages.length, assistantMessages.length)
  for (let i = 0; i < maxMessages; i++) {
    if (i < assistantMessages.length) {
      lines.push(`**Interviewer:** ${assistantMessages[i].content}`)
    }
    if (i < userMessages.length) {
      lines.push(`**User:** ${userMessages[i].content}`)
    }
  }
  return lines.join('\n\n')
}
