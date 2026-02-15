import { Router } from 'express';
import { db } from '../config/database.js';
import { sessions, messages, topics } from '../models/schema.js';
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

    const newSession = db.insert(sessions).values({
      id: sessionId,
      topicId,
      userId,
      status: 'active',
      isMiniSession: isMiniSession || false,
      timeSpentSeconds: 0,
    }).returning().get();

    // Update topic status to in_progress if it's in backlog/scheduled
    if (topic.status === 'backlog' || topic.status === 'scheduled') {
      db.update(topics).set({
        status: 'in_progress',
        updatedAt: new Date().toISOString(),
      }).where(eq(topics.id, topicId)).run();
    }

    // Create an opening AI message
    const openingMessageContent = generateOpeningMessage(topic.title, topic.description, topic.intent);
    const openingMessageId = uuidv4();

    const openingMessage = db.insert(messages).values({
      id: openingMessageId,
      sessionId,
      role: 'assistant',
      content: openingMessageContent,
      quickReplies: JSON.stringify([
        "I'd like to explore this topic deeply",
        "Let me share what I already know",
        "I'm not sure where to start"
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

    const aiResponseContent = generateAIResponse(
      topic?.title || 'Unknown Topic',
      topic?.description || '',
      topic?.intent || '',
      conversationHistory.map(m => ({ role: m.role, content: m.content }))
    );

    const aiMessageId = uuidv4();
    const aiMessage = db.insert(messages).values({
      id: aiMessageId,
      sessionId,
      role: 'assistant',
      content: aiResponseContent,
      quickReplies: JSON.stringify(generateQuickReplies(conversationHistory.length)),
      suggestsCompletion: conversationHistory.length >= 10,
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

// Helper function to generate an opening message based on topic
function generateOpeningMessage(title: string, description: string | null, intent: string | null): string {
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

  message += `\n\nTo get us started, I'd love to hear: **What first comes to mind when you think about "${title}"?** Feel free to share anything — a thought, a memory, a feeling, or even a question you have about it.`;

  return message;
}

// Helper function to generate AI responses based on conversation context
function generateAIResponse(
  topicTitle: string,
  topicDescription: string,
  topicIntent: string,
  conversationHistory: Array<{ role: string; content: string }>
): string {
  const userMessages = conversationHistory.filter(m => m.role === 'user');
  const messageCount = userMessages.length;
  const lastUserMessage = userMessages[userMessages.length - 1]?.content || '';

  // Reflection + focused question pattern
  const reflections = [
    `That's a really thoughtful perspective. I can see how your experience has shaped your understanding of **${topicTitle}**.`,
    `Thank you for sharing that. What you've described reveals something meaningful about how you approach this area of your life.`,
    `I appreciate you going deeper on that. There's a lot of richness in what you've shared about **${topicTitle}**.`,
    `That's fascinating — the way you describe it suggests you've given this considerable thought. Your perspective is quite nuanced.`,
    `I hear you. What you've shared connects to some important themes around **${topicTitle}** that I think are worth exploring further.`,
  ];

  const questions = [
    `Can you think of a **specific moment or experience** that shaped this view? What happened, and how did it affect you?`,
    `When you think about this more deeply, **what tensions or contradictions** do you notice in your thinking?`,
    `If you could explain this to someone who knows nothing about you, **what would be the most important thing** for them to understand?`,
    `**How has your perspective on this changed** over time? What caused those shifts?`,
    `**What would someone close to you** say about your approach to this? Would they agree with how you've described it?`,
    `Is there a **principle or framework** you use when navigating decisions in this area?`,
    `**What's the hardest part** about this topic for you? What makes it challenging?`,
    `If you imagine looking back on this five years from now, **what do you think you'd want to remember** about how you see it today?`,
  ];

  const reflection = reflections[messageCount % reflections.length];
  const question = questions[messageCount % questions.length];

  if (messageCount === 0) {
    return `I appreciate you getting started! Let me reflect on what you've shared.\n\n${reflection}\n\n${question}`;
  }

  return `${reflection}\n\n${question}`;
}

// Helper function to generate context-aware quick replies
function generateQuickReplies(messageCount: number): string[] {
  const replySets = [
    [
      "Yes, I have a specific example in mind",
      "I'd rather explore the broader picture first",
      "That's something I haven't thought about before"
    ],
    [
      "That resonates strongly with me",
      "I see it a bit differently actually",
      "Let me think about that for a moment"
    ],
    [
      "I've experienced this in my work life",
      "This connects to my personal values",
      "I'm not sure how to put it into words yet"
    ],
    [
      "There's a story that comes to mind",
      "I'd like to go deeper on that question",
      "Can we look at this from a different angle?"
    ],
  ];

  return replySets[messageCount % replySets.length];
}
