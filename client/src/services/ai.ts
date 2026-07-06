import { callAnthropic, streamAnthropic, isApiKeyConfigured } from './anthropic'
import { cleanText, extractJson } from './textCleaning'

// ============================================
// AI Service Layer - Claude API Integration
// ============================================
// Client-side AI service for me.md interview sessions.
// All API calls go directly from the browser to api.anthropic.com via anthropic.ts.
// Falls back to template-based responses when API key is not configured
// or when API calls fail.

/**
 * Check if the Claude API is available (API key configured).
 */
export function isAIAvailable(): boolean {
  return isApiKeyConfigured()
}

// ============================================
// Profile & Interview Context Types
// ============================================

export interface ProfileContext {
  userName: string
  occupation: string
  verifiedInsights: Array<{ content: string; topicTitle: string; confidenceScore: number }>
  previousSessionTopics: Array<{ title: string; sessionCount: number; status: string }>
  relatedInsights: Array<{ content: string; topicTitle: string }>
}

export interface InterviewMapAngle {
  id: string
  label: string
  description: string
  questionFocus: string
  explored: boolean
}

export interface InterviewMap {
  type: 'default'
  angles: InterviewMapAngle[]
  currentAngleIndex: number
  breadthFirstComplete: boolean
}

type Methodology = 'clean_language' | 'socratic' | 'five_whys' | 'appreciative_inquiry' | 'micro_phenomenology'

// ============================================
// System Prompt Construction
// ============================================

const METHODOLOGY_DESCRIPTIONS: Record<Methodology, string> = {
  clean_language: `Clean Language: Use the user's exact words in your reflections and questions. Ask "And what kind of [X] is that [X]?", "And is there anything else about [X]?", "And where is [X]?", "And what would you like to have happen?". Avoid introducing your own metaphors or interpretations — mirror the user's language precisely.`,
  socratic: `Socratic Method: Help the user examine their assumptions and beliefs through thoughtful questioning. Ask about evidence, counter-examples, and implications. Challenge ideas constructively to deepen understanding. Ask "What evidence supports this?", "What would someone who disagrees say?", "What assumptions are you making?".`,
  five_whys: `Five Whys: Dig beneath surface-level answers to find root causes and core motivations. Keep asking "why" in creative ways to peel back layers. Ask "Why does that matter to you?", "What's driving that at a deeper level?", "What's underneath that feeling/belief?".`,
  appreciative_inquiry: `Appreciative Inquiry: Focus on strengths, peak experiences, and what's working well. Help the user envision their ideal future. Ask about best moments, natural talents, and conditions for flourishing. Ask "When is this at its best?", "What strengths do you bring?", "What would the ideal look like?".`,
  micro_phenomenology: `Micro-Phenomenology: Slow down and explore the fine-grained texture of lived experience. Ask about sensory details, precise sequences of thoughts and feelings, and the quality of attention. Ask "What's the very first thing you notice?", "What does that feel like in your body?", "Walk me through that moment in slow motion.".`,
}

function selectMethodology(messageCount: number, intent: string): Methodology {
  const sequences: Record<string, Methodology[]> = {
    articulate: ['clean_language', 'micro_phenomenology', 'socratic', 'appreciative_inquiry', 'five_whys'],
    explore: ['appreciative_inquiry', 'socratic', 'clean_language', 'micro_phenomenology', 'five_whys'],
    decide: ['socratic', 'five_whys', 'clean_language', 'appreciative_inquiry', 'micro_phenomenology'],
    document: ['micro_phenomenology', 'clean_language', 'appreciative_inquiry', 'socratic', 'five_whys'],
  }
  const seq = sequences[intent] || sequences['explore']
  return seq[messageCount % seq.length]
}

/**
 * Build the system prompt for a standard interview session.
 */
function buildSystemPrompt(
  topicTitle: string,
  topicDescription: string,
  topicIntent: string,
  methodology: Methodology,
  profileContext: ProfileContext | undefined,
  interviewMap: InterviewMap | null,
  userMessageCount: number,
): string {
  const parts: string[] = []

  parts.push(`<role>
You are the interviewer for me.md, a personal-knowledge tool. You draw out what a person knows
about themselves through focused, one-question-at-a-time conversation. Your voice is that of a
considerate editor: literate, quiet, precise — warm without gushing, curious without flattery.
</role>`)
  parts.push(`You are interviewing the user about the topic: "${cleanText(topicTitle)}".`)

  if (topicDescription) {
    parts.push(`Topic description: ${cleanText(topicDescription)}`)
  }

  // Intent
  const intentDescriptions: Record<string, string> = {
    articulate: 'The user wants to articulate and put into words their thoughts on this topic.',
    explore: 'The user wants to explore and discover new perspectives about this topic.',
    decide: 'The user wants to work through a decision related to this topic.',
    document: 'The user wants to capture and document their knowledge about this topic.',
  }
  if (topicIntent && intentDescriptions[topicIntent]) {
    parts.push(`Interview intent: ${intentDescriptions[topicIntent]}`)
  }

  // Methodology guidance
  parts.push(`\n## Current Questioning Methodology\n${METHODOLOGY_DESCRIPTIONS[methodology]}`)

  // Interview map angle guidance
  if (interviewMap && interviewMap.type === 'default') {
    const angleIndex = userMessageCount % interviewMap.angles.length
    const currentAngle = interviewMap.angles[angleIndex]
    parts.push(`\n## Interview Map - Current Angle: ${currentAngle.label}`)
    parts.push(`You are exploring the "${currentAngle.label}" angle: ${currentAngle.description}.`)
    parts.push(`Focus your questions on: ${currentAngle.questionFocus}.`)
    parts.push(`The full interview map has 5 angles (Journey, Principles, Frameworks, Examples, Tensions). You are cycling through them breadth-first to ensure comprehensive coverage.`)

    // Every 3rd exchange, note the angle transition
    if (userMessageCount >= 3 && userMessageCount % 3 === 0) {
      parts.push(`This is a good moment to transition angles. Explicitly acknowledge the shift to the "${currentAngle.label}" perspective.`)
    }
  }

  // Profile context
  if (profileContext) {
    parts.push(`\n## User Profile Context`)
    if (profileContext.userName) {
      parts.push(`User's name: ${profileContext.userName}${profileContext.occupation ? `, occupation: ${profileContext.occupation}` : ''}.`)
    }

    if (profileContext.previousSessionTopics.length > 0) {
      const topicList = profileContext.previousSessionTopics
        .slice(0, 5)
        .map(t => `"${cleanText(t.title)}" (${t.sessionCount} session${t.sessionCount > 1 ? 's' : ''})`)
        .join(', ')
      parts.push(`Previously explored topics: ${topicList}.`)
    }

    if (profileContext.relatedInsights.length > 0) {
      parts.push(`\nVerified insights from related topics (use only when genuinely relevant):`)
      for (const insight of profileContext.relatedInsights.slice(0, 5)) {
        parts.push(`- [From "${cleanText(insight.topicTitle)}"]: "${cleanText(insight.content)}"`)
      }
    }

    const otherInsights = profileContext.verifiedInsights.filter(
      i => !profileContext.relatedInsights.some(r => r.content === i.content)
    ).slice(0, 5)

    if (otherInsights.length > 0) {
      parts.push(`\nOther verified self-knowledge:`)
      for (const insight of otherInsights) {
        parts.push(`- [From "${cleanText(insight.topicTitle)}"]: "${cleanText(insight.content)}"`)
      }
    }
  }

  parts.push(`<response_rules>
- Open with a brief reflection (2-4 sentences) in the person's own words, showing you followed
  what they said.
- Only draw a cross-topic connection when a provided verified insight is genuinely relevant.
  If none fits, don't invent one — a forced bridge is worse than none.
- Close with exactly ONE question, following the current methodology and angle.
- Use **bold** sparingly for a key concept and *italics* for the person's own words. Write in
  flowing prose; no numbered lists.
- Keep it to 3-6 sentences total. No exclamation marks. Don't praise; reflect.
</response_rules>`)

  if (userMessageCount >= 10) {
    parts.push(`\nNote: The conversation has been going for ${userMessageCount} exchanges. The user may want to wrap up soon. You can occasionally mention that they've built good depth and can finish and distill insights when they feel ready.`)
  }

  return parts.join('\n')
}

// ============================================
// Main AI Response Generation
// ============================================

export interface AIResponseOptions {
  topicTitle: string
  topicDescription: string
  topicIntent: string
  conversationHistory: Array<{ role: string; content: string }>
  profileContext?: ProfileContext
  interviewMap?: InterviewMap | null
}

/**
 * Build the system prompt and API messages from response options.
 * Shared between generateClaudeResponse and streamClaudeResponse.
 */
function prepareRequest(options: AIResponseOptions): {
  systemPrompt: string
  apiMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  userMessageCount: number
} | null {
  const {
    topicTitle,
    topicDescription,
    topicIntent,
    conversationHistory,
    profileContext,
    interviewMap,
  } = options

  const userMessages = conversationHistory.filter(m => m.role === 'user')
  const userMessageCount = userMessages.length

  const methodology = selectMethodology(userMessageCount, topicIntent || 'explore')
  const systemPrompt = buildSystemPrompt(
    topicTitle,
    topicDescription,
    topicIntent,
    methodology,
    profileContext,
    interviewMap || null,
    userMessageCount,
  )

  // Build the messages array from conversation history
  // The Anthropic API expects alternating user/assistant messages
  const apiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []

  for (const msg of conversationHistory) {
    const role = msg.role === 'user' ? 'user' as const : 'assistant' as const

    // Merge consecutive same-role messages (shouldn't happen but be safe)
    if (apiMessages.length > 0 && apiMessages[apiMessages.length - 1].role === role) {
      apiMessages[apiMessages.length - 1].content += '\n\n' + msg.content
    } else {
      apiMessages.push({ role, content: msg.content })
    }
  }

  // Ensure the last message is from the user (required by the API)
  if (apiMessages.length === 0 || apiMessages[apiMessages.length - 1].role !== 'user') {
    return null
  }

  return { systemPrompt, apiMessages, userMessageCount }
}

/**
 * Generate an AI response using the Claude API.
 * Returns the generated text, or null if the API is unavailable / call fails.
 * The caller should fall back to template-based generation on null.
 */
export async function generateClaudeResponse(options: AIResponseOptions): Promise<string | null> {
  if (!isAIAvailable()) {
    return null
  }

  const prepared = prepareRequest(options)
  if (!prepared) return null

  const { systemPrompt, apiMessages, userMessageCount } = prepared

  try {
    console.log(`[me.md:ai] Calling Claude API for session (${userMessageCount} user messages)`)

    const responseText = await callAnthropic({
      messages: apiMessages,
      system: systemPrompt,
      maxTokens: 1024,
    })

    if (!responseText || responseText.trim().length === 0) {
      console.warn('[me.md:ai] Claude returned empty response, falling back to template.')
      return null
    }

    console.log(`[me.md:ai] Claude response received (${responseText.length} chars)`)
    return responseText
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string; type?: string }
    const status = err.status
    const errType = err.type
    const message = err.message || 'Unknown error'

    if (status === 429) {
      console.warn(`[me.md:ai] Claude API rate limited. Falling back to template. ${message}`)
    } else if (status === 401 || status === 403) {
      console.error(`[me.md:ai] Claude API authentication error (${status}). Check API key in Settings. ${message}`)
    } else if (errType === 'overloaded_error') {
      console.warn(`[me.md:ai] Claude API overloaded. Falling back to template. ${message}`)
    } else {
      console.error(`[me.md:ai] Claude API error (status=${status}, type=${errType}): ${message}`)
    }

    return null
  }
}

/**
 * Generate an AI response with streaming.
 * Uses Claude's streaming API directly from the browser for real-time responses.
 * Returns an async generator of text chunks, or null if unavailable.
 */
export async function* streamClaudeResponse(options: AIResponseOptions): AsyncGenerator<string, string | null, undefined> {
  if (!isAIAvailable()) {
    return null
  }

  const prepared = prepareRequest(options)
  if (!prepared) return null

  const { systemPrompt, apiMessages, userMessageCount } = prepared

  try {
    console.log(`[me.md:ai] Streaming Claude API for session (${userMessageCount} user messages)`)

    let fullText = ''

    for await (const chunk of streamAnthropic({
      messages: apiMessages,
      system: systemPrompt,
      maxTokens: 1024,
    })) {
      fullText += chunk
      yield chunk
    }

    console.log(`[me.md:ai] Stream complete (${fullText.length} chars)`)
    return fullText
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string }
    console.error(`[me.md:ai] Claude streaming error: ${err.message || 'Unknown error'}`)
    return null
  }
}

// ============================================
// AI-Powered Quick Reply Suggestions
// ============================================

/**
 * Generate contextual quick reply suggestions using Claude API.
 * Analyzes the last few messages of conversation and the AI's latest response
 * to produce 3-4 short, first-person reply options that are contextually relevant.
 *
 * Returns null if the API is unavailable or the call fails.
 * The caller should fall back to template-based quick replies on null.
 */
export async function generateClaudeQuickReplies(
  conversationHistory: Array<{ role: string; content: string }>,
  lastAiResponse: string,
): Promise<string[] | null> {
  if (!isAIAvailable()) {
    return null
  }

  // Build a condensed context from the last few messages (to keep token usage low)
  const recentMessages = conversationHistory.slice(-6) // last 3 exchanges max
  const contextSummary = recentMessages.map(m => {
    const role = m.role === 'user' ? 'User' : 'Interviewer'
    // Truncate long messages to save tokens
    const content = m.content.length > 300 ? m.content.substring(0, 300) + '...' : m.content
    return `${role}: ${content}`
  }).join('\n\n')

  const systemPrompt = `You are a quick reply suggestion generator for me.md, a personal knowledge system. Your job is to generate 3-4 short, contextual quick reply options that the user might want to send in response to an AI interviewer's message.

## Rules
- Each reply MUST be in first-person voice ("I...", "My...", "That reminds me...")
- Each reply MUST be 1-2 sentences, under 15 words
- Replies should be CONTEXTUALLY relevant to what the interviewer just asked or discussed
- Provide a MIX of reply types: one that agrees/affirms, one that offers a specific example, one that goes deeper or challenges, and optionally one that redirects
- Do NOT use generic phrases like "Tell me more" — these are USER replies, not interviewer prompts
- Do NOT number the replies or add labels

## Output Format
Return ONLY the reply options, one per line, with no numbering, bullets, or other formatting. Exactly 3 or 4 lines.`

  const userPrompt = `Here is the recent conversation context:

${contextSummary}

The interviewer's latest message:
${lastAiResponse.length > 500 ? lastAiResponse.substring(0, 500) + '...' : lastAiResponse}

Generate 3-4 contextual first-person quick reply options for the user:`

  try {
    console.log('[me.md:ai] Calling Claude API for quick reply suggestions')
    const responseText = await callAnthropic({
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
      maxTokens: 256,
    })

    if (!responseText || responseText.trim().length === 0) {
      console.warn('[me.md:ai] Claude returned empty quick replies response.')
      return null
    }

    // Parse the response: one reply per line, filter empty lines
    const replies = responseText
      .split('\n')
      .map(line => line.trim())
      // Remove any numbering prefixes like "1.", "1)", "- ", "* "
      .map(line => line.replace(/^\d+[\.\)]\s*/, '').replace(/^[-*]\s*/, '').trim())
      .filter(line => line.length > 0 && line.length <= 100)

    if (replies.length < 2) {
      console.warn('[me.md:ai] Claude returned too few quick replies, falling back.')
      return null
    }

    // Take at most 4 replies
    const finalReplies = replies.slice(0, 4)
    console.log(`[me.md:ai] Quick replies generated: ${finalReplies.length} options`)
    return finalReplies
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string }
    console.error(`[me.md:ai] Claude quick replies error: ${err.message || 'Unknown error'}`)
    return null
  }
}

// ============================================
// AI-Powered Note Distillation
// ============================================

export interface DistillationContext {
  topicTitle: string
  topicDescription: string | null
  userMessages: Array<{ role: string; content: string }>
  assistantMessages: Array<{ role: string; content: string }>
  userName?: string
  occupation?: string
}

/**
 * Helper to call Claude for distillation. Returns null if AI is unavailable.
 */
async function callClaudeForDistillation(systemPrompt: string, userPrompt: string, maxTokens = 4096): Promise<string | null> {
  if (!isAIAvailable()) {
    return null
  }

  try {
    console.log('[me.md:ai] Calling Claude API for note distillation')
    const responseText = await callAnthropic({
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
      maxTokens,
    })

    if (!responseText || responseText.trim().length === 0) {
      console.warn('[me.md:ai] Claude returned empty distillation response.')
      return null
    }

    console.log(`[me.md:ai] Distillation response received (${responseText.length} chars)`)
    return responseText
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string }
    console.error(`[me.md:ai] Claude distillation error: ${err.message || 'Unknown error'}`)
    return null
  }
}

/**
 * Format the conversation transcript for inclusion in prompts.
 */
function formatConversationTranscript(
  userMessages: Array<{ role: string; content: string }>,
  assistantMessages: Array<{ role: string; content: string }>
): string {
  // Interleave messages in chronological order (assistant first, then user response)
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

/**
 * Generate a Full Analysis using Claude AI.
 * Returns null if AI is unavailable (caller should use fallback).
 */
export async function generateFullAnalysisAI(ctx: DistillationContext): Promise<string | null> {
  let transcript = formatConversationTranscript(ctx.userMessages, ctx.assistantMessages)
  if (transcript.length > 24000) {
    transcript = transcript.slice(0, 24000) + '\n\n[Transcript truncated to fit; distill only what appears above.]'
  }

  const systemPrompt = `You are a personal knowledge analyst for me.md, a personal knowledge system. Your job is to distill interview session conversations into deep, meaningful Full Analysis documents that capture the user's authentic self-knowledge.

You produce structured markdown output. Be specific, reference the user's actual words and ideas (using direct quotes where impactful), and surface patterns and insights that help the user understand themselves better.

If the session is too thin to support a section, say so plainly in that section rather than
inventing content (e.g. "This session didn't go deep enough here yet."). Never manufacture
principles or examples that the transcript doesn't contain.

${ctx.userName ? `The user's name is ${ctx.userName}${ctx.occupation ? `, occupation: ${ctx.occupation}` : ''}.` : ''}`

  const userPrompt = `Analyze the following interview session about "${ctx.topicTitle}"${ctx.topicDescription ? ` (${ctx.topicDescription})` : ''} and produce a Full Analysis document.

## Conversation Transcript

${transcript}

## Required Output Format

# Full Analysis: ${ctx.topicTitle}

## Context
Summarize what this session covered, how many exchanges occurred, and the overall depth of exploration.

## Core Principles
Identify 3-5 core principles, beliefs, or values that emerged from the user's responses. Use direct quotes from the user to support each principle.

## Mental Models & Frameworks
Identify decision-making patterns, mental models, or frameworks the user uses. Look for "when...then" patterns, habitual approaches, and recurring strategies.

## Key Examples
Highlight 2-3 specific examples, stories, or experiences the user shared. Quote them and explain their significance.

## Open Questions & Tensions
Identify areas of uncertainty, contradictions, or unresolved tensions. List 2-3 questions for further exploration.

Be specific and reference the user's actual words. Do NOT be generic.`

  return callClaudeForDistillation(systemPrompt, userPrompt)
}

/**
 * Generate structured JSON content using Claude AI.
 * Returns null if AI is unavailable (caller should use fallback).
 */
export async function generateJsonContentAI(ctx: DistillationContext): Promise<string | null> {
  const transcript = formatConversationTranscript(ctx.userMessages, ctx.assistantMessages)

  const systemPrompt = `You are a personal knowledge analyst for me.md. Your job is to extract structured data from interview sessions into a JSON format that can be consumed by AI agents and applications.

Output ONLY valid JSON with no markdown code fences, no explanation, and no commentary. Just the raw JSON object.
Arrays may be empty if the session doesn't support them; do not pad with placeholders.

${ctx.userName ? `The user's name is ${ctx.userName}${ctx.occupation ? `, occupation: ${ctx.occupation}` : ''}.` : ''}`

  const userPrompt = `Extract structured data from the following interview session about "${ctx.topicTitle}"${ctx.topicDescription ? ` (${ctx.topicDescription})` : ''}.

## Conversation Transcript

${transcript}

## Required JSON Structure

{
  "topic": "${ctx.topicTitle}",
  "sessionDate": "${new Date().toISOString()}",
  "messageCount": ${ctx.userMessages.length + ctx.assistantMessages.length},
  "userResponseCount": ${ctx.userMessages.length},
  "principles": ["Array of 3-5 core principles/beliefs the user expressed"],
  "frameworks": ["Array of 2-4 mental models or decision-making patterns identified"],
  "examples": ["Array of 2-3 key examples or experiences shared, summarized in 1-2 sentences each"],
  "decisions": ["Array of 2-4 decision-related statements or patterns"],
  "tags": ["Array of 3-6 relevant tags from: values, experience, decision-making, growth, relationships, career, creativity, leadership, communication, goals"]
}

Extract meaningful, specific content from the actual conversation. Do NOT use generic placeholders.`

  const result = await callClaudeForDistillation(systemPrompt, userPrompt)
  if (!result) return null

  const parsed = extractJson<unknown>(result)
  if (!parsed) {
    console.warn('[me.md:ai] Claude returned invalid JSON for distillation.')
    return null
  }
  return JSON.stringify(parsed)
}

/**
 * Generate AI-powered insights from session messages.
 * Returns null if AI is unavailable (caller should use fallback).
 */
export async function extractInsightsAI(ctx: DistillationContext): Promise<Array<{ content: string; confidenceScore: number }> | null> {
  const transcript = formatConversationTranscript(ctx.userMessages, ctx.assistantMessages)

  const systemPrompt = `You are a personal knowledge analyst for me.md, a system that builds verified personal context from AI-guided interviews. Your job is to semantically identify genuine personal insights from conversation — not keyword-match, but deeply understand what the user is revealing about themselves.

Output ONLY a valid JSON array with no markdown code fences, no explanation, and no commentary.

${ctx.userName ? `The user's name is ${ctx.userName}${ctx.occupation ? `, occupation: ${ctx.occupation}` : ''}.` : ''}`

  const userPrompt = `Extract self-knowledge insights from the following interview session about "${ctx.topicTitle}"${ctx.topicDescription ? ` (${ctx.topicDescription})` : ''}.
## Conversation Transcript

${transcript}

## Instructions

Extract 3-10 distinct, genuine self-knowledge insights — statements that capture something true and specific about the user. Each insight should be:
- A clear, declarative statement about the user (e.g., "Values autonomy over stability when making career decisions")
- Specific and grounded in what the user actually said (not generic truisms)
- Semantically meaningful — capturing genuine personal knowledge, not surface-level keywords
- Useful as portable context for other AI tools to understand and act like the user

Avoid extracting:
- Generic statements that could apply to anyone (e.g., "Wants to be happy")
- Simple restatements of the question
- Vague or purely emotional reactions without substance

## Confidence Scoring

Evaluate each insight's confidenceScore (50-95) based on THREE dimensions:

**Conviction** (How strongly/emphatically did the user express this?):
- Low: Hedged, tentative ("I think maybe...", "I'm not sure but...")
- Medium: Stated clearly but without emphasis
- High: Emphatic, repeated, or emotionally charged ("I absolutely...", "This is fundamental to who I am...")

**Specificity** (How precise and detailed is the insight?):
- Low: Broad generalization ("I like helping people")
- Medium: Somewhat specific ("I prefer mentoring junior developers")
- High: Highly specific with context ("I find deep satisfaction in pair programming with junior devs because it reminds me of how my first manager invested in me")

**Consistency** (Is it reinforced across multiple statements or just mentioned once?):
- Low: Mentioned once in passing
- Medium: Referenced in 2+ related statements
- High: A recurring theme throughout the conversation

Scoring guide:
- 50-60: Low conviction OR low specificity, mentioned once (implied/inferred)
- 61-75: Medium conviction with reasonable specificity, or consistent theme with lower specificity
- 76-85: Clear conviction with good specificity, referenced multiple times
- 86-95: Strong conviction, highly specific, consistent throughout conversation

Output format (JSON array only, no wrapping):
[
  { "content": "Insight statement here", "confidenceScore": 75 }
]`

  const result = await callClaudeForDistillation(systemPrompt, userPrompt)
  if (!result) return null

  const parsed = extractJson<unknown[]>(result)
  if (!Array.isArray(parsed)) {
    console.warn('[me.md:ai] Failed to parse AI insight extraction result.')
    return null
  }

  // Validate structure
  return parsed
    .filter((item: unknown) => {
      if (typeof item !== 'object' || item === null) return false
      const obj = item as Record<string, unknown>
      return typeof obj.content === 'string' && typeof obj.confidenceScore === 'number'
    })
    .map(item => {
      const obj = item as { content: string; confidenceScore: number }
      return {
        content: obj.content.substring(0, 500),
        confidenceScore: Math.min(Math.max(obj.confidenceScore, 50), 95),
      }
    })
    .slice(0, 10)
}

// ============================================
// AI-Powered Personalized Topic Suggestions
// ============================================

export interface TopicSuggestionContext {
  userName: string
  occupation: string
  existingTopics: Array<{ title: string; status: string; tags: string | null; intent: string | null; presetCategory: string | null }>
  verifiedInsights: Array<{ content: string; topicTitle: string; confidenceScore: number }>
  topicConnections: Array<{ sourceTopic: string; targetTopic: string; connectionType: string | null }>
}

export interface AISuggestedTopic {
  title: string
  description: string
  category: string
  intent: string
  tags: string[]
  suggestedQuestion: string
  rationale: string
}

/**
 * Generate personalized topic suggestions using Claude AI.
 * Analyzes the user's existing topics, verified insights, and knowledge gaps
 * to suggest relevant follow-up topics.
 * Returns null if AI is unavailable (caller should use preset fallback).
 */
export async function generatePersonalizedTopicSuggestions(ctx: TopicSuggestionContext): Promise<AISuggestedTopic[] | null> {
  if (!isAIAvailable()) {
    return null
  }

  const systemPrompt = `You are a personal knowledge analyst for me.md, a personal knowledge system that helps users build comprehensive self-understanding through AI-guided interviews.

Your job is to suggest personalized follow-up topics for exploration based on the user's existing knowledge graph — their explored topics, verified insights, and knowledge gaps.
Suggest fewer than the range if the profile is too sparse to justify more; do not pad.

Output ONLY a valid JSON array with no markdown code fences, no explanation, and no commentary. Just the raw JSON array.

${ctx.userName ? `The user's name is ${ctx.userName}${ctx.occupation ? `, occupation: ${ctx.occupation}` : ''}.` : ''}`

  // Build a summary of existing topics
  const topicSummary = ctx.existingTopics.map(t => {
    const tags = (() => {
      try {
        const parsed = JSON.parse(t.tags ?? '[]')
        return Array.isArray(parsed) ? parsed.join(', ') : 'none'
      } catch {
        return 'none'
      }
    })()
    return `- "${t.title}" (status: ${t.status}, intent: ${t.intent || 'none'}, tags: ${tags}, category: ${t.presetCategory || 'custom'})`
  }).join('\n')

  // Build insights summary
  const insightSummary = ctx.verifiedInsights.slice(0, 20).map(i =>
    `- [From "${i.topicTitle}", confidence: ${i.confidenceScore}]: "${i.content}"`
  ).join('\n')

  // Build connections summary
  const connectionSummary = ctx.topicConnections.slice(0, 15).map(c =>
    `- "${c.sourceTopic}" <-> "${c.targetTopic}" (${c.connectionType || 'related'})`
  ).join('\n')

  // Identify which preset categories the user has explored
  const exploredCategories = new Set(ctx.existingTopics
    .filter(t => t.presetCategory)
    .map(t => t.presetCategory))

  const allCategories = ['identity', 'skills', 'experiences', 'perspectives', 'goals']
  const unexploredCategories = allCategories.filter(c => !exploredCategories.has(c))

  const userPrompt = `Analyze this user's personal knowledge profile and suggest 3-5 personalized follow-up topics they should explore next.

## User's Existing Topics (${ctx.existingTopics.length} total)
${topicSummary || '(No topics yet)'}

## Verified Insights (${ctx.verifiedInsights.length} total)
${insightSummary || '(No verified insights yet)'}

## Topic Connections
${connectionSummary || '(No connections yet)'}

## Knowledge Gap Analysis
${unexploredCategories.length > 0
    ? `Unexplored categories: ${unexploredCategories.join(', ')}. Consider suggesting topics in these areas.`
    : 'All major categories have been explored. Suggest deeper dives or cross-cutting topics.'}

## Instructions

Generate 3-5 personalized topic suggestions. Each suggestion should:
1. Be relevant to the user's profile, occupation, and existing insights
2. Fill knowledge gaps or deepen existing understanding
3. Consider cross-topic connections (e.g., how career decisions relate to core values)
4. Avoid duplicating existing topics
5. Include a compelling opening question tailored to what the user has already shared

Use one of these categories: identity, skills, experiences, perspectives, goals
Use one of these intents: articulate, explore, decide, document

## Output Format (JSON array only)
[
  {
    "title": "Topic Title",
    "description": "Why this topic matters for the user's self-knowledge",
    "category": "one of: identity, skills, experiences, perspectives, goals",
    "intent": "one of: articulate, explore, decide, document",
    "tags": ["tag1", "tag2", "tag3"],
    "suggestedQuestion": "A personalized opening question referencing the user's existing insights",
    "rationale": "Brief explanation of why this topic was suggested (e.g., fills a gap, deepens a theme, connects two areas)"
  }
]`

  try {
    console.log(`[me.md:ai] Calling Claude API for personalized topic suggestions (${ctx.existingTopics.length} topics, ${ctx.verifiedInsights.length} insights)`)

    const responseText = await callAnthropic({
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
      maxTokens: 2048,
    })

    if (!responseText || responseText.trim().length === 0) {
      console.warn('[me.md:ai] Claude returned empty topic suggestions response.')
      return null
    }

    console.log(`[me.md:ai] Topic suggestions response received (${responseText.length} chars)`)

    const parsed = extractJson<unknown[]>(responseText)
    if (!Array.isArray(parsed)) return null

    // Validate and sanitize each suggestion
    const validIntents = ['articulate', 'explore', 'decide', 'document']
    const validCategories = ['identity', 'skills', 'experiences', 'perspectives', 'goals']

    return parsed
      .filter((item: unknown) => {
        if (typeof item !== 'object' || item === null) return false
        const obj = item as Record<string, unknown>
        return typeof obj.title === 'string' && typeof obj.description === 'string'
      })
      .map(item => {
        const obj = item as Partial<AISuggestedTopic>
        return {
          title: String(obj.title).substring(0, 200),
          description: String(obj.description).substring(0, 500),
          category: validCategories.includes(obj.category || '') ? obj.category || 'perspectives' : 'perspectives',
          intent: validIntents.includes(obj.intent || '') ? obj.intent || 'explore' : 'explore',
          tags: Array.isArray(obj.tags) ? obj.tags.slice(0, 6).map(t => String(t).toLowerCase().trim()) : [],
          suggestedQuestion: typeof obj.suggestedQuestion === 'string' ? obj.suggestedQuestion.substring(0, 500) : '',
          rationale: typeof obj.rationale === 'string' ? obj.rationale.substring(0, 300) : '',
        }
      })
      .slice(0, 5)
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string }
    console.error(`[me.md:ai] Topic suggestions error: ${err.message || 'Unknown error'}`)
    return null
  }
}
