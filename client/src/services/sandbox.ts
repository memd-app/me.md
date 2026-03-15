/**
 * Sandbox Comparison Service
 * ===========================
 * Ported from server/src/routes/sandbox.ts
 * Generates side-by-side generic vs personalized AI responses,
 * demonstrating the value of verified personal context.
 */

import { eq, and, desc } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import { insights, users, topics } from '@/db/schema'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { callAnthropic, streamAnthropic, isApiKeyConfigured } from './anthropic'

type Db = SQLJsDatabase<typeof schema>

// ============================================
// Profile context types and keyword categorization
// ============================================

interface ProfileContext {
  userName: string
  occupation: string
  location: string
  communicationStyle: string[]
  toneOfVoice: string[]
  personalTraits: string[]
  strengths: string[]
  decisionPatterns: string[]
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  communicationStyle: [
    'communicate', 'communication', 'speak', 'talk', 'write', 'writing',
    'email', 'conversation', 'express', 'tone', 'language', 'word',
    'listen', 'feedback', 'direct', 'indirect', 'formal', 'informal',
    'prefer to say', 'way i', 'style', 'approach to', 'respond',
    'message', 'clarity', 'concise', 'verbose', 'articulate',
  ],
  toneOfVoice: [
    'tone', 'voice', 'humor', 'humour', 'sarcasm', 'sarcastic',
    'serious', 'casual', 'formal', 'warm', 'cold', 'empathetic',
    'blunt', 'diplomatic', 'friendly', 'reserved', 'enthusiastic',
    'calm', 'passionate', 'measured', 'emotional', 'detached',
    'witty', 'dry', 'encouraging', 'supportive', 'critical',
  ],
  personalTraits: [
    'value', 'believe', 'belief', 'core', 'trait', 'identity', 'principle',
    'important to me', 'who i am', 'personality', 'character', 'define',
    'fundamental', 'deeply', 'always', 'never', 'matter', 'care about',
    'passionate', 'driven', 'motivated', 'philosophy', 'worldview',
  ],
  strengths: [
    'strength', 'strong', 'expert', 'expertise', 'skill', 'skilled',
    'good at', 'excel', 'talent', 'ability', 'capable', 'competent',
    'proficient', 'experience', 'knowledge', 'know how', 'specialize',
    'professional', 'craft', 'master', 'accomplish', 'achievement',
  ],
  decisionPatterns: [
    'decide', 'decision', 'choose', 'choice', 'evaluate', 'weigh',
    'consider', 'prioritize', 'priority', 'trade-off', 'tradeoff',
    'framework', 'criteria', 'factor', 'process', 'approach',
    'strategy', 'analyze', 'analysis', 'risk', 'opportunity',
    'gut feeling', 'intuition', 'data-driven', 'rational', 'logic',
  ],
}

function categorizeInsight(content: string): string[] {
  const lowerContent = content.toLowerCase()
  const categories: string[] = []
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.filter(kw => lowerContent.includes(kw)).length >= 1) {
      categories.push(category)
    }
  }
  return categories
}

function getProfileContext(db: Db): ProfileContext | null {
  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) return null

  const verifiedInsights = db.select({
    content: insights.content,
    topicTitle: topics.title,
  }).from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(and(eq(insights.userId, LOCAL_USER_ID), eq(insights.verificationStatus, 'verified')))
    .orderBy(desc(insights.confidenceScore))
    .all()

  const categorized: Record<string, string[]> = {
    communicationStyle: [],
    toneOfVoice: [],
    personalTraits: [],
    strengths: [],
    decisionPatterns: [],
  }

  for (const insight of verifiedInsights) {
    const cats = categorizeInsight(insight.content)
    for (const cat of cats) {
      if (categorized[cat] && categorized[cat].length < 5) {
        categorized[cat].push(insight.content)
      }
    }
  }

  return {
    userName: user.name || '',
    occupation: user.occupation || '',
    location: user.location || '',
    communicationStyle: categorized.communicationStyle,
    toneOfVoice: categorized.toneOfVoice,
    personalTraits: categorized.personalTraits,
    strengths: categorized.strengths,
    decisionPatterns: categorized.decisionPatterns,
  }
}

// ============================================
// System prompts
// ============================================

function buildGenericSystemPrompt(): string {
  return `You are a helpful AI assistant. Respond to the user's prompt directly and helpfully.

## Important Rules
- You do NOT know anything about the user. Use placeholders like [Your Name], [Name], etc.
- Write in a neutral, professional tone
- Be helpful and complete, but your response should be clearly generic — it could apply to anyone
- Do NOT try to personalize or make assumptions about the user's style, preferences, or background
- Keep your response concise (under 300 words)
- If the prompt asks you to write something (email, introduction, etc.), produce the actual content — not instructions on how to write it`
}

function buildPersonalizedSystemPrompt(context: ProfileContext): string {
  const parts: string[] = []
  parts.push(`You are an AI writing assistant for me.md. You are writing on behalf of a specific user using their verified self-knowledge. Your goal is to produce content that genuinely sounds like the user.`)

  if (context.userName) {
    parts.push(`\n## User Identity`)
    parts.push(`Name: ${context.userName}`)
    if (context.occupation) parts.push(`Occupation: ${context.occupation}`)
    if (context.location) parts.push(`Location: ${context.location}`)
  }

  if (context.communicationStyle.length > 0) {
    parts.push(`\n## Communication Style (Verified Insights)`)
    for (const insight of context.communicationStyle) parts.push(`- ${insight}`)
  }

  if (context.toneOfVoice.length > 0) {
    parts.push(`\n## Tone of Voice (Verified Insights)`)
    for (const insight of context.toneOfVoice) parts.push(`- ${insight}`)
  }

  if (context.personalTraits.length > 0) {
    parts.push(`\n## Personal Traits & Values (Verified Insights)`)
    for (const insight of context.personalTraits) parts.push(`- ${insight}`)
  }

  if (context.strengths.length > 0) {
    parts.push(`\n## Strengths & Expertise (Verified Insights)`)
    for (const insight of context.strengths) parts.push(`- ${insight}`)
  }

  if (context.decisionPatterns.length > 0) {
    parts.push(`\n## Decision-Making Patterns (Verified Insights)`)
    for (const insight of context.decisionPatterns) parts.push(`- ${insight}`)
  }

  parts.push(`\n## Important Rules`)
  parts.push(`- Write AS the user, not about the user. Use their name to sign off where appropriate.`)
  parts.push(`- Match their communication style and tone based on the verified insights above.`)
  parts.push(`- Incorporate their values, strengths, and decision-making patterns naturally.`)
  parts.push(`- Keep your response concise (under 300 words).`)
  parts.push(`- If the prompt asks you to write something, produce the actual content.`)
  parts.push(`- DO NOT mention that you're an AI or that you're using verified insights.`)

  return parts.join('\n')
}

// ============================================
// Template-based fallbacks
// ============================================

function generateGenericResponseFallback(prompt: string): string {
  const lp = prompt.toLowerCase()
  if (lp.includes('email') && lp.includes('declin')) {
    return `Subject: Regarding the Upcoming Meeting\n\nDear [Name],\n\nThank you for the invitation. Unfortunately, I will not be able to attend due to a scheduling conflict.\n\nPlease let me know if there's anything else I can help with.\n\nBest regards,\n[Your Name]`
  }
  if (lp.includes('email') && (lp.includes('thank') || lp.includes('appreciation'))) {
    return `Subject: Thank You\n\nDear [Name],\n\nI wanted to express my gratitude for your help. Your assistance was greatly appreciated.\n\nBest regards,\n[Your Name]`
  }
  if (lp.includes('introduce') || lp.includes('introduction')) {
    return `Hello,\n\nMy name is [Your Name]. I work as a [Job Title] and I'm interested in [topic].\n\nI look forward to connecting with you.\n\nBest regards,\n[Your Name]`
  }
  return `Here's my response:\n\nThe key points to address are:\n1. Understanding the core requirements\n2. Identifying the best approach\n3. Executing with attention to detail\n\nLet me know if you need anything more specific.\n\nBest regards,\n[Your Name]`
}

function generatePersonalizedResponseFallback(_prompt: string, context: ProfileContext): string {
  const name = context.userName || 'there'
  const occupation = context.occupation ? ` (${context.occupation})` : ''
  return `Here's my take on this:\n\n${context.personalTraits.length > 0
    ? `Coming from my perspective - ${context.personalTraits[0].toLowerCase()} - here's how I see it:`
    : `Based on my experience, here's how I'd approach this:`}\n\nI've thought about this from a few angles:\n- The most important consideration is understanding the full picture\n- Building on experience\n- Taking concrete action\n\n${context.strengths.length > 0 ? `Drawing on my experience in ${context.strengths[0].toLowerCase()}, I'd emphasize attention to detail.` : ''}\n\nFeel free to reach out.\n\n${name}${occupation}`
}

const NO_CONTEXT_MESSAGE = `*Your me.md profile doesn't have enough verified insights yet to personalize this response.*

To see the difference context makes:
1. Complete some interview sessions to generate insights
2. Verify those insights in the Verification Queue
3. Come back here to see how your verified context transforms generic outputs`

// ============================================
// Public API
// ============================================

/**
 * Non-streaming sandbox comparison.
 */
export async function compareSandbox(db: Db, prompt: string) {
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('Prompt is required')
  }

  const trimmedPrompt = prompt.trim()
  const context = getProfileContext(db)
  const hasContext = !!(context && (
    context.communicationStyle.length > 0 ||
    context.toneOfVoice.length > 0 ||
    context.personalTraits.length > 0 ||
    context.strengths.length > 0
  ))

  let genericOutput: string
  let personalizedOutput: string
  let usedAI = false

  if (isApiKeyConfigured()) {
    try {
      const [genericResult, personalizedResult] = await Promise.all([
        callAnthropic({ messages: [{ role: 'user', content: trimmedPrompt }], system: buildGenericSystemPrompt() }),
        hasContext && context
          ? callAnthropic({ messages: [{ role: 'user', content: trimmedPrompt }], system: buildPersonalizedSystemPrompt(context) })
          : Promise.resolve(null),
      ])

      genericOutput = genericResult
      usedAI = true
      personalizedOutput = personalizedResult ?? (hasContext ? genericResult : NO_CONTEXT_MESSAGE)
    } catch {
      genericOutput = generateGenericResponseFallback(trimmedPrompt)
      personalizedOutput = hasContext && context
        ? generatePersonalizedResponseFallback(trimmedPrompt, context)
        : NO_CONTEXT_MESSAGE
    }
  } else {
    genericOutput = generateGenericResponseFallback(trimmedPrompt)
    personalizedOutput = hasContext && context
      ? generatePersonalizedResponseFallback(trimmedPrompt, context)
      : NO_CONTEXT_MESSAGE
  }

  return {
    prompt: trimmedPrompt,
    genericOutput,
    personalizedOutput,
    hasContext,
    usedAI,
    contextSummary: context ? {
      communicationInsights: context.communicationStyle.length,
      toneInsights: context.toneOfVoice.length,
      personalTraits: context.personalTraits.length,
      strengths: context.strengths.length,
      decisionPatterns: context.decisionPatterns.length,
    } : null,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Streaming sandbox comparison.
 * Returns two async generators: one for generic, one for personalized.
 */
export function compareSandboxStream(db: Db, prompt: string): {
  hasContext: boolean
  contextSummary: Record<string, number> | null
  generic: () => AsyncGenerator<string, string, undefined>
  personalized: () => AsyncGenerator<string, string, undefined>
} {
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('Prompt is required')
  }

  const trimmedPrompt = prompt.trim()
  const context = getProfileContext(db)
  const hasContext = !!(context && (
    context.communicationStyle.length > 0 ||
    context.toneOfVoice.length > 0 ||
    context.personalTraits.length > 0 ||
    context.strengths.length > 0
  ))

  const contextSummary = context ? {
    communicationInsights: context.communicationStyle.length,
    toneInsights: context.toneOfVoice.length,
    personalTraits: context.personalTraits.length,
    strengths: context.strengths.length,
    decisionPatterns: context.decisionPatterns.length,
  } : null

  // Generic stream
  const generic = () => {
    if (!isApiKeyConfigured()) {
      return singleChunkGenerator(generateGenericResponseFallback(trimmedPrompt))
    }
    return streamAnthropic({
      messages: [{ role: 'user', content: trimmedPrompt }],
      system: buildGenericSystemPrompt(),
    })
  }

  // Personalized stream
  const personalized = () => {
    if (!hasContext || !context) {
      return singleChunkGenerator(NO_CONTEXT_MESSAGE)
    }
    if (!isApiKeyConfigured()) {
      return singleChunkGenerator(generatePersonalizedResponseFallback(trimmedPrompt, context))
    }
    return streamAnthropic({
      messages: [{ role: 'user', content: trimmedPrompt }],
      system: buildPersonalizedSystemPrompt(context),
    })
  }

  return { hasContext, contextSummary, generic, personalized }
}

/**
 * Check if user has enough context for personalized responses.
 */
export function getContextStatus(db: Db) {
  const context = getProfileContext(db)
  const totalInsights = context ? (
    context.communicationStyle.length +
    context.toneOfVoice.length +
    context.personalTraits.length +
    context.strengths.length +
    context.decisionPatterns.length
  ) : 0

  return {
    hasContext: totalInsights > 0,
    totalCategorizedInsights: totalInsights,
    aiAvailable: isApiKeyConfigured(),
    categories: context ? {
      communicationStyle: context.communicationStyle.length,
      toneOfVoice: context.toneOfVoice.length,
      personalTraits: context.personalTraits.length,
      strengths: context.strengths.length,
      decisionPatterns: context.decisionPatterns.length,
    } : null,
  }
}

// Helper: create an async generator that yields a single chunk
async function* singleChunkGenerator(text: string): AsyncGenerator<string, string, undefined> {
  yield text
  return text
}
