import { Router } from 'express';
import { db } from '../config/database.js';
import { insights, users, topics } from '../models/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { isAIAvailable, checkUserAIRateLimit } from '../services/ai.js';
import Anthropic from '@anthropic-ai/sdk';

export const sandboxRouter = Router();

interface ProfileContext {
  userName: string;
  occupation: string;
  location: string;
  communicationStyle: string[];
  toneOfVoice: string[];
  personalTraits: string[];
  strengths: string[];
  decisionPatterns: string[];
}

// Keyword sets for categorizing insights (same as profile.ts)
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
};

function categorizeInsight(content: string): string[] {
  const lowerContent = content.toLowerCase();
  const categories: string[] = [];
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const matchCount = keywords.filter(kw => lowerContent.includes(kw)).length;
    if (matchCount >= 1) {
      categories.push(category);
    }
  }
  return categories;
}

function getProfileContext(userId: string): ProfileContext | null {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return null;

  const verifiedInsights = db.select({
    content: insights.content,
    topicTitle: topics.title,
  }).from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(
      and(
        eq(insights.userId, userId),
        eq(insights.verificationStatus, 'verified')
      )
    )
    .orderBy(desc(insights.confidenceScore))
    .all();

  const categorized: Record<string, string[]> = {
    communicationStyle: [],
    toneOfVoice: [],
    personalTraits: [],
    strengths: [],
    decisionPatterns: [],
  };

  for (const insight of verifiedInsights) {
    const cats = categorizeInsight(insight.content);
    for (const cat of cats) {
      if (categorized[cat] && categorized[cat].length < 5) {
        categorized[cat].push(insight.content);
      }
    }
  }

  return {
    userName: user.name,
    occupation: user.occupation || '',
    location: user.location || '',
    communicationStyle: categorized.communicationStyle,
    toneOfVoice: categorized.toneOfVoice,
    personalTraits: categorized.personalTraits,
    strengths: categorized.strengths,
    decisionPatterns: categorized.decisionPatterns,
  };
}

// ============================================
// Anthropic Client (lazy init, same pattern as ai.ts)
// ============================================
let sandboxAnthropicClient: Anthropic | null = null;

function getSandboxClient(): Anthropic | null {
  if (sandboxAnthropicClient) return sandboxAnthropicClient;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your-anthropic-api-key' || apiKey.trim() === '') {
    return null;
  }

  try {
    sandboxAnthropicClient = new Anthropic({ apiKey });
    return sandboxAnthropicClient;
  } catch {
    return null;
  }
}

// ============================================
// System prompts for sandbox comparison
// ============================================

/**
 * Build the system prompt for the GENERIC response (no personal context).
 * Claude should respond as a helpful but generic AI assistant with no knowledge of the user.
 */
function buildGenericSystemPrompt(): string {
  return `You are a helpful AI assistant. Respond to the user's prompt directly and helpfully.

## Important Rules
- You do NOT know anything about the user. Use placeholders like [Your Name], [Name], etc.
- Write in a neutral, professional tone
- Be helpful and complete, but your response should be clearly generic — it could apply to anyone
- Do NOT try to personalize or make assumptions about the user's style, preferences, or background
- Keep your response concise (under 300 words)
- If the prompt asks you to write something (email, introduction, etc.), produce the actual content — not instructions on how to write it`;
}

/**
 * Build the system prompt for the PERSONALIZED response (with user's verified context).
 * Claude should write AS IF it were the user, using their verified insights to match style and voice.
 */
function buildPersonalizedSystemPrompt(context: ProfileContext): string {
  const parts: string[] = [];

  parts.push(`You are an AI writing assistant for me.md, a personal knowledge system. You are writing on behalf of a specific user using their verified self-knowledge. Your goal is to produce content that genuinely sounds like the user — matching their communication style, tone, values, and perspective.`);

  // User identity
  if (context.userName) {
    parts.push(`\n## User Identity`);
    parts.push(`Name: ${context.userName}`);
    if (context.occupation) parts.push(`Occupation: ${context.occupation}`);
    if (context.location) parts.push(`Location: ${context.location}`);
  }

  // Communication style insights
  if (context.communicationStyle.length > 0) {
    parts.push(`\n## Communication Style (Verified Insights)`);
    for (const insight of context.communicationStyle) {
      parts.push(`- ${insight}`);
    }
  }

  // Tone of voice insights
  if (context.toneOfVoice.length > 0) {
    parts.push(`\n## Tone of Voice (Verified Insights)`);
    for (const insight of context.toneOfVoice) {
      parts.push(`- ${insight}`);
    }
  }

  // Personal traits and values
  if (context.personalTraits.length > 0) {
    parts.push(`\n## Personal Traits & Values (Verified Insights)`);
    for (const insight of context.personalTraits) {
      parts.push(`- ${insight}`);
    }
  }

  // Strengths
  if (context.strengths.length > 0) {
    parts.push(`\n## Strengths & Expertise (Verified Insights)`);
    for (const insight of context.strengths) {
      parts.push(`- ${insight}`);
    }
  }

  // Decision patterns
  if (context.decisionPatterns.length > 0) {
    parts.push(`\n## Decision-Making Patterns (Verified Insights)`);
    for (const insight of context.decisionPatterns) {
      parts.push(`- ${insight}`);
    }
  }

  parts.push(`\n## Important Rules`);
  parts.push(`- Write AS the user, not about the user. Use their name to sign off where appropriate.`);
  parts.push(`- Match their communication style and tone based on the verified insights above.`);
  parts.push(`- Incorporate their values, strengths, and decision-making patterns naturally.`);
  parts.push(`- The response should sound authentically like this specific person — not like a generic AI.`);
  parts.push(`- Keep your response concise (under 300 words).`);
  parts.push(`- If the prompt asks you to write something (email, introduction, etc.), produce the actual content.`);
  parts.push(`- DO NOT mention that you're an AI or that you're using verified insights. Just write naturally as the person.`);

  return parts.join('\n');
}

// ============================================
// Template-based fallbacks (used when API unavailable)
// ============================================

function generateGenericResponseFallback(prompt: string): string {
  const lowerPrompt = prompt.toLowerCase();

  if (lowerPrompt.includes('email') && lowerPrompt.includes('declin')) {
    return `Subject: Regarding the Upcoming Meeting

Dear [Name],

Thank you for the invitation to the meeting. Unfortunately, I will not be able to attend due to a scheduling conflict.

I apologize for any inconvenience this may cause. If there are any materials or notes from the meeting that I should review, please feel free to share them with me afterward.

Please let me know if there's anything else I can help with.

Best regards,
[Your Name]`;
  }

  if (lowerPrompt.includes('email') && (lowerPrompt.includes('thank') || lowerPrompt.includes('appreciation'))) {
    return `Subject: Thank You

Dear [Name],

I wanted to take a moment to express my gratitude for your help with [topic]. Your assistance was greatly appreciated.

Thank you for your time and effort.

Best regards,
[Your Name]`;
  }

  if (lowerPrompt.includes('introduce') || lowerPrompt.includes('introduction')) {
    return `Hello,

My name is [Your Name]. I work as a [Job Title] and I'm interested in [topic]. I have experience in various areas and am always looking to learn more.

I look forward to connecting with you.

Best regards,
[Your Name]`;
  }

  // Default generic response
  return `Here's my response to your prompt:

I've considered your request carefully. Here are some thoughts:

The key points to address are:
1. Understanding the core requirements
2. Identifying the best approach
3. Executing with attention to detail

This is a straightforward approach that should work for most situations. Let me know if you need anything more specific.

Best regards,
[Your Name]`;
}

function generatePersonalizedResponseFallback(prompt: string, context: ProfileContext): string {
  const name = context.userName || 'there';
  const occupation = context.occupation ? ` (${context.occupation})` : '';

  return `Here's my take on this:

${context.personalTraits.length > 0
    ? `Coming from my perspective - ${context.personalTraits[0].toLowerCase()} - here's how I see it:`
    : `Based on my experience, here's how I'd approach this:`}

I've thought about this from a few angles:
- The most important consideration here is understanding the full picture
- Building on that, applying what I know from experience
- And practically speaking, taking concrete action

${context.strengths.length > 0
    ? `Drawing on my experience in ${context.strengths[0].toLowerCase()}, I'd particularly emphasize attention to detail and thoughtful execution.`
    : ''}

Feel free to reach out if you'd like to discuss further.

${name}${occupation}`;
}

// ============================================
// Claude API call helpers for sandbox
// ============================================

async function callClaudeForGenericResponse(client: Anthropic, prompt: string): Promise<string> {
  const systemPrompt = buildGenericSystemPrompt();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlocks = response.content.filter(block => block.type === 'text');
  return textBlocks.map(block => block.text).join('\n\n');
}

async function callClaudeForPersonalizedResponse(client: Anthropic, prompt: string, context: ProfileContext): Promise<string> {
  const systemPrompt = buildPersonalizedSystemPrompt(context);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlocks = response.content.filter(block => block.type === 'text');
  return textBlocks.map(block => block.text).join('\n\n');
}

// ============================================
// Routes
// ============================================

// POST /api/sandbox/compare - Generate side-by-side comparison (non-streaming)
sandboxRouter.post('/compare', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { prompt } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const trimmedPrompt = prompt.trim();

    // Get user's profile context from verified insights
    const context = getProfileContext(userId);
    const hasContext = !!(context && (
      context.communicationStyle.length > 0 ||
      context.toneOfVoice.length > 0 ||
      context.personalTraits.length > 0 ||
      context.strengths.length > 0
    ));

    const client = getSandboxClient();
    const rateLimitCheck = checkUserAIRateLimit(userId);

    let genericOutput: string;
    let personalizedOutput: string;
    let usedAI = false;

    if (client && rateLimitCheck.allowed) {
      // Use real Claude API for both responses
      try {
        console.log('[me.md:sandbox] Calling Claude API for generic + personalized comparison');

        // Run both API calls in parallel for speed
        const [genericResult, personalizedResult] = await Promise.all([
          callClaudeForGenericResponse(client, trimmedPrompt),
          hasContext && context
            ? callClaudeForPersonalizedResponse(client, trimmedPrompt, context)
            : Promise.resolve(null),
        ]);

        genericOutput = genericResult;
        usedAI = true;

        if (personalizedResult) {
          personalizedOutput = personalizedResult;
        } else if (!hasContext) {
          personalizedOutput = `*Your me.md profile doesn't have enough verified insights yet to personalize this response.*\n\nTo see the difference context makes:\n1. Complete some interview sessions to generate insights\n2. Verify those insights in the Verification Queue\n3. Come back here to see how your verified context transforms generic outputs\n\nOnce you have verified insights about your communication style, tone, values, and strengths, this side will show a response that truly sounds like you.`;
        } else {
          personalizedOutput = genericOutput; // fallback
        }

        console.log('[me.md:sandbox] Claude API comparison generated successfully');
      } catch (error: unknown) {
        const err = error as { status?: number; message?: string };
        console.warn(`[me.md:sandbox] Claude API error, falling back to templates: ${err.message || 'Unknown error'}`);
        // Fall back to template-based responses
        genericOutput = generateGenericResponseFallback(trimmedPrompt);
        personalizedOutput = hasContext && context
          ? generatePersonalizedResponseFallback(trimmedPrompt, context)
          : `*Your me.md profile doesn't have enough verified insights yet.*`;
      }
    } else {
      // API key not configured or rate limited — use template fallback
      if (!rateLimitCheck.allowed) {
        console.warn('[me.md:sandbox] User rate limited, using template fallback');
      }
      genericOutput = generateGenericResponseFallback(trimmedPrompt);
      personalizedOutput = hasContext && context
        ? generatePersonalizedResponseFallback(trimmedPrompt, context)
        : `*Your me.md profile doesn't have enough verified insights yet to personalize this response.*\n\nTo see the difference context makes:\n1. Complete some interview sessions to generate insights\n2. Verify those insights in the Verification Queue\n3. Come back here to see how your verified context transforms generic outputs\n\nOnce you have verified insights about your communication style, tone, values, and strengths, this side will show a response that truly sounds like you.`;
    }

    res.json({
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
    });
  } catch (error) {
    console.error('Sandbox compare error:', error);
    res.status(500).json({ error: 'Failed to generate comparison' });
  }
});

// POST /api/sandbox/compare/stream - Generate side-by-side comparison with SSE streaming
sandboxRouter.post('/compare/stream', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  const { prompt } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const trimmedPrompt = prompt.trim();

  // Get user's profile context from verified insights
  const context = getProfileContext(userId);
  const hasContext = !!(context && (
    context.communicationStyle.length > 0 ||
    context.toneOfVoice.length > 0 ||
    context.personalTraits.length > 0 ||
    context.strengths.length > 0
  ));

  const client = getSandboxClient();
  const rateLimitCheck = checkUserAIRateLimit(userId);

  if (!client || !rateLimitCheck.allowed) {
    // Fall back to non-streaming template response
    const genericOutput = generateGenericResponseFallback(trimmedPrompt);
    const personalizedOutput = hasContext && context
      ? generatePersonalizedResponseFallback(trimmedPrompt, context)
      : `*Your me.md profile doesn't have enough verified insights yet to personalize this response.*`;

    // Still send as SSE events for consistent client handling
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send full responses as single chunks (template fallback)
    res.write(`data: ${JSON.stringify({ type: 'generic_chunk', content: genericOutput })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'generic_done' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'personalized_chunk', content: personalizedOutput })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'personalized_done' })}\n\n`);
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      hasContext,
      usedAI: false,
      contextSummary: context ? {
        communicationInsights: context.communicationStyle.length,
        toneInsights: context.toneOfVoice.length,
        personalTraits: context.personalTraits.length,
        strengths: context.strengths.length,
        decisionPatterns: context.decisionPatterns.length,
      } : null,
      generatedAt: new Date().toISOString(),
    })}\n\n`);
    res.end();
    return;
  }

  // Set up SSE response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial metadata
  res.write(`data: ${JSON.stringify({ type: 'start', hasContext })}\n\n`);

  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    console.log('[me.md:sandbox] Starting streamed Claude comparison');

    // Stream generic response
    const genericSystemPrompt = buildGenericSystemPrompt();
    const genericStream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: genericSystemPrompt,
      messages: [{ role: 'user', content: trimmedPrompt }],
    });

    for await (const event of genericStream) {
      if (aborted) break;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ type: 'generic_chunk', content: event.delta.text })}\n\n`);
      }
    }

    if (!aborted) {
      res.write(`data: ${JSON.stringify({ type: 'generic_done' })}\n\n`);
    }

    // Stream personalized response (or send context-needed message)
    if (!aborted && hasContext && context) {
      const personalizedSystemPrompt = buildPersonalizedSystemPrompt(context);
      const personalizedStream = client.messages.stream({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: personalizedSystemPrompt,
        messages: [{ role: 'user', content: trimmedPrompt }],
      });

      for await (const event of personalizedStream) {
        if (aborted) break;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          res.write(`data: ${JSON.stringify({ type: 'personalized_chunk', content: event.delta.text })}\n\n`);
        }
      }

      if (!aborted) {
        res.write(`data: ${JSON.stringify({ type: 'personalized_done' })}\n\n`);
      }
    } else if (!aborted) {
      // No context available
      const noContextMsg = `*Your me.md profile doesn't have enough verified insights yet to personalize this response.*\n\nTo see the difference context makes:\n1. Complete some interview sessions to generate insights\n2. Verify those insights in the Verification Queue\n3. Come back here to see how your verified context transforms generic outputs\n\nOnce you have verified insights about your communication style, tone, values, and strengths, this side will show a response that truly sounds like you.`;
      res.write(`data: ${JSON.stringify({ type: 'personalized_chunk', content: noContextMsg })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'personalized_done' })}\n\n`);
    }

    if (!aborted) {
      // Send completion event with metadata
      res.write(`data: ${JSON.stringify({
        type: 'complete',
        hasContext,
        usedAI: true,
        contextSummary: context ? {
          communicationInsights: context.communicationStyle.length,
          toneInsights: context.toneOfVoice.length,
          personalTraits: context.personalTraits.length,
          strengths: context.strengths.length,
          decisionPatterns: context.decisionPatterns.length,
        } : null,
        generatedAt: new Date().toISOString(),
      })}\n\n`);

      console.log('[me.md:sandbox] Streamed comparison complete');
    }
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    console.error(`[me.md:sandbox] Stream error: ${err.message || 'Unknown error'}`);

    if (!aborted) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'AI generation failed. Please try again.' })}\n\n`);
    }
  } finally {
    if (!aborted) {
      res.end();
    }
  }
});

// GET /api/sandbox/context-status - Check if user has enough context
sandboxRouter.get('/context-status', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const context = getProfileContext(userId);
    const totalInsights = context ? (
      context.communicationStyle.length +
      context.toneOfVoice.length +
      context.personalTraits.length +
      context.strengths.length +
      context.decisionPatterns.length
    ) : 0;

    res.json({
      hasContext: totalInsights > 0,
      totalCategorizedInsights: totalInsights,
      aiAvailable: isAIAvailable(),
      categories: context ? {
        communicationStyle: context.communicationStyle.length,
        toneOfVoice: context.toneOfVoice.length,
        personalTraits: context.personalTraits.length,
        strengths: context.strengths.length,
        decisionPatterns: context.decisionPatterns.length,
      } : null,
    });
  } catch (error) {
    console.error('Sandbox context status error:', error);
    res.status(500).json({ error: 'Failed to get context status' });
  }
});
