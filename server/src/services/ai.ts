import Anthropic from '@anthropic-ai/sdk';

// ============================================
// AI Service Layer - Claude API Integration
// ============================================
// Wraps the Anthropic SDK for interview session AI responses.
// Falls back to template-based responses when API key is not configured
// or when API calls fail.

let anthropicClient: Anthropic | null = null;

/**
 * Initialize the Anthropic client if API key is available.
 * Called lazily on first use.
 */
function getClient(): Anthropic | null {
  if (anthropicClient) return anthropicClient;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your-anthropic-api-key' || apiKey.trim() === '') {
    console.warn('[me.md:ai] ANTHROPIC_API_KEY not configured. AI responses will use template fallback.');
    return null;
  }

  try {
    anthropicClient = new Anthropic({ apiKey });
    console.log('[me.md:ai] Anthropic client initialized successfully.');
    return anthropicClient;
  } catch (error) {
    console.error('[me.md:ai] Failed to initialize Anthropic client:', error);
    return null;
  }
}

/**
 * Check if the Claude API is available (API key configured).
 */
export function isAIAvailable(): boolean {
  return getClient() !== null;
}

// ============================================
// Profile & Interview Context Types
// ============================================

export interface ProfileContext {
  userName: string;
  occupation: string;
  verifiedInsights: Array<{ content: string; topicTitle: string; confidenceScore: number }>;
  previousSessionTopics: Array<{ title: string; sessionCount: number; status: string }>;
  relatedInsights: Array<{ content: string; topicTitle: string }>;
}

export interface InterviewMapAngle {
  id: string;
  label: string;
  description: string;
  questionFocus: string;
  explored: boolean;
}

export interface InterviewMap {
  type: 'default' | 'research-driven';
  angles: InterviewMapAngle[];
  currentAngleIndex: number;
  breadthFirstComplete: boolean;
}

type Methodology = 'clean_language' | 'socratic' | 'five_whys' | 'appreciative_inquiry' | 'micro_phenomenology';

// ============================================
// System Prompt Construction
// ============================================

const METHODOLOGY_DESCRIPTIONS: Record<Methodology, string> = {
  clean_language: `Clean Language: Use the user's exact words in your reflections and questions. Ask "And what kind of [X] is that [X]?", "And is there anything else about [X]?", "And where is [X]?", "And what would you like to have happen?". Avoid introducing your own metaphors or interpretations — mirror the user's language precisely.`,
  socratic: `Socratic Method: Help the user examine their assumptions and beliefs through thoughtful questioning. Ask about evidence, counter-examples, and implications. Challenge ideas constructively to deepen understanding. Ask "What evidence supports this?", "What would someone who disagrees say?", "What assumptions are you making?".`,
  five_whys: `Five Whys: Dig beneath surface-level answers to find root causes and core motivations. Keep asking "why" in creative ways to peel back layers. Ask "Why does that matter to you?", "What's driving that at a deeper level?", "What's underneath that feeling/belief?".`,
  appreciative_inquiry: `Appreciative Inquiry: Focus on strengths, peak experiences, and what's working well. Help the user envision their ideal future. Ask about best moments, natural talents, and conditions for flourishing. Ask "When is this at its best?", "What strengths do you bring?", "What would the ideal look like?".`,
  micro_phenomenology: `Micro-Phenomenology: Slow down and explore the fine-grained texture of lived experience. Ask about sensory details, precise sequences of thoughts and feelings, and the quality of attention. Ask "What's the very first thing you notice?", "What does that feel like in your body?", "Walk me through that moment in slow motion.".`,
};

function selectMethodology(messageCount: number, intent: string): Methodology {
  const sequences: Record<string, Methodology[]> = {
    articulate: ['clean_language', 'micro_phenomenology', 'socratic', 'appreciative_inquiry', 'five_whys'],
    explore: ['appreciative_inquiry', 'socratic', 'clean_language', 'micro_phenomenology', 'five_whys'],
    decide: ['socratic', 'five_whys', 'clean_language', 'appreciative_inquiry', 'micro_phenomenology'],
    document: ['micro_phenomenology', 'clean_language', 'appreciative_inquiry', 'socratic', 'five_whys'],
  };
  const seq = sequences[intent] || sequences['explore'];
  return seq[messageCount % seq.length];
}

/**
 * Build the system prompt for a standard interview session.
 */
function buildSystemPrompt(
  topicTitle: string,
  topicDescription: string,
  topicIntent: string,
  methodology: Methodology,
  hasResearchContext: boolean,
  profileContext: ProfileContext | undefined,
  interviewMap: InterviewMap | null,
  userMessageCount: number,
): string {
  const parts: string[] = [];

  // Core identity
  parts.push(`You are an expert interviewer for me.md, a personal knowledge system. Your role is to help users build deep, verified self-knowledge through structured interviews.`);
  parts.push(`You are interviewing the user about the topic: "${topicTitle}".`);

  if (topicDescription) {
    parts.push(`Topic description: ${topicDescription}`);
  }

  // Intent
  const intentDescriptions: Record<string, string> = {
    articulate: 'The user wants to articulate and put into words their thoughts on this topic.',
    explore: 'The user wants to explore and discover new perspectives about this topic.',
    decide: 'The user wants to work through a decision related to this topic.',
    document: 'The user wants to capture and document their knowledge about this topic.',
  };
  if (topicIntent && intentDescriptions[topicIntent]) {
    parts.push(`Interview intent: ${intentDescriptions[topicIntent]}`);
  }

  // Methodology guidance
  parts.push(`\n## Current Questioning Methodology\n${METHODOLOGY_DESCRIPTIONS[methodology]}`);

  // Interview map angle guidance
  if (interviewMap && interviewMap.type === 'default' && !hasResearchContext) {
    const angleIndex = userMessageCount % interviewMap.angles.length;
    const currentAngle = interviewMap.angles[angleIndex];
    parts.push(`\n## Interview Map - Current Angle: ${currentAngle.label}`);
    parts.push(`You are exploring the "${currentAngle.label}" angle: ${currentAngle.description}.`);
    parts.push(`Focus your questions on: ${currentAngle.questionFocus}.`);
    parts.push(`The full interview map has 5 angles (Journey, Principles, Frameworks, Examples, Tensions). You are cycling through them breadth-first to ensure comprehensive coverage.`);

    // Every 3rd exchange, note the angle transition
    if (userMessageCount >= 3 && userMessageCount % 3 === 0) {
      parts.push(`This is a good moment to transition angles. Explicitly acknowledge the shift to the "${currentAngle.label}" perspective.`);
    }
  }

  // Profile context
  if (profileContext) {
    parts.push(`\n## User Profile Context`);
    if (profileContext.userName) {
      parts.push(`User's name: ${profileContext.userName}${profileContext.occupation ? `, occupation: ${profileContext.occupation}` : ''}.`);
    }

    if (profileContext.previousSessionTopics.length > 0) {
      const topicList = profileContext.previousSessionTopics
        .slice(0, 5)
        .map(t => `"${t.title}" (${t.sessionCount} session${t.sessionCount > 1 ? 's' : ''})`)
        .join(', ');
      parts.push(`Previously explored topics: ${topicList}.`);
    }

    if (profileContext.relatedInsights.length > 0) {
      parts.push(`\nVerified insights from related topics (reference these to create cross-topic connections):`);
      for (const insight of profileContext.relatedInsights.slice(0, 5)) {
        parts.push(`- [From "${insight.topicTitle}"]: "${insight.content}"`);
      }
    }

    const otherInsights = profileContext.verifiedInsights.filter(
      i => !profileContext.relatedInsights.some(r => r.content === i.content)
    ).slice(0, 5);

    if (otherInsights.length > 0) {
      parts.push(`\nOther verified self-knowledge:`);
      for (const insight of otherInsights) {
        parts.push(`- [From "${insight.topicTitle}"]: "${insight.content}"`);
      }
    }
  }

  // Response format guidelines
  parts.push(`\n## Response Guidelines`);
  parts.push(`1. Start with a brief reflection (2-4 sentences) that references the user's actual words and shows you understood what they said.`);
  parts.push(`2. If there are relevant verified insights from other topics, create a brief cross-topic connection (1-2 sentences) showing how themes relate across their explorations.`);
  parts.push(`3. End with ONE focused question following the current methodology and interview angle.`);
  parts.push(`4. Use **bold** for key concepts and *italics* for quotes from the user or their verified insights.`);
  parts.push(`5. Keep responses concise — aim for 3-6 sentences total (reflection + optional cross-topic bridge + question).`);
  parts.push(`6. Be warm, curious, and genuinely interested. You are here to help them discover and articulate who they are.`);
  parts.push(`7. Never be generic. Always reference specific things the user has said or verified insights they've established.`);
  parts.push(`8. Do NOT use numbered lists in your response. Write naturally in flowing paragraphs.`);

  if (userMessageCount >= 10) {
    parts.push(`\nNote: The conversation has been going for ${userMessageCount} exchanges. The user may want to wrap up soon. You can occasionally mention that they've built good depth and can finish and distill insights when they feel ready.`);
  }

  return parts.join('\n');
}

/**
 * Build the system prompt for a mini (quick-win) session.
 */
function buildMiniSessionSystemPrompt(userMessageCount: number): string {
  const MINI_AREAS = [
    'Career/Work Identity',
    'Core Values',
    'Communication Style',
    'Decision-Making',
    'Strengths & Uniqueness',
    'Goals & Aspirations',
    'Relationships & Community',
  ];

  const currentArea = MINI_AREAS[Math.min(userMessageCount, MINI_AREAS.length - 1)];
  const nextArea = userMessageCount + 1 < MINI_AREAS.length
    ? MINI_AREAS[userMessageCount + 1]
    : null;

  const parts: string[] = [];
  parts.push(`You are conducting a Quick Win session for me.md — a short 5-minute interview to build a starter profile.`);
  parts.push(`You are asking high-impact questions across key life areas to quickly establish the user's personal context.`);
  parts.push(`\nCurrent focus area: ${currentArea} (question ${userMessageCount + 1} of ~7).`);
  if (nextArea) {
    parts.push(`Next area: ${nextArea}.`);
  }
  parts.push(`\n## Response Guidelines`);
  parts.push(`1. Start with a brief, energetic acknowledgment of what they shared (1-2 sentences). Reference their specific words.`);
  parts.push(`2. Ask ONE clear, bold question about the current focus area.`);
  parts.push(`3. Keep it quick and focused — this is a rapid-fire session.`);
  parts.push(`4. Use **bold** for the main question.`);
  parts.push(`5. Be warm and encouraging — help them feel good about sharing.`);

  if (userMessageCount >= 5) {
    parts.push(`\nNote: We're near the end of the quick win session. Start wrapping up warmly.`);
  }
  if (userMessageCount >= 7) {
    parts.push(`\nThe session is complete. Thank the user and encourage them to click "Finish & Distill" to generate their starter profile.`);
  }

  return parts.join('\n');
}

// ============================================
// Per-User Rate Limiting for AI API Costs
// ============================================

interface UserRateEntry {
  count: number;
  windowStart: number;
}

const userRateLimits = new Map<string, UserRateEntry>();
const AI_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const AI_RATE_LIMIT_MAX_REQUESTS = 60; // 60 AI calls per hour per user

/**
 * Check if a user has exceeded their AI rate limit.
 * Returns true if the request should be allowed, false if rate limited.
 */
export function checkUserAIRateLimit(userId: string): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const entry = userRateLimits.get(userId);

  if (!entry || now - entry.windowStart > AI_RATE_LIMIT_WINDOW_MS) {
    // New window
    userRateLimits.set(userId, { count: 1, windowStart: now });
    return { allowed: true, remaining: AI_RATE_LIMIT_MAX_REQUESTS - 1, resetInMs: AI_RATE_LIMIT_WINDOW_MS };
  }

  if (entry.count >= AI_RATE_LIMIT_MAX_REQUESTS) {
    const resetInMs = AI_RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, remaining: 0, resetInMs };
  }

  entry.count++;
  const resetInMs = AI_RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
  return { allowed: true, remaining: AI_RATE_LIMIT_MAX_REQUESTS - entry.count, resetInMs };
}

// Clean up old rate limit entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of userRateLimits.entries()) {
    if (now - entry.windowStart > AI_RATE_LIMIT_WINDOW_MS * 2) {
      userRateLimits.delete(userId);
    }
  }
}, 30 * 60 * 1000);

// ============================================
// Main AI Response Generation
// ============================================

export interface AIResponseOptions {
  topicTitle: string;
  topicDescription: string;
  topicIntent: string;
  conversationHistory: Array<{ role: string; content: string }>;
  hasResearchContext: boolean;
  profileContext?: ProfileContext;
  interviewMap?: InterviewMap | null;
  isMiniSession?: boolean;
}

/**
 * Generate an AI response using the Claude API.
 * Returns the generated text, or null if the API is unavailable / call fails.
 * The caller should fall back to template-based generation on null.
 */
export async function generateClaudeResponse(options: AIResponseOptions): Promise<string | null> {
  const client = getClient();
  if (!client) {
    return null;
  }

  const {
    topicTitle,
    topicDescription,
    topicIntent,
    conversationHistory,
    hasResearchContext,
    profileContext,
    interviewMap,
    isMiniSession,
  } = options;

  const userMessages = conversationHistory.filter(m => m.role === 'user');
  const userMessageCount = userMessages.length;

  // Build the system prompt
  let systemPrompt: string;
  if (isMiniSession) {
    systemPrompt = buildMiniSessionSystemPrompt(userMessageCount);
  } else {
    const methodology = selectMethodology(userMessageCount, topicIntent || 'explore');
    systemPrompt = buildSystemPrompt(
      topicTitle,
      topicDescription,
      topicIntent,
      methodology,
      hasResearchContext,
      profileContext,
      interviewMap || null,
      userMessageCount,
    );
  }

  // Build the messages array from conversation history
  // The Anthropic API expects alternating user/assistant messages
  const apiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of conversationHistory) {
    const role = msg.role === 'user' ? 'user' as const : 'assistant' as const;

    // Merge consecutive same-role messages (shouldn't happen but be safe)
    if (apiMessages.length > 0 && apiMessages[apiMessages.length - 1].role === role) {
      apiMessages[apiMessages.length - 1].content += '\n\n' + msg.content;
    } else {
      apiMessages.push({ role, content: msg.content });
    }
  }

  // Ensure the last message is from the user (required by the API)
  if (apiMessages.length === 0 || apiMessages[apiMessages.length - 1].role !== 'user') {
    // If there are no user messages yet, this is likely the opening — skip API call
    return null;
  }

  try {
    console.log(`[me.md:ai] Calling Claude API for ${isMiniSession ? 'mini' : 'standard'} session (${userMessageCount} user messages)`);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: apiMessages,
    });

    // Extract text from the response
    const textBlocks = response.content.filter(block => block.type === 'text');
    const responseText = textBlocks.map(block => block.text).join('\n\n');

    if (!responseText || responseText.trim().length === 0) {
      console.warn('[me.md:ai] Claude returned empty response, falling back to template.');
      return null;
    }

    console.log(`[me.md:ai] Claude response received (${responseText.length} chars, ${response.usage.input_tokens} input / ${response.usage.output_tokens} output tokens)`);
    return responseText;
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string; error?: { type?: string } };
    const status = err.status;
    const errType = err.error?.type;
    const message = err.message || 'Unknown error';

    if (status === 429) {
      console.warn(`[me.md:ai] Claude API rate limited. Falling back to template. ${message}`);
    } else if (status === 401 || status === 403) {
      console.error(`[me.md:ai] Claude API authentication error (${status}). Check ANTHROPIC_API_KEY. ${message}`);
    } else if (errType === 'overloaded_error') {
      console.warn(`[me.md:ai] Claude API overloaded. Falling back to template. ${message}`);
    } else {
      console.error(`[me.md:ai] Claude API error (status=${status}, type=${errType}): ${message}`);
    }

    return null;
  }
}

/**
 * Generate an AI response for streaming via SSE.
 * Uses Claude's streaming API for real-time responses.
 * Returns an async generator of text chunks, or null if unavailable.
 */
export async function* streamClaudeResponse(options: AIResponseOptions): AsyncGenerator<string, string | null, undefined> {
  const client = getClient();
  if (!client) {
    return null;
  }

  const {
    topicTitle,
    topicDescription,
    topicIntent,
    conversationHistory,
    hasResearchContext,
    profileContext,
    interviewMap,
    isMiniSession,
  } = options;

  const userMessages = conversationHistory.filter(m => m.role === 'user');
  const userMessageCount = userMessages.length;

  // Build the system prompt
  let systemPrompt: string;
  if (isMiniSession) {
    systemPrompt = buildMiniSessionSystemPrompt(userMessageCount);
  } else {
    const methodology = selectMethodology(userMessageCount, topicIntent || 'explore');
    systemPrompt = buildSystemPrompt(
      topicTitle,
      topicDescription,
      topicIntent,
      methodology,
      hasResearchContext,
      profileContext,
      interviewMap || null,
      userMessageCount,
    );
  }

  // Build the messages array
  const apiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const msg of conversationHistory) {
    const role = msg.role === 'user' ? 'user' as const : 'assistant' as const;
    if (apiMessages.length > 0 && apiMessages[apiMessages.length - 1].role === role) {
      apiMessages[apiMessages.length - 1].content += '\n\n' + msg.content;
    } else {
      apiMessages.push({ role, content: msg.content });
    }
  }

  if (apiMessages.length === 0 || apiMessages[apiMessages.length - 1].role !== 'user') {
    return null;
  }

  try {
    console.log(`[me.md:ai] Streaming Claude API for ${isMiniSession ? 'mini' : 'standard'} session (${userMessageCount} user messages)`);

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: apiMessages,
    });

    let fullText = '';

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const chunk = event.delta.text;
        fullText += chunk;
        yield chunk;
      }
    }

    const finalMessage = await stream.finalMessage();
    console.log(`[me.md:ai] Stream complete (${fullText.length} chars, ${finalMessage.usage.input_tokens} input / ${finalMessage.usage.output_tokens} output tokens)`);

    return fullText;
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    console.error(`[me.md:ai] Claude streaming error: ${err.message || 'Unknown error'}`);
    return null;
  }
}
