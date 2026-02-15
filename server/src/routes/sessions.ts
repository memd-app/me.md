import { Router } from 'express';
import { db } from '../config/database.js';
import { sessions, messages, topics, conceptNodes } from '../models/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export const sessionsRouter = Router();

// POST /api/sessions - Create a new session
sessionsRouter.post('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { topicId, isMiniSession } = req.body;

    if (!topicId) {
      return res.status(400).json({ error: 'topicId is required' });
    }

    // Verify the topic belongs to the user
    const topic = db.select().from(topics).where(
      and(eq(topics.id, topicId), eq(topics.userId, userId))
    ).get();

    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    const sessionId = uuidv4();

    // Parse reference URLs from the topic for pre-interview context
    const referenceUrls = parseJsonArray(topic.referenceUrls);
    const contextItems = parseJsonArray(topic.contextItems);

    // Build research_data from reference URLs and context items
    let researchData: Record<string, unknown> | null = null;
    if (referenceUrls.length > 0 || contextItems.length > 0) {
      researchData = {
        referenceUrls: referenceUrls,
        contextItems: contextItems,
        processedAt: new Date().toISOString(),
        urlCount: referenceUrls.length,
        contextItemCount: contextItems.length,
        summary: buildContextSummary(referenceUrls, contextItems),
      };
    }

    const newSession = db.insert(sessions).values({
      id: sessionId,
      topicId,
      userId,
      status: 'active',
      isMiniSession: isMiniSession || false,
      timeSpentSeconds: 0,
      researchData: researchData ? JSON.stringify(researchData) : null,
    }).returning().get();

    // Update topic status to in_progress if it's in backlog/scheduled
    if (topic.status === 'backlog' || topic.status === 'scheduled') {
      db.update(topics).set({
        status: 'in_progress',
        updatedAt: new Date().toISOString(),
      }).where(eq(topics.id, topicId)).run();
    }

    // Create an opening AI message (context-aware if URLs provided)
    const openingMessageContent = generateOpeningMessage(topic.title, topic.description, topic.intent, referenceUrls);
    const openingMessageId = uuidv4();

    const openingMessage = db.insert(messages).values({
      id: openingMessageId,
      sessionId,
      role: 'assistant',
      content: openingMessageContent,
      quickReplies: JSON.stringify([
        "I have something specific on my mind about this",
        "I'd like to explore this openly and see what emerges",
        "I'm not sure where to start, guide me"
      ]),
      suggestsCompletion: false,
      isBookmarked: false,
      isVoiceInput: false,
    }).returning().get();

    res.status(201).json({
      session: newSession,
      topic,
      messages: [openingMessage],
    });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Failed to create session', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// POST /api/sessions/mini - Create a mini (quick-win) session with auto-created topic
sessionsRouter.post('/mini', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Auto-create a topic for the mini session
    const topicId = uuidv4();
    const newTopic = db.insert(topics).values({
      id: topicId,
      userId,
      title: 'Quick Win: Getting to Know You',
      description: 'A quick 5-minute session to establish your initial personal profile.',
      intent: 'explore',
      status: 'in_progress',
      tags: JSON.stringify(['quick-win', 'starter-profile', 'onboarding']),
      priority: 'high',
    }).returning().get();

    // Create the session with isMiniSession: true
    const sessionId = uuidv4();
    const newSession = db.insert(sessions).values({
      id: sessionId,
      topicId,
      userId,
      status: 'active',
      isMiniSession: true,
      timeSpentSeconds: 0,
      researchData: null,
    }).returning().get();

    // Create the special opening AI message for mini sessions
    const openingContent = `Welcome to your **Quick Win session**! In the next few minutes, I'll ask you 5-7 high-impact questions to build your starter profile. Let's dive right in!\n\n**What do you do for work, and what's the most interesting aspect of it?**`;

    const openingMessageId = uuidv4();
    const openingMessage = db.insert(messages).values({
      id: openingMessageId,
      sessionId,
      role: 'assistant',
      content: openingContent,
      quickReplies: JSON.stringify([
        "I'll share my work story",
        "I'd rather talk about my passions first",
        "Ask me about what drives me"
      ]),
      suggestsCompletion: false,
      isBookmarked: false,
      isVoiceInput: false,
    }).returning().get();

    res.status(201).json({
      session: newSession,
      topic: newTopic,
      messages: [openingMessage],
    });
  } catch (error) {
    console.error('Create mini session error:', error);
    res.status(500).json({ error: 'Failed to create mini session', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// GET /api/sessions/:id - Get a specific session with messages
sessionsRouter.get('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;
    const sessionId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const session = db.select().from(sessions).where(
      and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
    ).get();

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get the topic
    const topic = db.select().from(topics).where(eq(topics.id, session.topicId)).get();

    // Get all messages for the session
    const sessionMessages = db.select().from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all();

    res.json({
      session,
      topic,
      messages: sessionMessages,
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// GET /api/sessions - List all sessions for a user (optionally filtered by topicId)
sessionsRouter.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;
    const topicId = req.query.topicId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    let query;
    if (topicId) {
      query = db.select().from(sessions).where(
        and(eq(sessions.userId, userId), eq(sessions.topicId, topicId))
      ).orderBy(desc(sessions.createdAt)).all();
    } else {
      query = db.select().from(sessions).where(
        eq(sessions.userId, userId)
      ).orderBy(desc(sessions.createdAt)).all();
    }

    res.json({ sessions: query });
  } catch (error) {
    console.error('List sessions error:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// POST /api/sessions/:id/messages - Send a message in a session
sessionsRouter.post('/:id/messages', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const sessionId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Verify session belongs to user
    const session = db.select().from(sessions).where(
      and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
    ).get();

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { content, role } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Save the user message
    const userMessageId = uuidv4();
    const userMessage = db.insert(messages).values({
      id: userMessageId,
      sessionId,
      role: role || 'user',
      content,
      isBookmarked: false,
      isVoiceInput: req.body.isVoiceInput || false,
    }).returning().get();

    // Generate AI response
    const topic = db.select().from(topics).where(eq(topics.id, session.topicId)).get();

    // Get conversation history for context
    const conversationHistory = db.select().from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all();

    // Check if session has research_data (from reference URLs)
    const hasResearchContext = !!session.researchData;

    const historyForAI = conversationHistory.map(m => ({ role: m.role, content: m.content }));
    const userMessageCount = conversationHistory.filter(m => m.role === 'user').length;

    let aiResponseContent: string;
    let quickRepliesArr: string[];
    let shouldSuggestCompletion: boolean;

    if (session.isMiniSession) {
      // Mini session: use focused quick-win questions
      const miniResponse = generateMiniSessionAIResponse(userMessageCount, content, historyForAI);
      aiResponseContent = miniResponse.content;
      quickRepliesArr = miniResponse.quickReplies;

      // Mini sessions suggest completion after 5 messages, wrap up after 7
      shouldSuggestCompletion = userMessageCount >= 5;

      if (userMessageCount >= 7) {
        aiResponseContent += '\n\n---\n\n*Great work! We\'ve gathered enough for your **starter profile**. Click **Finish & Distill** to generate your initial insights and knowledge graph.*';
      }
    } else {
      // Standard session: use methodology-based questioning
      aiResponseContent = generateAIResponse(
        topic?.title || 'Unknown Topic',
        topic?.description || '',
        topic?.intent || '',
        historyForAI,
        hasResearchContext
      );
      quickRepliesArr = generateQuickReplies(userMessageCount, aiResponseContent, historyForAI);

      // AI suggests completion after 10+ user message exchanges (thorough conversation)
      shouldSuggestCompletion = userMessageCount >= 10;
    }

    const aiMessageId = uuidv4();
    const finalContent = (!session.isMiniSession && shouldSuggestCompletion)
      ? aiResponseContent + '\n\n---\n\n*We\'ve explored many angles together. Feel free to **continue exploring** if there\'s more to uncover, or **finish and distill** to capture your insights.*'
      : aiResponseContent;

    const aiMessage = db.insert(messages).values({
      id: aiMessageId,
      sessionId,
      role: 'assistant',
      content: finalContent,
      quickReplies: JSON.stringify(quickRepliesArr),
      suggestsCompletion: shouldSuggestCompletion,
      isBookmarked: false,
      isVoiceInput: false,
    }).returning().get();

    // Update session timestamp
    db.update(sessions).set({
      updatedAt: new Date().toISOString(),
    }).where(eq(sessions.id, sessionId)).run();

    res.status(201).json({
      userMessage,
      aiMessage,
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// POST /api/sessions/:id/messages/retry - Retry AI response generation for the last user message
sessionsRouter.post('/:id/messages/retry', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const sessionId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Verify session belongs to user
    const session = db.select().from(sessions).where(
      and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
    ).get();

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get the conversation history
    const conversationHistory = db.select().from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all();

    // Check that the last message is from the user (indicating AI response failed)
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      return res.status(400).json({ error: 'No pending user message to retry. The last message is not from a user.' });
    }

    // Get the topic for AI context
    const topic = db.select().from(topics).where(eq(topics.id, session.topicId)).get();

    const hasResearchContext = !!session.researchData;
    const historyForAI = conversationHistory.map(m => ({ role: m.role, content: m.content }));
    const aiResponseContent = generateAIResponse(
      topic?.title || 'Unknown Topic',
      topic?.description || '',
      topic?.intent || '',
      historyForAI,
      hasResearchContext
    );

    // Generate context-aware quick replies
    const userMessageCount = conversationHistory.filter(m => m.role === 'user').length;
    const quickRepliesArr = generateQuickReplies(userMessageCount, aiResponseContent, historyForAI);

    // AI suggests completion after 10+ user message exchanges
    const shouldSuggestCompletion = userMessageCount >= 10;

    const aiMessageId = uuidv4();
    const aiMessage = db.insert(messages).values({
      id: aiMessageId,
      sessionId,
      role: 'assistant',
      content: shouldSuggestCompletion ? aiResponseContent + '\n\n---\n\n*We\'ve explored many angles together. Feel free to **continue exploring** if there\'s more to uncover, or **finish and distill** to capture your insights.*' : aiResponseContent,
      quickReplies: JSON.stringify(quickRepliesArr),
      suggestsCompletion: shouldSuggestCompletion,
      isBookmarked: false,
      isVoiceInput: false,
    }).returning().get();

    // Update session timestamp
    db.update(sessions).set({
      updatedAt: new Date().toISOString(),
    }).where(eq(sessions.id, sessionId)).run();

    res.status(201).json({
      aiMessage,
    });
  } catch (error) {
    console.error('Retry message error:', error);
    res.status(500).json({ error: 'Failed to retry AI response', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// POST /api/sessions/:id/messages/stream - Send a message and stream AI response via SSE
sessionsRouter.post('/:id/messages/stream', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const sessionId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Verify session belongs to user
    const session = db.select().from(sessions).where(
      and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
    ).get();

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Save the user message
    const userMessageId = uuidv4();
    const userMessage = db.insert(messages).values({
      id: userMessageId,
      sessionId,
      role: 'user',
      content,
      isBookmarked: false,
      isVoiceInput: req.body.isVoiceInput || false,
    }).returning().get();

    // Generate AI response
    const topic = db.select().from(topics).where(eq(topics.id, session.topicId)).get();

    // Get conversation history for context
    const conversationHistory = db.select().from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all();

    const hasResearchContext = !!session.researchData;
    const historyForAI = conversationHistory.map(m => ({ role: m.role, content: m.content }));
    const userMessageCount = conversationHistory.filter(m => m.role === 'user').length;

    let aiResponseContent: string;
    let quickRepliesArr: string[];
    let shouldSuggestCompletion: boolean;

    if (session.isMiniSession) {
      // Mini session: use focused quick-win questions
      const miniResponse = generateMiniSessionAIResponse(userMessageCount, content, historyForAI);
      aiResponseContent = miniResponse.content;
      quickRepliesArr = miniResponse.quickReplies;

      // Mini sessions suggest completion after 5 messages, wrap up after 7
      shouldSuggestCompletion = userMessageCount >= 5;

      if (userMessageCount >= 7) {
        aiResponseContent += '\n\n---\n\n*Great work! We\'ve gathered enough for your **starter profile**. Click **Finish & Distill** to generate your initial insights and knowledge graph.*';
      }
    } else {
      // Standard session: use methodology-based questioning
      aiResponseContent = generateAIResponse(
        topic?.title || 'Unknown Topic',
        topic?.description || '',
        topic?.intent || '',
        historyForAI,
        hasResearchContext
      );
      quickRepliesArr = generateQuickReplies(userMessageCount, aiResponseContent, historyForAI);

      // AI suggests completion after 10+ user message exchanges (thorough conversation)
      shouldSuggestCompletion = userMessageCount >= 10;
    }

    const finalContent = (!session.isMiniSession && shouldSuggestCompletion)
      ? aiResponseContent + '\n\n---\n\n*We\'ve explored many angles together. Feel free to **continue exploring** if there\'s more to uncover, or **finish and distill** to capture your insights.*'
      : aiResponseContent;

    // Save the complete AI message to database immediately
    const aiMessageId = uuidv4();
    const aiMessage = db.insert(messages).values({
      id: aiMessageId,
      sessionId,
      role: 'assistant',
      content: finalContent,
      quickReplies: JSON.stringify(quickRepliesArr),
      suggestsCompletion: shouldSuggestCompletion,
      isBookmarked: false,
      isVoiceInput: false,
    }).returning().get();

    // Update session timestamp
    db.update(sessions).set({
      updatedAt: new Date().toISOString(),
    }).where(eq(sessions.id, sessionId)).run();

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send the saved user message first
    res.write(`data: ${JSON.stringify({ type: 'user_message', message: userMessage })}\n\n`);

    // Stream the AI response in chunks for real-time feel
    // We use a simple synchronous write loop with sleep for timing
    const chunks = splitIntoStreamChunks(finalContent);

    // Helper: sleep using a sync approach that works in Express
    const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

    // Initial thinking delay
    await sleep(150);

    // Stream each chunk with a small delay between them
    for (let i = 0; i < chunks.length; i++) {
      if (res.writableEnded) break;
      const wrote = res.write(`data: ${JSON.stringify({ type: 'ai_chunk', chunk: chunks[i], chunkIndex: i })}\n\n`);
      if (!wrote) {
        // Back-pressure: wait for drain
        await new Promise<void>(resolve => { res.once('drain', resolve); });
      }
      // Small delay between chunks for streaming effect (25-60ms)
      if (i < chunks.length - 1) {
        await sleep(25 + Math.floor(Math.random() * 35));
      }
    }

    // Send the complete message with metadata at the end
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'ai_complete', message: aiMessage })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    }

  } catch (error) {
    console.error('Stream message error:', error);
    // If headers haven't been sent yet, send JSON error
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to send message', details: error instanceof Error ? error.message : 'Unknown error' });
    } else {
      // If already streaming, send error event
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to generate response' })}\n\n`);
      res.end();
    }
  }
});

// Split text into natural streaming chunks (words and punctuation groups)
function splitIntoStreamChunks(text: string): string[] {
  const chunks: string[] = [];
  // Split by words, keeping spaces and newlines as part of chunks
  const words = text.split(/(\s+)/);
  let currentChunk = '';

  words.forEach((word) => {
    currentChunk += word;
    // Emit chunk at word boundaries (every 1-3 words for natural feel)
    if (currentChunk.length >= 4 && word.match(/\s/)) {
      chunks.push(currentChunk);
      currentChunk = '';
    }
  });

  // Push remaining content
  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

// PUT /api/sessions/:id - Update session status
sessionsRouter.put('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const sessionId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const session = db.select().from(sessions).where(
      and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
    ).get();

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { status, timeSpentSeconds } = req.body;

    const updated = db.update(sessions).set({
      status: status !== undefined ? status : session.status,
      timeSpentSeconds: timeSpentSeconds !== undefined ? timeSpentSeconds : session.timeSpentSeconds,
      updatedAt: new Date().toISOString(),
      completedAt: status === 'completed' ? new Date().toISOString() : session.completedAt,
    }).where(eq(sessions.id, sessionId)).returning().get();

    res.json({ session: updated });
  } catch (error) {
    console.error('Update session error:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// POST /api/sessions/:id/pause - Pause an active session
sessionsRouter.post('/:id/pause', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const sessionId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const session = db.select().from(sessions).where(
      and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
    ).get();

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'active') {
      return res.status(400).json({ error: 'Only active sessions can be paused' });
    }

    const updated = db.update(sessions).set({
      status: 'paused',
      updatedAt: new Date().toISOString(),
    }).where(eq(sessions.id, sessionId)).returning().get();

    res.json({ session: updated });
  } catch (error) {
    console.error('Pause session error:', error);
    res.status(500).json({ error: 'Failed to pause session' });
  }
});

// POST /api/sessions/:id/resume - Resume a paused session with gap-aware greeting
sessionsRouter.post('/:id/resume', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const sessionId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const session = db.select().from(sessions).where(
      and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
    ).get();

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'paused') {
      return res.status(400).json({ error: 'Only paused sessions can be resumed' });
    }

    // Get the topic for context
    const topic = db.select().from(topics).where(eq(topics.id, session.topicId)).get();

    // Get conversation history to reference in the gap-aware greeting
    const conversationHistory = db.select().from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all();

    // Calculate time gap
    const pausedAt = new Date(session.updatedAt);
    const now = new Date();
    const gapMs = now.getTime() - pausedAt.getTime();
    const gapMinutes = Math.floor(gapMs / 60000);
    const gapHours = Math.floor(gapMinutes / 60);
    const gapDays = Math.floor(gapHours / 24);

    let timeGapDescription = '';
    if (gapDays > 0) {
      timeGapDescription = gapDays === 1 ? 'a day' : `${gapDays} days`;
    } else if (gapHours > 0) {
      timeGapDescription = gapHours === 1 ? 'an hour' : `${gapHours} hours`;
    } else if (gapMinutes > 5) {
      timeGapDescription = `${gapMinutes} minutes`;
    } else {
      timeGapDescription = 'a moment';
    }

    // Get last few user messages for context
    const lastUserMessages = conversationHistory
      .filter(m => m.role === 'user')
      .slice(-2)
      .map(m => m.content);

    // Generate gap-aware greeting
    const topicTitle = topic?.title || 'our discussion';
    const gapGreeting = generateGapAwareGreeting(topicTitle, timeGapDescription, lastUserMessages, conversationHistory.length);

    // Update session status back to active
    const updated = db.update(sessions).set({
      status: 'active',
      updatedAt: new Date().toISOString(),
    }).where(eq(sessions.id, sessionId)).returning().get();

    // Insert the gap-aware greeting message
    const greetingMessageId = uuidv4();
    const greetingMessage = db.insert(messages).values({
      id: greetingMessageId,
      sessionId,
      role: 'assistant',
      content: gapGreeting,
      quickReplies: JSON.stringify([
        "Let's continue where we left off",
        "I've had some new thoughts to share",
        "Can you remind me what we covered?"
      ]),
      suggestsCompletion: false,
      isBookmarked: false,
      isVoiceInput: false,
    }).returning().get();

    res.json({
      session: updated,
      topic,
      greetingMessage,
    });
  } catch (error) {
    console.error('Resume session error:', error);
    res.status(500).json({ error: 'Failed to resume session' });
  }
});

// Helper function to generate a gap-aware greeting when resuming a paused session
function generateGapAwareGreeting(
  topicTitle: string,
  timeGap: string,
  lastUserMessages: string[],
  totalMessageCount: number
): string {
  let greeting = `Welcome back! It's been ${timeGap} since we last spoke about **${topicTitle}**.`;

  if (lastUserMessages.length > 0) {
    const lastThought = lastUserMessages[lastUserMessages.length - 1];
    // Use a brief snippet of their last message to show context awareness
    const snippet = lastThought.length > 100 ? lastThought.substring(0, 100) + '...' : lastThought;
    greeting += `\n\nLast time, you were sharing your thoughts: "${snippet}"`;
  }

  if (totalMessageCount > 6) {
    greeting += `\n\nWe've had a great conversation so far with ${totalMessageCount} messages exchanged. **Would you like to pick up where we left off, or has anything new come to mind** during the break that you'd like to explore?`;
  } else {
    greeting += `\n\nWe were just getting started in our exploration. **Would you like to continue from where we left off, or would you prefer to take a different direction?**`;
  }

  return greeting;
}

// Helper function to parse JSON arrays safely
function parseJsonArray(jsonStr: string | null): string[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Helper function to build a context summary from reference URLs and context items
function buildContextSummary(referenceUrls: string[], contextItems: string[]): string {
  const parts: string[] = [];
  if (referenceUrls.length > 0) {
    parts.push(`${referenceUrls.length} reference URL(s) provided: ${referenceUrls.join(', ')}`);
  }
  if (contextItems.length > 0) {
    parts.push(`${contextItems.length} context item(s) provided`);
  }
  return parts.join('; ');
}

// Helper function to generate an opening message based on topic
function generateOpeningMessage(title: string, description: string | null, intent: string | null, referenceUrls: string[] = []): string {
  const intentPhrases: Record<string, string> = {
    articulate: "help you articulate your thoughts on",
    explore: "explore and discover new perspectives about",
    decide: "help you work through a decision related to",
    document: "capture and document your knowledge about",
  };

  const intentPhrase = intent && intentPhrases[intent]
    ? intentPhrases[intent]
    : "explore your thoughts and experiences around";

  let message = `Welcome to this interview session! I'm here to ${intentPhrase} **${title}**.`;

  if (description) {
    message += `\n\n${description}`;
  }

  // If reference URLs are provided, acknowledge them and tailor the approach
  if (referenceUrls.length > 0) {
    message += `\n\n**Pre-interview context:** I see you've provided ${referenceUrls.length} reference${referenceUrls.length > 1 ? 's' : ''} to help guide our conversation:`;
    referenceUrls.forEach((url, index) => {
      message += `\n- [Reference ${index + 1}](${url})`;
    });
    message += `\n\nI'll use these references to ask more targeted questions and better understand your perspective on **${title}**. Let's dive in with a focused approach.`;
    message += `\n\n**Based on the context you've shared, what's the most important aspect of "${title}" that you'd like to explore?** How does the referenced material connect to your personal experience or thinking?`;
  } else {
    message += `\n\nTo get us started, I'd love to hear: **What first comes to mind when you think about "${title}"?** Feel free to share anything — a thought, a memory, a feeling, or even a question you have about it.`;
  }

  return message;
}

// ============================================
// Interview Methodology Engine
// ============================================

// Supported questioning methodologies
type Methodology = 'clean_language' | 'socratic' | 'five_whys' | 'appreciative_inquiry' | 'micro_phenomenology';

const METHODOLOGY_LABELS: Record<Methodology, string> = {
  clean_language: 'Clean Language',
  socratic: 'Socratic Method',
  five_whys: '5 Whys',
  appreciative_inquiry: 'Appreciative Inquiry',
  micro_phenomenology: 'Micro-phenomenology',
};

// Select methodology based on conversation stage and intent
function selectMethodology(messageCount: number, intent: string): Methodology {
  // Map intents to preferred methodology sequences
  const sequences: Record<string, Methodology[]> = {
    articulate: ['clean_language', 'micro_phenomenology', 'socratic', 'appreciative_inquiry', 'five_whys'],
    explore: ['appreciative_inquiry', 'socratic', 'clean_language', 'micro_phenomenology', 'five_whys'],
    decide: ['socratic', 'five_whys', 'clean_language', 'appreciative_inquiry', 'micro_phenomenology'],
    document: ['micro_phenomenology', 'clean_language', 'appreciative_inquiry', 'socratic', 'five_whys'],
  };

  const seq = sequences[intent] || sequences['explore'];
  return seq[messageCount % seq.length];
}

// Extract key phrases/words from user's message for reflection
function extractKeyPhrases(message: string): string[] {
  // Remove common filler words and short words, keep meaningful phrases
  const words = message.replace(/[^\w\s'-]/g, '').split(/\s+/).filter(w => w.length > 4);
  const stopWords = new Set([
    'about', 'after', 'again', 'always', 'being', 'biggest', 'could', 'doing',
    'every', 'feels', 'first', 'going', 'great', 'having', 'honestly', 'image',
    'instead', 'maybe', 'might', 'myself', 'never', 'often', 'other', 'place',
    'quite', 'rather', 'really', 'right', 'seems', 'should', 'since', 'small',
    'sometimes', 'something', 'still', 'their', 'there', 'these', 'thing',
    'things', 'think', 'those', 'though', 'through', 'turned', 'under', 'until',
    'where', 'which', 'while', 'would', 'comes', 'makes', 'people', 'wonder',
    'that', 'this', 'with', 'from', 'have', 'been', 'were', 'they', 'them',
    'will', 'just', 'also', 'very', 'much', 'some', 'into', 'when', 'what',
    'like', 'know', 'make', 'made', 'does', 'done', 'more', 'than', 'then',
  ]);

  const meaningful = words.filter(w => !stopWords.has(w.toLowerCase()));

  // Return up to 5 key words, preferring longer ones (more likely to be meaningful)
  return meaningful.sort((a, b) => b.length - a.length).slice(0, 5);
}

// Extract a brief quote from the user's message for reflection
function extractQuote(message: string, maxLength: number = 80): string {
  // Find the most substantive sentence
  const sentences = message.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);
  if (sentences.length === 0) {
    return message.length > maxLength ? message.substring(0, maxLength) + '...' : message;
  }

  // Pick the longest meaningful sentence (usually the most substantive)
  const best = sentences.sort((a, b) => b.length - a.length)[0];
  return best.length > maxLength ? best.substring(0, maxLength) + '...' : best;
}

// Generate a methodology-based reflection (2-4 sentences) that references user's actual input
function generateReflection(
  methodology: Methodology,
  topicTitle: string,
  lastUserMessage: string,
  previousUserMessages: string[],
  messageCount: number
): string {
  const quote = extractQuote(lastUserMessage);
  const keyPhrases = extractKeyPhrases(lastUserMessage);
  const keyPhrase = keyPhrases.length > 0 ? keyPhrases[0] : '';

  // Build a cross-reference to prior messages if available
  let priorReference = '';
  if (previousUserMessages.length > 0 && messageCount > 1) {
    const earlierQuote = extractQuote(previousUserMessages[previousUserMessages.length - 1], 60);
    priorReference = ` Earlier you mentioned "${earlierQuote}" — and I can see how that connects to what you're sharing now.`;
  }

  const reflections: Record<Methodology, string[]> = {
    clean_language: [
      `When you say "${quote}", there's a clarity in how you frame that experience. ${keyPhrase ? `The way you use the word "${keyPhrase}" suggests it carries particular significance for you.` : 'That language reveals something important about your perspective.'}${priorReference} Your expression has a precision that's worth exploring further.`,
      `I notice how you describe this — "${quote}". ${keyPhrase ? `"${keyPhrase}" seems like a meaningful concept in how you understand **${topicTitle}**.` : `The way you frame **${topicTitle}** reveals layers of meaning.`}${priorReference} There's richness in the specific words you've chosen.`,
      `Your words paint a vivid picture: "${quote}". ${keyPhrase ? `I'm drawn to how "${keyPhrase}" functions in your thinking about this.` : 'The specific language you use reveals underlying patterns.'}${priorReference} These details matter because they capture something uniquely yours.`,
    ],
    socratic: [
      `That's a thoughtful position — "${quote}". ${keyPhrase ? `Your point about "${keyPhrase}" raises some interesting implications I'd like to examine.` : 'Let me examine the assumptions underlying that perspective.'}${priorReference} Understanding the foundations of this view will help us go deeper.`,
      `I appreciate you sharing that perspective. When you say "${quote}", it reveals a belief worth interrogating constructively. ${keyPhrase ? `The concept of "${keyPhrase}" in particular seems central to how you see **${topicTitle}**.` : `Your framing of **${topicTitle}** carries interesting assumptions.`}${priorReference}`,
      `"${quote}" — that's a strong articulation. ${keyPhrase ? `Let's consider what "${keyPhrase}" really means in this context and whether it holds up under scrutiny.` : 'I want to test this idea to help you refine it.'}${priorReference} The goal is to strengthen your understanding, not challenge it.`,
    ],
    five_whys: [
      `"${quote}" — there's something deeper underneath that. ${keyPhrase ? `When you mention "${keyPhrase}", I sense there's a root cause or core motivation driving this.` : 'I sense there are layers here we haven\'t uncovered yet.'}${priorReference} Let's keep digging to find the foundational belief.`,
      `Thank you for sharing that: "${quote}". ${keyPhrase ? `The idea of "${keyPhrase}" might be a surface expression of something more fundamental about how you approach **${topicTitle}**.` : `There seems to be a deeper pattern underlying your approach to **${topicTitle}**.`}${priorReference} Understanding the root will give you powerful self-knowledge.`,
      `I hear you — "${quote}". ${keyPhrase ? `"${keyPhrase}" is interesting, but I wonder what drives that for you at a deeper level.` : 'That feels like an important layer, and I think there are more beneath it.'}${priorReference} Each layer we peel back brings us closer to something core.`,
    ],
    appreciative_inquiry: [
      `What you've shared is genuinely illuminating: "${quote}". ${keyPhrase ? `Your awareness around "${keyPhrase}" represents real strength in how you navigate **${topicTitle}**.` : `Your clarity about **${topicTitle}** reflects genuine self-awareness.`}${priorReference} I'd love to build on that strength.`,
      `"${quote}" — there's something powerful in that. ${keyPhrase ? `The way you engage with "${keyPhrase}" shows a capacity for deep reflection that's valuable.` : 'Your ability to articulate this shows remarkable introspective skill.'}${priorReference} Let's explore what's working well here.`,
      `I'm struck by the depth in what you've shared: "${quote}". ${keyPhrase ? `"${keyPhrase}" seems to be connected to something that really matters to you about **${topicTitle}**.` : `Your engagement with **${topicTitle}** reveals genuine passion and thoughtfulness.`}${priorReference} This is exactly the kind of insight that builds a rich personal profile.`,
    ],
    micro_phenomenology: [
      `"${quote}" — I want to slow down on that moment. ${keyPhrase ? `When you think about "${keyPhrase}", there's likely a specific sensory or emotional experience attached.` : 'There\'s likely a vivid inner experience connected to what you\'ve described.'}${priorReference} The fine details of how you experience this matter.`,
      `Thank you for that: "${quote}". ${keyPhrase ? `I'm curious about the lived experience when "${keyPhrase}" comes up for you in relation to **${topicTitle}**.` : `I want to zoom into the actual felt experience of **${topicTitle}** for you.`}${priorReference} The micro-details reveal patterns that broader descriptions can miss.`,
      `When you describe "${quote}", I want to capture the texture of that experience. ${keyPhrase ? `"${keyPhrase}" likely triggers specific thoughts, feelings, or even physical sensations.` : 'The specific quality of this experience is what makes it uniquely yours.'}${priorReference} Let me help you articulate the fine grain.`,
    ],
  };

  const methodReflections = reflections[methodology];
  return methodReflections[messageCount % methodReflections.length];
}

// Generate a methodology-based focused question with bolded key concepts
function generateQuestion(
  methodology: Methodology,
  topicTitle: string,
  lastUserMessage: string,
  previousUserMessages: string[],
  messageCount: number,
  topicIntent: string
): string {
  const keyPhrases = extractKeyPhrases(lastUserMessage);
  const keyPhrase = keyPhrases.length > 0 ? keyPhrases[0] : topicTitle;
  const secondPhrase = keyPhrases.length > 1 ? keyPhrases[1] : '';

  // Build prior-answer-aware question elements
  const hasPrior = previousUserMessages.length > 0;
  const priorKeyPhrases = hasPrior ? extractKeyPhrases(previousUserMessages[previousUserMessages.length - 1]) : [];
  const priorPhrase = priorKeyPhrases.length > 0 ? priorKeyPhrases[0] : '';

  const questions: Record<Methodology, string[]> = {
    clean_language: [
      `And when you experience **${keyPhrase}**${secondPhrase ? ` and **${secondPhrase}**` : ''} in relation to **${topicTitle}**, what kind of **${keyPhrase}** is that?`,
      `You mentioned **${keyPhrase}** — and is there anything else about **${keyPhrase}** as it relates to **${topicTitle}**?`,
      `When **${keyPhrase}** happens in the context of **${topicTitle}**, **where do you feel that** — and what's it like?`,
      `What would you like to have happen with **${keyPhrase}** and your understanding of **${topicTitle}**?`,
      hasPrior && priorPhrase
        ? `You've touched on both **${priorPhrase}** and now **${keyPhrase}** — **what's the relationship between these two** in how you think about **${topicTitle}**?`
        : `And **${keyPhrase}** is like... what? **What metaphor or image** comes to mind when you think about this aspect of **${topicTitle}**?`,
    ],
    socratic: [
      `What **evidence from your experience** supports this view of **${keyPhrase}** in relation to **${topicTitle}**? And is there **any counter-evidence** you've encountered?`,
      `If someone held the **opposite view** about **${keyPhrase}** and **${topicTitle}**, what would be their **strongest argument**?`,
      `**What assumptions are you making** about **${keyPhrase}** that might be worth examining? Which of those assumptions feel most certain and which feel shaky?`,
      `How would you **define ${keyPhrase}** precisely? And does that **definition hold up** across different situations in your life?`,
      hasPrior && priorPhrase
        ? `Earlier you discussed **${priorPhrase}**, and now **${keyPhrase}** — are these **consistent with each other**, or is there a tension worth exploring?`
        : `**What would need to be true** for your perspective on **${keyPhrase}** to be completely wrong? And how likely do you think that is?`,
    ],
    five_whys: [
      `**Why does ${keyPhrase} matter** so much to you in the context of **${topicTitle}**? What's at stake if it were different?`,
      `You've identified **${keyPhrase}** as important — but **why is that the case** rather than something else? What makes it fundamental?`,
      `If we go one level deeper: **why do you think** you feel this way about **${keyPhrase}**? What **experience or belief** is driving it?`,
      `**What would change** in your life if **${keyPhrase}** were no longer part of how you see **${topicTitle}**? And why would that matter?`,
      hasPrior && priorPhrase
        ? `We've traced from **${priorPhrase}** to **${keyPhrase}** — **why does this chain** exist for you? What's the **deepest reason** connecting them?`
        : `**Why is ${keyPhrase} the way you chose** to express this? What's underneath that choice?`,
    ],
    appreciative_inquiry: [
      `When **${keyPhrase}** is at its **best** in relation to **${topicTitle}**, what does that look like? Can you describe a **peak moment**?`,
      `What **strengths of yours** make your approach to **${keyPhrase}** and **${topicTitle}** particularly effective? What are you **most proud of** here?`,
      `**Imagine the ideal future** where your understanding of **${keyPhrase}** is fully realized — **what would be different** about how you engage with **${topicTitle}**?`,
      `What **conditions or environments** help you be at your best with **${keyPhrase}**? When does your **natural brilliance** around **${topicTitle}** shine through?`,
      hasPrior && priorPhrase
        ? `You've shown real depth in discussing both **${priorPhrase}** and **${keyPhrase}** — **what's the greatest strength** you bring to understanding **${topicTitle}**?`
        : `If you could **amplify what's already working** about your relationship with **${keyPhrase}**, **what would you do more of**?`,
    ],
    micro_phenomenology: [
      `When **${keyPhrase}** comes up for you, **what's the very first thing** you notice — a thought, a feeling, a sensation? **Walk me through that moment** in slow motion.`,
      `If you close your eyes and think about **${keyPhrase}** in the context of **${topicTitle}**, **what images or sensations** arise? **Where in your body** do you notice them?`,
      `**At the exact moment** when you're engaged with **${keyPhrase}**, what is the **quality of your attention**? Is it focused, diffuse, excited, calm?`,
      `Can you **replay a specific moment** when **${keyPhrase}** was most vivid for you? **What were you seeing, hearing, feeling** in that precise instant?`,
      hasPrior && priorPhrase
        ? `Compare the **felt experience** of **${priorPhrase}** with **${keyPhrase}** — do they **feel different** in your body or mind? How would you describe that difference?`
        : `**What's the texture** of your experience with **${keyPhrase}**? If it had a **color, temperature, or rhythm**, what would it be?`,
    ],
  };

  const methodQuestions = questions[methodology];
  return methodQuestions[messageCount % methodQuestions.length];
}

// Main function: Generate AI response based on conversation context using methodology-based questioning
function generateAIResponse(
  topicTitle: string,
  topicDescription: string,
  topicIntent: string,
  conversationHistory: Array<{ role: string; content: string }>,
  hasResearchContext: boolean = false
): string {
  const userMessages = conversationHistory.filter(m => m.role === 'user');
  const messageCount = userMessages.length;
  const lastUserMessage = userMessages[userMessages.length - 1]?.content || '';
  const previousUserMessages = userMessages.slice(0, -1).map(m => m.content);

  // Select methodology for this exchange
  const methodology = selectMethodology(messageCount, topicIntent || 'explore');

  // Generate methodology-based reflection (2-4 sentences referencing user's actual words)
  const reflection = generateReflection(
    methodology,
    topicTitle,
    lastUserMessage,
    previousUserMessages,
    messageCount
  );

  // Generate focused question with bolded key concepts
  const question = generateQuestion(
    methodology,
    topicTitle,
    lastUserMessage,
    previousUserMessages,
    messageCount,
    topicIntent || 'explore'
  );

  // Add methodology label as subtle context
  const methodLabel = METHODOLOGY_LABELS[methodology];

  if (messageCount === 0) {
    return `I appreciate you getting started! Let me reflect on what you've shared.\n\n${reflection}\n\n${question}`;
  }

  // For later exchanges, include a subtle methodology indicator
  if (messageCount >= 3 && messageCount % 3 === 0) {
    // Every 3rd exchange, add a brief transition that shifts the angle
    const transitions = [
      `Let me shift our angle slightly here.`,
      `I'd like to explore this from a different direction now.`,
      `Let's approach this from a new perspective.`,
      `I want to zoom into something specific.`,
    ];
    const transition = transitions[(messageCount / 3) % transitions.length];
    return `${reflection}\n\n${transition}\n\n${question}`;
  }

  return `${reflection}\n\n${question}`;
}

// Extract a meaningful topic word from user messages for quick reply personalization
function extractTopicWord(conversationHistory: Array<{ role: string; content: string }>): string {
  const userMessages = conversationHistory.filter(m => m.role === 'user');
  if (userMessages.length === 0) return '';

  const lastMsg = userMessages[userMessages.length - 1].content;
  // Look for longer, more meaningful words (6+ chars) to avoid awkward short words
  const words = lastMsg.replace(/[^\w\s'-]/g, '').split(/\s+/).filter(w => w.length >= 6);
  const stopWords = new Set([
    'about', 'after', 'again', 'always', 'anything', 'before', 'being',
    'between', 'biggest', 'because', 'cannot', 'comes', 'could', 'different',
    'doing', 'during', 'either', 'enough', 'every', 'everything', 'feels',
    'first', 'getting', 'going', 'great', 'having', 'honestly', 'however',
    'image', 'instead', 'itself', 'makes', 'maybe', 'might', 'myself',
    'never', 'nothing', 'often', 'other', 'people', 'place', 'pretty',
    'quite', 'rather', 'really', 'right', 'seems', 'should', 'since',
    'small', 'something', 'someone', 'sometimes', 'still', 'their',
    'there', 'these', 'thing', 'things', 'think', 'those', 'though',
    'through', 'turned', 'under', 'understand', 'until', 'where',
    'which', 'while', 'within', 'without', 'wonder', 'would',
  ]);

  const meaningful = words.filter(w => !stopWords.has(w.toLowerCase()));
  return meaningful.length > 0 ? meaningful[0].toLowerCase() : '';
}

// Generate context-aware quick replies in first-person voice, under 15 words
function generateQuickReplies(
  messageCount: number,
  lastAiMessage?: string,
  conversationHistory?: Array<{ role: string; content: string }>
): string[] {
  // Extract a topic word from user's messages for personalization
  const topicWord = conversationHistory ? extractTopicWord(conversationHistory) : '';

  // All replies are first-person voice and under 15 words
  if (messageCount === 0) {
    return [
      "I have a specific experience that comes to mind",
      "I'd like to start with the big picture",
      "I'm still figuring out my thoughts on this"
    ];
  }

  if (messageCount === 1) {
    return [
      topicWord ? `I feel strongly about ${topicWord} in my life` : "I feel strongly about this in my life",
      "I see it differently than most people do",
      "I need to think about that more carefully"
    ];
  }

  // Deeper exchanges — more nuanced, reflective first-person replies
  const contextualSets = [
    [
      "Yes, that really resonates with how I see it",
      "I want to share a personal example of this",
      "I think there's a contradiction I should explore"
    ],
    [
      "I've changed my mind on this over the years",
      topicWord ? `My experience with ${topicWord} is complex` : "My experience here is more complex than expected",
      "I want to go deeper into that question"
    ],
    [
      "I have a story that illustrates this perfectly",
      "I'm realizing something new about myself right now",
      "I'd like to explore a different angle instead"
    ],
    [
      topicWord ? `I'm not sure why ${topicWord} matters so much` : "I'm not sure why this matters so much to me",
      "I can see both sides of this tension clearly",
      "I want to challenge my own assumption here"
    ],
    [
      "I've never put this into words before now",
      "My perspective on this has shifted recently",
      "I think the answer is more nuanced than that"
    ],
  ];

  return contextualSets[(messageCount - 2) % contextualSets.length];
}

// ============================================
// Mini Session AI Response Generator
// ============================================

// High-impact question areas for quick-win mini sessions
const MINI_SESSION_QUESTIONS: Array<{ area: string; question: string; quickReplies: string[] }> = [
  {
    area: 'Career/Work Identity',
    question: '**What do you do for work, and what\'s the most interesting aspect of it?**',
    quickReplies: ["I'll share my work story", "I'd rather talk about my passions first", "Ask me about what drives me"],
  },
  {
    area: 'Core Values',
    question: '**What matters most to you in life right now, and why?**',
    quickReplies: ["Family and relationships come first", "Growth and learning drive me", "Making an impact is what counts"],
  },
  {
    area: 'Communication Style',
    question: '**How do you prefer to communicate with others -- are you more direct, collaborative, or reflective?**',
    quickReplies: ["I'm pretty direct and to the point", "I like to collaborate and brainstorm", "I tend to listen first, then respond"],
  },
  {
    area: 'Decision-Making',
    question: '**When you face a tough decision, what\'s your go-to approach?**',
    quickReplies: ["I go with my gut instinct", "I research and analyze thoroughly", "I talk it through with people I trust"],
  },
  {
    area: 'Strengths & Uniqueness',
    question: '**What do people most often come to you for -- what\'s your superpower?**',
    quickReplies: ["I'm great at solving problems", "People come to me for advice", "I bring energy and ideas to the table"],
  },
  {
    area: 'Goals & Aspirations',
    question: '**What\'s one goal or aspiration that excites you right now?**',
    quickReplies: ["I want to grow in my career", "I'm focused on personal development", "I have a creative project in mind"],
  },
  {
    area: 'Relationships & Community',
    question: '**Who are the most important people in your life, and what role do they play?**',
    quickReplies: ["My family is everything", "I have a tight circle of close friends", "My professional network shapes me a lot"],
  },
];

// Generate a concise mini-session AI response (2-3 sentences reflection + 1 bold question)
function generateMiniSessionAIResponse(
  userMessageCount: number,
  lastUserMessage: string,
  conversationHistory: Array<{ role: string; content: string }>
): { content: string; quickReplies: string[] } {
  // Pick the next question area based on how many user messages we've received
  const questionIndex = Math.min(userMessageCount, MINI_SESSION_QUESTIONS.length - 1);
  const nextQ = MINI_SESSION_QUESTIONS[questionIndex];

  // Build a short reflection on what the user just said
  const keyPhrases = extractKeyPhrases(lastUserMessage);
  const keyPhrase = keyPhrases.length > 0 ? keyPhrases[0] : '';

  let reflection: string;
  if (userMessageCount === 0) {
    reflection = `Thanks for sharing that!`;
  } else if (keyPhrase) {
    const reflections = [
      `That's a great insight about **${keyPhrase}** -- it says a lot about what drives you.`,
      `I can see **${keyPhrase}** is meaningful to you. That's really helpful context.`,
      `Interesting -- **${keyPhrase}** clearly shapes how you see things. Noted!`,
      `Love that perspective on **${keyPhrase}**. It paints a clear picture.`,
      `**${keyPhrase}** stands out as significant for you. That's valuable.`,
    ];
    reflection = reflections[userMessageCount % reflections.length];
  } else {
    const genericReflections = [
      `Thanks for sharing that -- it gives me a clearer picture of who you are.`,
      `That's really insightful. I can see how that shapes your perspective.`,
      `Great answer! That tells me a lot about how you think.`,
      `I appreciate the honesty there. It's really helpful for your profile.`,
      `That's a strong perspective. Let me keep building on this.`,
    ];
    reflection = genericReflections[userMessageCount % genericReflections.length];
  }

  const content = `${reflection}\n\n${nextQ.question}`;
  return { content, quickReplies: nextQ.quickReplies };
}
