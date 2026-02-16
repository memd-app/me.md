import { Router } from 'express';
import { db } from '../config/database.js';
import { sessions, messages, topics, conceptNodes, topicConnections, insights, users, notes, bookmarks } from '../models/schema.js';
import { eq, and, desc, ne, or } from 'drizzle-orm';
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
      return res.status(404).json({ error: 'This topic no longer exists. It may have been deleted. Please go back and select a different topic.' });
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

    // Gather profile context from previous sessions and verified insights
    const profileContext = gatherProfileContext(userId, topicId);

    // Create an opening AI message (context-aware with profile context and URLs)
    const openingMessageContent = generateOpeningMessage(topic.title, topic.description, topic.intent, referenceUrls, profileContext);
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
    res.status(500).json({ error: 'Failed to create session. Please try again later.' });
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
    res.status(500).json({ error: 'Failed to create mini session. Please try again later.' });
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
      // Gather profile context for personalized responses
      const msgProfileContext = gatherProfileContext(userId, session.topicId);

      // Standard session: use methodology-based questioning with profile context
      aiResponseContent = generateAIResponse(
        topic?.title || 'Unknown Topic',
        topic?.description || '',
        topic?.intent || '',
        historyForAI,
        hasResearchContext,
        msgProfileContext
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
    res.status(500).json({ error: 'Failed to send message. Please try again.' });
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

    // Gather profile context for personalized retry response
    const retryProfileContext = gatherProfileContext(userId, session.topicId);

    const aiResponseContent = generateAIResponse(
      topic?.title || 'Unknown Topic',
      topic?.description || '',
      topic?.intent || '',
      historyForAI,
      hasResearchContext,
      retryProfileContext
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
    res.status(500).json({ error: 'Failed to retry AI response. Please try again.' });
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
      // Gather profile context for personalized streaming responses
      const streamProfileContext = gatherProfileContext(userId, session.topicId);

      // Standard session: use methodology-based questioning with profile context
      aiResponseContent = generateAIResponse(
        topic?.title || 'Unknown Topic',
        topic?.description || '',
        topic?.intent || '',
        historyForAI,
        hasResearchContext,
        streamProfileContext
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
      res.status(500).json({ error: 'Failed to send message. Please try again.' });
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

// DELETE /api/sessions/:id - Delete a session and all related data (messages, bookmarks, notes, insights)
sessionsRouter.delete('/:id', async (req, res) => {
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

    const topicId = session.topicId;

    // Clear source_session_id references in insights from OTHER sessions
    // (insights from THIS session will be cascade-deleted via notes)
    db.update(insights).set({
      sourceSessionId: null,
    }).where(eq(insights.sourceSessionId, sessionId)).run();

    // Delete the session - CASCADE handles:
    // - messages (session_id ON DELETE CASCADE)
    // - bookmarks (session_id ON DELETE CASCADE, and message_id ON DELETE CASCADE)
    // - notes (session_id ON DELETE CASCADE)
    // - insights via notes (note_id ON DELETE CASCADE)
    // - insight_conflicts via insights (insight_a_id/b_id ON DELETE CASCADE)
    // - verification_history via insights (insight_id ON DELETE CASCADE)
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();

    // Count remaining sessions for this topic to update session count awareness
    const remainingSessions = db.select().from(sessions).where(
      eq(sessions.topicId, topicId)
    ).all();

    // If no sessions remain for this topic, optionally reset topic status to backlog
    if (remainingSessions.length === 0) {
      db.update(topics).set({
        status: 'backlog',
        updatedAt: new Date().toISOString(),
      }).where(
        and(eq(topics.id, topicId), eq(topics.userId, userId))
      ).run();
    }

    res.json({
      success: true,
      message: 'Session and all related data deleted',
      topicId,
      remainingSessionsForTopic: remainingSessions.length,
    });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ error: 'Failed to delete session' });
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

// GET /api/sessions/:id/multi-bucket - Get cross-topic relevance suggestions for a session
sessionsRouter.get('/:id/multi-bucket', async (req, res) => {
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

    // Get user messages from this session
    const sessionMessages = db.select().from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
      .orderBy(messages.createdAt)
      .all();

    if (sessionMessages.length === 0) {
      return res.json({ suggestedConnections: [], savedTargetIds: [] });
    }

    // Get all other topics for this user
    const otherTopics = db.select().from(topics).where(
      and(eq(topics.userId, userId), ne(topics.id, session.topicId))
    ).all();

    if (otherTopics.length === 0) {
      return res.json({ suggestedConnections: [], savedTargetIds: [] });
    }

    // Build content summary from user messages
    const contentSummary = sessionMessages.map(m => m.content).join(' ').toLowerCase();
    const contentWords = contentSummary.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);

    const stopWords = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'they', 'will', 'would', 'could', 'should', 'what', 'when', 'where', 'which', 'their', 'about', 'more', 'some', 'very', 'just', 'also', 'than', 'them', 'into', 'most', 'only', 'your', 'like', 'then', 'make', 'over', 'such', 'much', 'know', 'think', 'really', 'things', 'because', 'something']);
    const meaningfulWords = contentWords.filter(w => !stopWords.has(w));

    const wordFreq = new Map<string, number>();
    for (const w of meaningfulWords) {
      wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
    }
    const topKeywords = [...wordFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);

    const suggestedConnections: Array<{ targetTopicId: string; topicTitle: string; relevanceScore: number }> = [];

    for (const otherTopic of otherTopics) {
      const topicText = `${otherTopic.title} ${otherTopic.description || ''}`.toLowerCase();
      let topicTagsParsed: string[] = [];
      if (otherTopic.tags) {
        try {
          let parsed = JSON.parse(otherTopic.tags as string);
          if (typeof parsed === 'string') parsed = JSON.parse(parsed);
          topicTagsParsed = Array.isArray(parsed) ? parsed : [];
        } catch { topicTagsParsed = []; }
      }
      const topicTagsLower = topicTagsParsed.map((t: string) => t.toLowerCase());

      let score = 0;

      for (const keyword of topKeywords) {
        if (topicText.includes(keyword)) score += 5;
      }
      for (const tag of topicTagsLower) {
        if (contentSummary.includes(tag)) score += 10;
        for (const keyword of topKeywords) {
          if (tag.includes(keyword) || keyword.includes(tag)) score += 8;
        }
      }
      const titleWords = topicText.split(/\s+/).filter((w: string) => w.length > 3 && !stopWords.has(w));
      for (const tw of titleWords) {
        if (contentSummary.includes(tw)) score += 7;
      }

      score = Math.min(score, 100);
      if (score >= 15) {
        suggestedConnections.push({
          targetTopicId: otherTopic.id,
          topicTitle: otherTopic.title,
          relevanceScore: score,
        });
      }
    }

    suggestedConnections.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Check which connections are already saved
    const existingConnections = db.select().from(topicConnections).where(
      or(
        eq(topicConnections.sourceTopicId, session.topicId),
        eq(topicConnections.targetTopicId, session.topicId)
      )
    ).all();

    const savedTargetIds = existingConnections.map(c =>
      c.sourceTopicId === session.topicId ? c.targetTopicId : c.sourceTopicId
    );

    res.json({ suggestedConnections, savedTargetIds });
  } catch (error) {
    console.error('Get multi-bucket suggestions error:', error);
    res.status(500).json({ error: 'Failed to get cross-topic suggestions' });
  }
});

// POST /api/sessions/:id/multi-bucket - Save selected cross-topic connections
sessionsRouter.post('/:id/multi-bucket', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const sessionId = req.params.id;
    const { selectedConnections } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const session = db.select().from(sessions).where(
      and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
    ).get();

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!selectedConnections || !Array.isArray(selectedConnections) || selectedConnections.length === 0) {
      return res.status(400).json({ error: 'selectedConnections array is required' });
    }

    const created = [];
    for (const conn of selectedConnections) {
      const { targetTopicId, relevanceScore } = conn;

      // Verify target topic belongs to user
      const targetTopic = db.select().from(topics).where(
        and(eq(topics.id, targetTopicId), eq(topics.userId, userId))
      ).get();
      if (!targetTopic) continue;

      // Check for existing connection (avoid duplicates)
      const existing = db.select().from(topicConnections).where(
        or(
          and(eq(topicConnections.sourceTopicId, session.topicId), eq(topicConnections.targetTopicId, targetTopicId)),
          and(eq(topicConnections.sourceTopicId, targetTopicId), eq(topicConnections.targetTopicId, session.topicId))
        )
      ).get();
      if (existing) continue;

      const connectionId = uuidv4();
      const saved = db.insert(topicConnections).values({
        id: connectionId,
        sourceTopicId: session.topicId,
        targetTopicId,
        connectionType: 'multi_bucket',
        relevanceScore: Math.min(Math.max(relevanceScore || 0, 0), 100),
      }).returning().get();

      created.push({ ...saved, targetTopicTitle: targetTopic.title });
    }

    res.status(201).json({ connections: created, count: created.length });
  } catch (error) {
    console.error('Save multi-bucket connections error:', error);
    res.status(500).json({ error: 'Failed to save cross-topic connections' });
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

// ============================================
// Profile Context Injection
// ============================================

// Gather verified insights, previous sessions, and user profile for context-aware AI responses
interface ProfileContext {
  userName: string;
  occupation: string;
  verifiedInsights: Array<{ content: string; topicTitle: string; confidenceScore: number }>;
  previousSessionTopics: Array<{ title: string; sessionCount: number; status: string }>;
  relatedInsights: Array<{ content: string; topicTitle: string }>;
}

function gatherProfileContext(userId: string, currentTopicId: string): ProfileContext {
  // Get user profile
  const user = db.select().from(users).where(eq(users.id, userId)).get();

  // Get all verified insights for this user (across all topics)
  const allVerifiedInsights = db.select({
    content: insights.content,
    topicId: insights.topicId,
    confidenceScore: insights.confidenceScore,
  }).from(insights).where(
    and(
      eq(insights.userId, userId),
      eq(insights.verificationStatus, 'verified')
    )
  ).all();

  // Get topic titles for the insights
  const topicIds = [...new Set(allVerifiedInsights.map(i => i.topicId))];
  const topicMap = new Map<string, string>();
  if (topicIds.length > 0) {
    const topicRows = db.select({ id: topics.id, title: topics.title })
      .from(topics)
      .where(eq(topics.userId, userId))
      .all();
    for (const t of topicRows) {
      topicMap.set(t.id, t.title);
    }
  }

  // Map insights with topic titles
  const verifiedInsights = allVerifiedInsights.map(i => ({
    content: i.content,
    topicTitle: topicMap.get(i.topicId) || 'Unknown Topic',
    confidenceScore: i.confidenceScore || 50,
  }));

  // Get previous sessions (completed) grouped by topic
  const completedSessions = db.select({
    topicId: sessions.topicId,
  }).from(sessions).where(
    and(
      eq(sessions.userId, userId),
      eq(sessions.status, 'completed')
    )
  ).all();

  // Count sessions per topic
  const sessionCountByTopic = new Map<string, number>();
  for (const s of completedSessions) {
    sessionCountByTopic.set(s.topicId, (sessionCountByTopic.get(s.topicId) || 0) + 1);
  }

  // Get topic info for previous sessions
  const previousSessionTopics: Array<{ title: string; sessionCount: number; status: string }> = [];
  const allUserTopics = db.select({ id: topics.id, title: topics.title, status: topics.status })
    .from(topics)
    .where(eq(topics.userId, userId))
    .all();

  for (const t of allUserTopics) {
    const count = sessionCountByTopic.get(t.id) || 0;
    if (count > 0 && t.id !== currentTopicId) {
      previousSessionTopics.push({
        title: t.title,
        sessionCount: count,
        status: t.status || 'backlog',
      });
    }
  }

  // Get insights specifically related to the current topic (from connected topics)
  const currentTopicConnections = db.select().from(topicConnections).where(
    or(
      eq(topicConnections.sourceTopicId, currentTopicId),
      eq(topicConnections.targetTopicId, currentTopicId)
    )
  ).all();

  const connectedTopicIds = new Set<string>();
  for (const c of currentTopicConnections) {
    if (c.sourceTopicId !== currentTopicId) connectedTopicIds.add(c.sourceTopicId);
    if (c.targetTopicId !== currentTopicId) connectedTopicIds.add(c.targetTopicId);
  }

  // Also include insights from the current topic itself (from previous sessions)
  connectedTopicIds.add(currentTopicId);

  const relatedInsights = verifiedInsights
    .filter(i => {
      const topicId = allVerifiedInsights.find(vi => vi.content === i.content)?.topicId;
      return topicId && connectedTopicIds.has(topicId);
    })
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .slice(0, 10);

  return {
    userName: user?.name || '',
    occupation: user?.occupation || '',
    verifiedInsights: verifiedInsights.sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 15),
    previousSessionTopics: previousSessionTopics.slice(0, 10),
    relatedInsights,
  };
}

// Build a profile context summary string for injection into AI responses
function buildProfileContextSummary(context: ProfileContext, topicTitle: string): string {
  const parts: string[] = [];

  // Add user profile basics
  if (context.userName) {
    parts.push(`The user's name is ${context.userName}${context.occupation ? ` and they work as ${context.occupation}` : ''}.`);
  }

  // Add previous session context
  if (context.previousSessionTopics.length > 0) {
    const topicList = context.previousSessionTopics
      .slice(0, 5)
      .map(t => `"${t.title}" (${t.sessionCount} session${t.sessionCount > 1 ? 's' : ''})`)
      .join(', ');
    parts.push(`They have previously explored: ${topicList}.`);
  }

  // Add related insights from connected or same topics (most relevant)
  if (context.relatedInsights.length > 0) {
    parts.push('Directly relevant verified insights from related topics:');
    for (const insight of context.relatedInsights.slice(0, 5)) {
      parts.push(`- [From "${insight.topicTitle}"]: "${insight.content}"`);
    }
  }

  // Add high-confidence insights from other topics
  const otherInsights = context.verifiedInsights.filter(
    i => !context.relatedInsights.some(r => r.content === i.content)
  ).slice(0, 5);

  if (otherInsights.length > 0) {
    parts.push('Other verified self-knowledge:');
    for (const insight of otherInsights) {
      parts.push(`- [From "${insight.topicTitle}"]: "${insight.content}"`);
    }
  }

  return parts.join('\n');
}

// Helper function to generate an opening message based on topic
function generateOpeningMessage(title: string, description: string | null, intent: string | null, referenceUrls: string[] = [], profileContext?: ProfileContext): string {
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

  // Inject profile context: reference previous sessions and verified insights
  if (profileContext) {
    const hasVerifiedInsights = profileContext.verifiedInsights.length > 0;
    const hasPreviousTopics = profileContext.previousSessionTopics.length > 0;
    const hasRelatedInsights = profileContext.relatedInsights.length > 0;

    if (hasVerifiedInsights || hasPreviousTopics) {
      message += `\n\n**Building on what I know about you:**`;

      // Reference previous topics the user has explored
      if (hasPreviousTopics) {
        const topicNames = profileContext.previousSessionTopics.slice(0, 3).map(t => `"${t.title}"`).join(', ');
        message += ` I see you've already explored topics like ${topicNames}.`;
      }

      // Reference insights from multiple different topics to show cross-topic connections
      if (hasVerifiedInsights) {
        // Group insights by topic to show breadth of cross-topic knowledge
        const insightsByTopic = new Map<string, Array<{ content: string; topicTitle: string; confidenceScore: number }>>();
        for (const insight of profileContext.verifiedInsights) {
          if (!insightsByTopic.has(insight.topicTitle)) {
            insightsByTopic.set(insight.topicTitle, []);
          }
          insightsByTopic.get(insight.topicTitle)!.push(insight);
        }

        // Get up to 3 different topics' top insights for cross-referencing
        const topicEntries = Array.from(insightsByTopic.entries()).slice(0, 3);

        if (topicEntries.length >= 2) {
          // Multiple topics: show cross-topic threads explicitly
          message += ` I can see connections forming across your explorations:`;
          for (const [topicName, topicInsights] of topicEntries) {
            const bestInsight = topicInsights[0];
            const snippet = bestInsight.content.length > 100
              ? bestInsight.content.substring(0, 100) + '...'
              : bestInsight.content;
            message += `\n- From **"${topicName}"**: *"${snippet}"*`;
          }
          message += `\n\nI'll draw on these threads to help us find connections with **${title}**.`;
        } else if (topicEntries.length === 1) {
          const [topicName, topicInsights] = topicEntries[0];
          const snippet = topicInsights[0].content.length > 120
            ? topicInsights[0].content.substring(0, 120) + '...'
            : topicInsights[0].content;
          message += ` From your exploration of **"${topicName}"**, you've verified that *"${snippet}"*`;
          if (profileContext.verifiedInsights.length > 1) {
            message += ` — and you have ${profileContext.verifiedInsights.length - 1} other verified insight${profileContext.verifiedInsights.length > 2 ? 's' : ''} across your knowledge base`;
          }
          message += '.';
        }
      } else if (hasRelatedInsights) {
        const topInsight = profileContext.relatedInsights[0];
        message += ` From your work on **"${topInsight.topicTitle}"**, you've established that *"${topInsight.content.length > 120 ? topInsight.content.substring(0, 120) + '...' : topInsight.content}"*`;
        if (profileContext.relatedInsights.length > 1) {
          message += ` — along with ${profileContext.relatedInsights.length - 1} other verified insight${profileContext.relatedInsights.length > 2 ? 's' : ''} from related areas`;
        }
        message += '.';
      }

      message += ` I'll weave this existing knowledge into our conversation about **${title}**.`;
    }
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
  hasResearchContext: boolean = false,
  profileContext?: ProfileContext
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

  // Generate profile context bridge: connect current discussion to verified insights
  let profileBridge = '';
  if (profileContext && profileContext.verifiedInsights.length > 0) {
    profileBridge = generateProfileContextBridge(
      lastUserMessage,
      profileContext,
      topicTitle,
      messageCount
    );
  }

  if (messageCount === 0) {
    const base = `I appreciate you getting started! Let me reflect on what you've shared.\n\n${reflection}`;
    return profileBridge
      ? `${base}\n\n${profileBridge}\n\n${question}`
      : `${base}\n\n${question}`;
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
    return profileBridge
      ? `${reflection}\n\n${profileBridge}\n\n${transition}\n\n${question}`
      : `${reflection}\n\n${transition}\n\n${question}`;
  }

  // Inject profile context bridge to connect to previous knowledge from other topics
  // Show cross-topic references frequently (every message except every 4th) when insights exist
  const hasCrossTopicInsights = profileContext && profileContext.verifiedInsights.some(
    i => i.topicTitle.toLowerCase() !== topicTitle.toLowerCase()
  );
  if (profileBridge && (hasCrossTopicInsights || messageCount % 2 === 1 || messageCount <= 2)) {
    return `${reflection}\n\n${profileBridge}\n\n${question}`;
  }

  return `${reflection}\n\n${question}`;
}

// Generate a contextual bridge that connects the current conversation to previously verified insights
function generateProfileContextBridge(
  lastUserMessage: string,
  profileContext: ProfileContext,
  topicTitle: string,
  messageCount: number
): string {
  // Find the most relevant insight to the user's current message
  const lastMessageLower = lastUserMessage.toLowerCase();
  const lastMessageWords = lastMessageLower.split(/\s+/).filter(w => w.length > 3);

  // Prefer insights from DIFFERENT topics (cross-topic referencing)
  const crossTopicInsights = profileContext.verifiedInsights.filter(
    i => i.topicTitle.toLowerCase() !== topicTitle.toLowerCase()
  );
  const insightsPool = crossTopicInsights.length > 0 ? crossTopicInsights : profileContext.verifiedInsights;

  // Score insights by relevance to the current message
  const scoredInsights = insightsPool.map(insight => {
    const insightLower = insight.content.toLowerCase();
    let score = 0;
    for (const word of lastMessageWords) {
      if (insightLower.includes(word)) score += 3;
    }
    // Boost related insights (from same/connected topics)
    const isRelated = profileContext.relatedInsights.some(r => r.content === insight.content);
    if (isRelated) score += 5;
    // Boost cross-topic insights (different topic = more interesting connection)
    if (insight.topicTitle.toLowerCase() !== topicTitle.toLowerCase()) score += 2;
    // Boost high-confidence insights
    if (insight.confidenceScore >= 75) score += 2;
    return { ...insight, relevanceScore: score };
  }).sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Get the best insight - either word-matched or the highest scored cross-topic insight
  let bestInsight = scoredInsights.find(i => i.relevanceScore > 0);

  if (!bestInsight) {
    // No word-matched insights - fall back to cross-topic insights proactively
    // Cycle through different cross-topic insights based on messageCount
    if (crossTopicInsights.length > 0) {
      // Pick a different cross-topic insight each time based on message count
      const insightIndex = messageCount % crossTopicInsights.length;
      bestInsight = { ...crossTopicInsights[insightIndex], relevanceScore: 1 };
    } else if (profileContext.previousSessionTopics.length > 0) {
      // No verified insights from other topics - reference previous topics generally
      const topicIndex = messageCount % profileContext.previousSessionTopics.length;
      const relatedTopic = profileContext.previousSessionTopics[topicIndex];
      const generalBridges = [
        `I notice this connects to ground you've covered before — you previously explored **"${relatedTopic.title}"**, and I can see how those threads might weave together with what you're sharing about **${topicTitle}** now.`,
        `What you're describing reminds me of themes from your work on **"${relatedTopic.title}"**. There seem to be connections between these areas of your experience.`,
        `This resonates with what you explored in **"${relatedTopic.title}"** — I'm curious how your thinking on **${topicTitle}** builds on or contrasts with that earlier exploration.`,
      ];
      return generalBridges[messageCount % generalBridges.length];
    } else {
      return '';
    }
  }

  const insightSnippet = bestInsight.content.length > 100
    ? bestInsight.content.substring(0, 100) + '...'
    : bestInsight.content;

  // Generate the bridge text (varies by message count for variety)
  // Each bridge explicitly references the source topic to show cross-topic connection
  const bridges = [
    `This connects to something you've already verified about yourself — from your exploration of **"${bestInsight.topicTitle}"**, you established: *"${insightSnippet}"* How does that relate to what you're sharing now about **${topicTitle}**?`,
    `Interestingly, your verified insight from **"${bestInsight.topicTitle}"** — *"${insightSnippet}"* — seems to resonate with what you're describing here. I'd love to understand how these threads connect for you.`,
    `I'm noticing a pattern here. In your work on **"${bestInsight.topicTitle}"**, you verified: *"${insightSnippet}"* There's a clear connection to what you're exploring in **${topicTitle}** right now.`,
    `This builds on something you've already articulated. From **"${bestInsight.topicTitle}"**: *"${insightSnippet}"* — and what you're sharing now adds another dimension to that understanding.`,
    `Your previous insight from **"${bestInsight.topicTitle}"** — *"${insightSnippet}"* — adds interesting context to what you're exploring here in **${topicTitle}**.`,
    `I see a thread connecting your exploration of **"${bestInsight.topicTitle}"** to what we're discussing now. You verified: *"${insightSnippet}"* — this seems deeply relevant to **${topicTitle}**.`,
    `Drawing on your verified self-knowledge from **"${bestInsight.topicTitle}"**: *"${insightSnippet}"* — there's a meaningful overlap with what you're sharing about **${topicTitle}** here.`,
  ];

  return bridges[messageCount % bridges.length];
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
