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

import { isAIAvailable } from './ai.js';
import Anthropic from '@anthropic-ai/sdk';

// ============================================
// Types
// ============================================

export type SourceType = 'interview' | 'import_url' | 'import_text' | 'import_chatgpt' | 'import_file';

export interface ExtractionContext {
  /** The content to extract insights from */
  content: string;
  /** The type of source content */
  sourceType: SourceType;
  /** Optional topic title for context */
  topicTitle?: string;
  /** Optional topic description for context */
  topicDescription?: string;
  /** User's name for personalization */
  userName?: string;
  /** User's occupation for personalization */
  occupation?: string;
  /** Whether this is a mini session (interview only) */
  isMiniSession?: boolean;
  /** Existing verified insights for deduplication */
  existingVerifiedInsights?: Array<{ content: string; confidenceScore: number }>;
}

export interface ExtractedInsight {
  /** The insight content text */
  content: string;
  /** Confidence score 0-100 */
  confidenceScore: number;
  /** Suggested category for the insight */
  category: string;
  /** How the insight was extracted */
  extractionMethod: 'ai' | 'fallback';
}

// ============================================
// Anthropic Client (lazy singleton)
// ============================================

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (anthropicClient) return anthropicClient;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your-anthropic-api-key' || apiKey.trim() === '') {
    return null;
  }

  try {
    anthropicClient = new Anthropic({ apiKey });
    return anthropicClient;
  } catch {
    return null;
  }
}

// ============================================
// Content Chunking for Large Imports
// ============================================

/** Maximum characters per chunk to stay within token limits (~4 chars/token, target ~3000 tokens of content) */
const MAX_CHUNK_SIZE = 12000;

/** Maximum insights per chunk */
const MAX_INSIGHTS_PER_CHUNK = 15;

/** Maximum total insights across all chunks */
const MAX_TOTAL_INSIGHTS = 30;

/**
 * Split large content into processable chunks, breaking at sentence boundaries.
 */
function chunkContent(content: string): string[] {
  if (content.length <= MAX_CHUNK_SIZE) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point near the limit (sentence or paragraph boundary)
    let breakPoint = MAX_CHUNK_SIZE;

    // Try paragraph break first
    const paragraphBreak = remaining.lastIndexOf('\n\n', MAX_CHUNK_SIZE);
    if (paragraphBreak > MAX_CHUNK_SIZE * 0.5) {
      breakPoint = paragraphBreak + 2;
    } else {
      // Try sentence break
      const sentenceBreak = remaining.lastIndexOf('. ', MAX_CHUNK_SIZE);
      if (sentenceBreak > MAX_CHUNK_SIZE * 0.5) {
        breakPoint = sentenceBreak + 2;
      }
    }

    chunks.push(remaining.substring(0, breakPoint).trim());
    remaining = remaining.substring(breakPoint).trim();
  }

  return chunks;
}

// ============================================
// AI-Powered Extraction
// ============================================

/**
 * Build the system prompt based on source type.
 */
function buildSystemPrompt(ctx: ExtractionContext): string {
  const basePrompt = `You are a personal knowledge analyst for me.md, a system that builds verified personal context from AI-guided interviews. Your job is to semantically identify genuine personal insights from content — not keyword-match, but deeply understand what the user is revealing about themselves.

Output ONLY a valid JSON array with no markdown code fences, no explanation, and no commentary.`;

  const userContext = ctx.userName
    ? `\nThe user's name is ${ctx.userName}${ctx.occupation ? `, occupation: ${ctx.occupation}` : ''}.`
    : '';

  return basePrompt + userContext;
}

/**
 * Build the user prompt adapted to the source type.
 */
function buildUserPrompt(ctx: ExtractionContext, contentChunk: string): string {
  const deduplicationSection = ctx.existingVerifiedInsights && ctx.existingVerifiedInsights.length > 0
    ? `\n## Existing Verified Insights (DO NOT duplicate these)
${ctx.existingVerifiedInsights.map(i => `- "${i.content}" (confidence: ${i.confidenceScore})`).join('\n')}
\nAvoid extracting insights that are semantically equivalent to any of the above.\n`
    : '';

  const topicContext = ctx.topicTitle
    ? ` about "${ctx.topicTitle}"${ctx.topicDescription ? ` (${ctx.topicDescription})` : ''}`
    : '';

  // Adapt extraction instructions based on source type
  let sourceInstructions: string;
  let insightRange: string;

  switch (ctx.sourceType) {
    case 'interview':
      insightRange = ctx.isMiniSession ? '2-5' : '3-10';
      sourceInstructions = `Extract self-knowledge insights from the following interview session${topicContext}.
${ctx.isMiniSession ? '\nNote: This was a quick mini-session with shorter, more direct answers. Adjust expectations accordingly — even brief self-descriptions can be meaningful insights.\n' : ''}
## Conversation Transcript

${contentChunk}`;
      break;

    case 'import_chatgpt':
      insightRange = '5-15';
      sourceInstructions = `Extract self-knowledge insights from the following ChatGPT memory export${topicContext}. This content represents structured personal data the user previously shared with ChatGPT. Treat it as high-quality personal knowledge since the user intentionally stored this.

## ChatGPT Memory Content

${contentChunk}`;
      break;

    case 'import_url':
      insightRange = '3-10';
      sourceInstructions = `Extract self-knowledge insights from the following web page content${topicContext}. This is content the user chose to import, so look for personal relevance — the user likely identifies with or values aspects of this content. Focus on extracting insights that reveal the user's interests, values, or self-identification.

## Web Page Content

${contentChunk}`;
      break;

    case 'import_text':
    case 'import_file':
      insightRange = '3-12';
      sourceInstructions = `Extract self-knowledge insights from the following ${ctx.sourceType === 'import_file' ? 'uploaded file' : 'text'} content${topicContext}. This is content the user chose to import into their personal knowledge system, so it likely contains personally meaningful information.

## Imported Content

${contentChunk}`;
      break;

    default:
      insightRange = '3-10';
      sourceInstructions = `Extract self-knowledge insights from the following content${topicContext}.

## Content

${contentChunk}`;
  }

  return `${sourceInstructions}
${deduplicationSection}
## Instructions

Extract ${insightRange} distinct, genuine self-knowledge insights — statements that capture something true and specific about the user. Each insight should be:
- A clear, declarative statement about the user (e.g., "Values autonomy over stability when making career decisions")
- Specific and grounded in what the content actually reveals (not generic truisms)
- Semantically meaningful — capturing genuine personal knowledge, not surface-level keywords
- Useful as portable context for other AI tools to understand and act like the user

Also categorize each insight into one of these categories:
- "identity" — core traits, personality, self-concept
- "skills" — abilities, expertise, professional competencies
- "experiences" — life events, memories, journeys
- "perspectives" — beliefs, opinions, approaches, communication/decision style
- "goals" — aspirations, plans, desired futures

Avoid extracting:
- Generic statements that could apply to anyone (e.g., "Wants to be happy")
- Simple restatements of questions or prompts
- Vague or purely emotional reactions without substance

## Confidence Scoring

Evaluate each insight's confidenceScore (50-95) based on THREE dimensions:

**Conviction** (How strongly/emphatically was this expressed?):
- Low (50-60): Hedged, tentative, or inferred
- Medium (61-75): Stated clearly but without emphasis
- High (76-95): Emphatic, repeated, or emotionally charged

**Specificity** (How precise and detailed is the insight?):
- Low: Broad generalization ("I like helping people")
- Medium: Somewhat specific ("I prefer mentoring junior developers")
- High: Highly specific with context

**Consistency** (Is it reinforced across multiple statements or just mentioned once?):
- Low: Mentioned once in passing
- Medium: Referenced in 2+ related statements
- High: A recurring theme throughout the content

Output format (JSON array only, no wrapping):
[
  { "content": "Insight statement here", "confidenceScore": 75, "category": "identity" }
]`;
}

/**
 * Call Claude API for insight extraction from a single chunk.
 */
async function callClaudeForInsights(
  systemPrompt: string,
  userPrompt: string
): Promise<Array<{ content: string; confidenceScore: number; category: string }> | null> {
  const client = getClient();
  if (!client) return null;

  try {
    console.log('[me.md:insight-extraction] Calling Claude API for unified insight extraction');
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlocks = response.content.filter(block => block.type === 'text');
    const responseText = textBlocks.map(block => ('text' in block ? block.text : '')).join('\n\n');

    if (!responseText || responseText.trim().length === 0) {
      console.warn('[me.md:insight-extraction] Claude returned empty response.');
      return null;
    }

    console.log(`[me.md:insight-extraction] Response received (${responseText.length} chars, ${response.usage.input_tokens} in / ${response.usage.output_tokens} out tokens)`);

    // Clean up markdown code fences
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;

    // Validate and normalize structure
    const validCategories = new Set(['identity', 'skills', 'experiences', 'perspectives', 'goals']);

    return parsed
      .filter((item: unknown) => {
        if (typeof item !== 'object' || item === null) return false;
        const obj = item as Record<string, unknown>;
        return typeof obj.content === 'string' && typeof obj.confidenceScore === 'number';
      })
      .map((item: { content: string; confidenceScore: number; category?: string }) => ({
        content: item.content.substring(0, 500),
        confidenceScore: Math.min(Math.max(item.confidenceScore, 50), 95),
        category: (typeof item.category === 'string' && validCategories.has(item.category))
          ? item.category
          : 'identity',
      }))
      .slice(0, MAX_INSIGHTS_PER_CHUNK);
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.warn(`[me.md:insight-extraction] Failed to parse AI extraction result: ${err.message || 'Unknown error'}`);
    return null;
  }
}

// ============================================
// Rule-Based Fallback Extraction
// ============================================

/**
 * Score a statement for insight-worthiness (rule-based fallback).
 */
function scoreStatement(statement: string, sourceType: SourceType): number {
  const lower = statement.toLowerCase();
  let score: number;

  // Base scores differ by source type
  switch (sourceType) {
    case 'interview':
      score = 50;
      break;
    case 'import_chatgpt':
      score = 45; // ChatGPT memories are already curated personal data
      break;
    case 'import_url':
      score = 40; // Web content may not be personal
      break;
    default:
      score = 40;
  }

  // Strong personal statements
  if (/\b(i am|i believe|i value|i always|i never|i think|i feel|my|i prefer|i tend to)\b/i.test(lower)) {
    score += 15;
  }

  // Reasoning/understanding markers
  if (/\b(because|reason|learned|realized|understand|important|matters)\b/i.test(lower)) {
    score += 10;
  }

  // Core trait indicators
  if (/\b(core|fundamental|deeply|who i am|trait|personality|character|principle|philosophy)\b/i.test(lower)) {
    score += 10;
  }

  // Preference indicators
  if (/\b(prefer|like|enjoy|love|dislike|hate|comfortable|style|approach)\b/i.test(lower)) {
    score += 8;
  }

  // Length bonus
  if (statement.length > 60) {
    score += 5;
  }

  // Belief/principle keywords (interview-specific boost)
  if (sourceType === 'interview' && /\b(believe|think|feel|value|important|always|never|principle)\b/i.test(lower)) {
    score += 5;
  }

  return Math.min(score, 95);
}

/**
 * Categorize a statement by keyword analysis.
 */
function categorizeStatement(statement: string): string {
  const lower = statement.toLowerCase();

  if (/\b(skill|expert|experience|professional|work|career|project|competent|proficien)\b/.test(lower)) return 'skills';
  if (/\b(goal|aspir|dream|plan|future|want to|aim|ambition)\b/.test(lower)) return 'goals';
  if (/\b(learn|grew|journey|story|memory|remember|once|when i was)\b/.test(lower)) return 'experiences';
  if (/\b(think|believe|approach|perspective|opinion|view|prefer|style|method)\b/.test(lower)) return 'perspectives';

  return 'identity';
}

/**
 * Get score threshold based on source type.
 */
function getScoreThreshold(sourceType: SourceType, isMiniSession?: boolean): number {
  switch (sourceType) {
    case 'interview':
      return isMiniSession ? 45 : 55;
    case 'import_chatgpt':
      return 45;
    case 'import_url':
      return 55;
    case 'import_text':
    case 'import_file':
      return 48;
    default:
      return 50;
  }
}

/**
 * Get max insights based on source type.
 */
function getMaxInsights(sourceType: SourceType): number {
  switch (sourceType) {
    case 'interview':
      return 10;
    case 'import_chatgpt':
      return 30;
    case 'import_url':
      return 20;
    case 'import_text':
    case 'import_file':
      return 25;
    default:
      return 15;
  }
}

/**
 * Extract insights using rule-based pattern matching (fallback when AI unavailable).
 */
function extractInsightsFallback(ctx: ExtractionContext): ExtractedInsight[] {
  const results: ExtractedInsight[] = [];
  const threshold = getScoreThreshold(ctx.sourceType, ctx.isMiniSession);
  const maxInsights = getMaxInsights(ctx.sourceType);
  const minLength = ctx.sourceType === 'interview' && ctx.isMiniSession ? 15 : 20;

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
    };

    // Try to parse sections from the content
    const sectionRegex = /^##?\s*(.+)$/gm;
    let match;
    const sectionPositions: Array<{ name: string; start: number }> = [];

    while ((match = sectionRegex.exec(ctx.content)) !== null) {
      sectionPositions.push({ name: match[1].trim(), start: match.index + match[0].length });
    }

    if (sectionPositions.length > 0) {
      for (let i = 0; i < sectionPositions.length; i++) {
        const sectionName = sectionPositions[i].name;
        const sectionStart = sectionPositions[i].start;
        const sectionEnd = i + 1 < sectionPositions.length ? sectionPositions[i + 1].start : ctx.content.length;
        const sectionContent = ctx.content.substring(sectionStart, sectionEnd);
        const category = sectionCategoryMap[sectionName.toLowerCase()] || 'identity';

        const statements = sectionContent
          .split(/[.!?\n]+/)
          .map(s => s.replace(/^[-*•]\s*/, '').trim())
          .filter(s => s.length > 20 && s.length < 500);

        for (const statement of statements) {
          const score = scoreStatement(statement, ctx.sourceType);
          if (score >= threshold) {
            results.push({
              content: statement,
              confidenceScore: score,
              category,
              extractionMethod: 'fallback',
            });
          }
        }
      }

      // If we found section-based results, return them
      if (results.length > 0) {
        return deduplicateInsights(results, ctx.existingVerifiedInsights).slice(0, maxInsights);
      }
    }
  }

  // Generic extraction: split content into statements
  const statements = ctx.content
    .split(/[.!?\n]+/)
    .map(s => s.replace(/^[-*•]\s*/, '').trim())
    .filter(s => s.length > minLength && s.length < 500);

  // For interview mini sessions, if no sentences found, try whole message chunks
  if (statements.length === 0 && ctx.sourceType === 'interview' && ctx.isMiniSession) {
    const paragraphs = ctx.content.split(/\n+/).filter(p => p.trim().length > minLength);
    for (const p of paragraphs) {
      statements.push(p.trim());
    }
  }

  for (const statement of statements) {
    const score = scoreStatement(statement, ctx.sourceType);
    if (score >= threshold) {
      results.push({
        content: statement.substring(0, 500),
        confidenceScore: Math.min(score, 95),
        category: categorizeStatement(statement),
        extractionMethod: 'fallback',
      });
    }
  }

  return deduplicateInsights(results, ctx.existingVerifiedInsights).slice(0, maxInsights);
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
  const seen = new Set<string>();
  const unique = insights.filter(insight => {
    const key = insight.content.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // If we have existing verified insights, filter out near-duplicates
  if (existingVerified && existingVerified.length > 0) {
    const existingLower = existingVerified.map(i => i.content.toLowerCase().trim());
    return unique.filter(insight => {
      const lowerContent = insight.content.toLowerCase().trim();
      // Check for high overlap with existing insights
      return !existingLower.some(existing => {
        // Exact match
        if (existing === lowerContent) return true;
        // One contains the other (substring match for significant overlap)
        if (existing.length > 30 && lowerContent.length > 30) {
          if (existing.includes(lowerContent) || lowerContent.includes(existing)) return true;
        }
        return false;
      });
    });
  }

  return unique;
}

// ============================================
// Main Extraction Pipeline
// ============================================

/**
 * Extract insights from content using the unified pipeline.
 *
 * This is the main entry point for all insight extraction. It:
 * 1. Chunks large content if needed
 * 2. Attempts AI-powered extraction with Claude
 * 3. Falls back to rule-based extraction if AI is unavailable
 * 4. Deduplicates results and applies consistent formatting
 *
 * @param ctx - Extraction context with content, source type, and optional metadata
 * @returns Array of standardized extracted insights
 */
export async function extractInsights(ctx: ExtractionContext): Promise<ExtractedInsight[]> {
  if (!ctx.content || ctx.content.trim().length === 0) {
    return [];
  }

  console.log(`[me.md:insight-extraction] Starting unified extraction: sourceType=${ctx.sourceType}, contentLength=${ctx.content.length}`);

  // For interviews, format the content as a conversation transcript if it isn't already
  const processedContent = ctx.content;

  // Chunk large content
  const chunks = chunkContent(processedContent);
  console.log(`[me.md:insight-extraction] Content split into ${chunks.length} chunk(s)`);

  // Try AI extraction first
  if (isAIAvailable()) {
    try {
      const systemPrompt = buildSystemPrompt(ctx);
      const allInsights: ExtractedInsight[] = [];

      for (const chunk of chunks) {
        const userPrompt = buildUserPrompt(ctx, chunk);
        const aiResult = await callClaudeForInsights(systemPrompt, userPrompt);

        if (aiResult) {
          for (const item of aiResult) {
            allInsights.push({
              ...item,
              extractionMethod: 'ai',
            });
          }
        } else {
          // AI failed for this chunk, use fallback
          console.log(`[me.md:insight-extraction] AI failed for chunk, falling back to rule-based`);
          const fallbackResults = extractInsightsFallback({
            ...ctx,
            content: chunk,
          });
          allInsights.push(...fallbackResults);
        }

        // Stop if we have enough insights
        if (allInsights.length >= MAX_TOTAL_INSIGHTS) break;
      }

      if (allInsights.length > 0) {
        const deduplicated = deduplicateInsights(allInsights, ctx.existingVerifiedInsights);
        console.log(`[me.md:insight-extraction] AI extraction complete: ${deduplicated.length} insights (from ${allInsights.length} raw)`);
        return deduplicated.slice(0, MAX_TOTAL_INSIGHTS);
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.warn(`[me.md:insight-extraction] AI extraction failed, using fallback: ${err.message || 'Unknown error'}`);
    }
  }

  // Fallback to rule-based extraction
  console.log(`[me.md:insight-extraction] Using rule-based fallback extraction`);
  const fallbackResults = extractInsightsFallback(ctx);
  console.log(`[me.md:insight-extraction] Fallback extraction complete: ${fallbackResults.length} insights`);
  return fallbackResults;
}

/**
 * Helper to format interview messages into a conversation transcript string.
 * Use this when preparing interview content for the unified extraction service.
 */
export function formatInterviewTranscript(
  userMessages: Array<{ role: string; content: string }>,
  assistantMessages: Array<{ role: string; content: string }>
): string {
  const lines: string[] = [];
  const maxMessages = Math.max(userMessages.length, assistantMessages.length);
  for (let i = 0; i < maxMessages; i++) {
    if (i < assistantMessages.length) {
      lines.push(`**Interviewer:** ${assistantMessages[i].content}`);
    }
    if (i < userMessages.length) {
      lines.push(`**User:** ${userMessages[i].content}`);
    }
  }
  return lines.join('\n\n');
}
