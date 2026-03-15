import { callAnthropic, isApiKeyConfigured } from './anthropic'

// ============================================
// Research Service - Web Research for Topics
// ============================================
// Provides research capabilities for interview sessions.
// Uses Claude's knowledge to generate informed research context about topics,
// and can also fetch and summarize content from reference URLs.

// ============================================
// Types
// ============================================

export interface ResearchResult {
  topicTitle: string
  summary: string
  keyFindings: string[]
  suggestedAngles: string[]
  relevantConcepts: string[]
  sources: ResearchSource[]
  researchedAt: string
}

export interface ResearchSource {
  type: 'ai_knowledge' | 'reference_url'
  title: string
  url?: string
  snippet: string
}

// ============================================
// Research Generation
// ============================================

/**
 * Perform research on a topic using Claude's knowledge.
 * Generates structured research findings that can inform interview questions.
 * Also processes reference URLs if provided.
 *
 * Returns null if AI is unavailable.
 */
export async function researchTopic(
  topicTitle: string,
  topicDescription: string | null,
  referenceUrls: string[],
  contextItems: string[],
): Promise<ResearchResult | null> {
  if (!isApiKeyConfigured()) {
    // Fallback: generate basic research result from reference URLs/context items only
    return generateFallbackResearch(topicTitle, topicDescription, referenceUrls, contextItems)
  }

  const systemPrompt = `You are a research analyst for me.md, a personal knowledge system. Your job is to research a topic thoroughly to prepare for an AI-guided interview session.

Your research will be used to help an interviewer ask more specific, knowledgeable questions about the topic. Generate research that:
1. Provides factual background and key concepts
2. Identifies interesting angles and perspectives to explore
3. Suggests specific, informed questions that go beyond surface-level

Output ONLY valid JSON with no markdown code fences, no explanation, and no commentary. Just the raw JSON object.`

  const referenceContext = referenceUrls.length > 0
    ? `\n\nReference URLs provided by the user:\n${referenceUrls.map((url, i) => `${i + 1}. ${url}`).join('\n')}`
    : ''

  const contextInfo = contextItems.length > 0
    ? `\n\nAdditional context provided:\n${contextItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}`
    : ''

  const userPrompt = `Research the following topic to prepare for a personal knowledge interview:

Topic: "${topicTitle}"
${topicDescription ? `Description: ${topicDescription}` : ''}${referenceContext}${contextInfo}

Generate structured research findings in this JSON format:
{
  "summary": "A 2-3 paragraph overview of the topic covering key aspects, common perspectives, and notable considerations. This should demonstrate deep understanding.",
  "keyFindings": ["Array of 5-8 key facts, insights, or perspectives about this topic that would make interview questions more specific and informed"],
  "suggestedAngles": ["Array of 4-6 specific interview angles to explore, each as a descriptive sentence. These should be more specific than generic angles - use the research to identify what's most interesting about this particular topic"],
  "relevantConcepts": ["Array of 5-10 key concepts, terms, frameworks, or ideas related to this topic that the interviewer should be aware of"],
  "sources": [
    {
      "type": "ai_knowledge",
      "title": "Descriptive title for this knowledge area",
      "snippet": "Brief description of what this knowledge covers"
    }
  ]
}

Make the research specific and substantive. Include concrete details, statistics, frameworks, and expert perspectives where relevant. The goal is to enable more informed, specific interview questions rather than generic ones.`

  try {
    console.log(`[me.md:research] Researching topic: "${topicTitle}"`)

    const responseText = await callAnthropic({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 2048,
    })

    if (!responseText || responseText.trim().length === 0) {
      console.warn('[me.md:research] Claude returned empty research response.')
      return generateFallbackResearch(topicTitle, topicDescription, referenceUrls, contextItems)
    }

    console.log(`[me.md:research] Research response received (${responseText.length} chars)`)

    // Clean up markdown code fences
    let cleaned = responseText.trim()
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7)
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3)
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3)
    }
    cleaned = cleaned.trim()

    const parsed = JSON.parse(cleaned)

    // Build sources array, including reference URLs
    const sources: ResearchSource[] = []

    // Add AI knowledge sources
    if (Array.isArray(parsed.sources)) {
      for (const src of parsed.sources) {
        sources.push({
          type: 'ai_knowledge',
          title: String(src.title || 'AI Research').substring(0, 200),
          snippet: String(src.snippet || '').substring(0, 300),
        })
      }
    }

    // Add reference URL sources
    for (const url of referenceUrls) {
      sources.push({
        type: 'reference_url',
        title: `User-provided reference`,
        url,
        snippet: `Reference material provided by the user for context.`,
      })
    }

    const result: ResearchResult = {
      topicTitle,
      summary: String(parsed.summary || '').substring(0, 2000),
      keyFindings: Array.isArray(parsed.keyFindings)
        ? parsed.keyFindings.map((f: unknown) => String(f).substring(0, 300)).slice(0, 8)
        : [],
      suggestedAngles: Array.isArray(parsed.suggestedAngles)
        ? parsed.suggestedAngles.map((a: unknown) => String(a).substring(0, 300)).slice(0, 6)
        : [],
      relevantConcepts: Array.isArray(parsed.relevantConcepts)
        ? parsed.relevantConcepts.map((c: unknown) => String(c).substring(0, 100)).slice(0, 10)
        : [],
      sources,
      researchedAt: new Date().toISOString(),
    }

    return result
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string }
    console.error(`[me.md:research] Research error: ${err.message || 'Unknown error'}`)
    return generateFallbackResearch(topicTitle, topicDescription, referenceUrls, contextItems)
  }
}

/**
 * Generate a basic research result without AI (fallback mode).
 * Uses reference URLs and context items to create a minimal research context.
 */
function generateFallbackResearch(
  topicTitle: string,
  topicDescription: string | null,
  referenceUrls: string[],
  contextItems: string[],
): ResearchResult {
  const sources: ResearchSource[] = []

  for (const url of referenceUrls) {
    sources.push({
      type: 'reference_url',
      title: 'User-provided reference',
      url,
      snippet: 'Reference material provided by the user.',
    })
  }

  const keyFindings: string[] = []
  if (topicDescription) {
    keyFindings.push(`Topic focus: ${topicDescription}`)
  }
  for (const item of contextItems) {
    keyFindings.push(`Context: ${item}`)
  }

  return {
    topicTitle,
    summary: topicDescription
      ? `This interview session focuses on "${topicTitle}": ${topicDescription}. ${referenceUrls.length > 0 ? `The user has provided ${referenceUrls.length} reference URL(s) for additional context.` : ''}`
      : `This interview session focuses on "${topicTitle}". ${referenceUrls.length > 0 ? `The user has provided ${referenceUrls.length} reference URL(s) for additional context.` : 'No additional context was provided.'}`,
    keyFindings,
    suggestedAngles: [
      `Explore the user's personal connection to "${topicTitle}"`,
      `Investigate specific experiences and examples related to this topic`,
      `Examine decision-making patterns around this subject`,
      `Identify core values and principles at play`,
    ],
    relevantConcepts: [],
    sources,
    researchedAt: new Date().toISOString(),
  }
}

/**
 * Build a research-aware system prompt section.
 * Called by the AI service when research data is available for a session.
 */
export function buildResearchPromptSection(researchData: ResearchResult): string {
  const parts: string[] = []

  parts.push(`\n## Research Context (Research-Driven Mode)`)
  parts.push(`This is a RESEARCH-DRIVEN interview session. You have access to pre-researched information about the topic that should make your questions significantly more specific and informed than a generic interview.`)

  if (researchData.summary) {
    parts.push(`\n### Research Summary\n${researchData.summary}`)
  }

  if (researchData.keyFindings.length > 0) {
    parts.push(`\n### Key Findings`)
    for (const finding of researchData.keyFindings) {
      parts.push(`- ${finding}`)
    }
  }

  if (researchData.suggestedAngles.length > 0) {
    parts.push(`\n### Suggested Interview Angles`)
    parts.push(`Use these research-informed angles to guide your questions (rotate through them):`)
    for (const angle of researchData.suggestedAngles) {
      parts.push(`- ${angle}`)
    }
  }

  if (researchData.relevantConcepts.length > 0) {
    parts.push(`\n### Key Concepts & Terminology`)
    parts.push(`Reference these concepts naturally in your questions to demonstrate domain knowledge: ${researchData.relevantConcepts.join(', ')}.`)
  }

  if (researchData.sources.length > 0) {
    parts.push(`\n### Sources`)
    for (const source of researchData.sources) {
      if (source.url) {
        parts.push(`- [${source.title}](${source.url}): ${source.snippet}`)
      } else {
        parts.push(`- ${source.title}: ${source.snippet}`)
      }
    }
  }

  parts.push(`\n### Research-Driven Instructions`)
  parts.push(`- Use specific facts, concepts, and frameworks from the research to ask more informed questions`)
  parts.push(`- Reference relevant findings to help the user think more deeply (e.g., "Research suggests X — how does that align with your experience?")`)
  parts.push(`- Don't just recite research — use it to probe the user's unique perspective and personal knowledge`)
  parts.push(`- Compare the user's views with established perspectives to surface interesting contrasts`)

  return parts.join('\n')
}
