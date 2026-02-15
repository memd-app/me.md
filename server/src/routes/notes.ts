import { Router } from 'express';
import { db } from '../config/database.js';
import { notes, sessions, topics, messages, insights } from '../models/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export const notesRouter = Router();

// POST /api/sessions/:sessionId/distill - Generate distilled note from session
notesRouter.post('/sessions/:sessionId/distill', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const sessionId = req.params.sessionId;

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

    // Check if note already exists for this session
    const existingNote = db.select().from(notes).where(
      eq(notes.sessionId, sessionId)
    ).get();

    if (existingNote) {
      return res.json({ note: existingNote, alreadyExists: true });
    }

    // Get topic info
    const topic = db.select().from(topics).where(eq(topics.id, session.topicId)).get();

    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    // Get all messages for this session
    const sessionMessages = db.select().from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all();

    if (sessionMessages.length < 2) {
      return res.status(400).json({ error: 'Session needs at least one exchange before distillation' });
    }

    // Mark session as completed
    db.update(sessions).set({
      status: 'completed',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(sessions.id, sessionId)).run();

    // Update topic status to extracted
    db.update(topics).set({
      status: 'extracted',
      updatedAt: new Date().toISOString(),
    }).where(eq(topics.id, session.topicId)).run();

    // Generate distillation in all formats
    const userMessages = sessionMessages.filter(m => m.role === 'user');
    const assistantMessages = sessionMessages.filter(m => m.role === 'assistant');

    const fullAnalysis = generateFullAnalysis(topic.title, topic.description, userMessages, assistantMessages);
    const briefSummary = generateBriefSummary(topic.title, userMessages, assistantMessages);
    const decisionFramework = generateDecisionFramework(topic.title, userMessages, assistantMessages);
    const jsonContent = generateJsonContent(topic.title, userMessages, assistantMessages);

    // Create note
    const noteId = uuidv4();
    const selectedFormat = req.body.format || 'full_analysis';

    const newNote = db.insert(notes).values({
      id: noteId,
      sessionId,
      topicId: session.topicId,
      userId,
      title: `Session Notes: ${topic.title}`,
      contentFullAnalysis: fullAnalysis,
      contentBriefSummary: briefSummary,
      contentDecisionFramework: decisionFramework,
      contentJson: jsonContent,
      selectedFormat,
    }).returning().get();

    // Extract insights from the session
    const extractedInsights = extractInsightsFromSession(userMessages, topic.title);
    const savedInsights = [];

    for (const insight of extractedInsights) {
      const insightId = uuidv4();
      const saved = db.insert(insights).values({
        id: insightId,
        noteId,
        topicId: session.topicId,
        userId,
        content: insight.content,
        confidenceScore: insight.confidenceScore,
        verificationStatus: 'unverified',
        sourceSessionId: sessionId,
      }).returning().get();
      savedInsights.push(saved);
    }

    // Return the updated session too
    const updatedSession = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();

    res.status(201).json({
      note: newNote,
      insights: savedInsights,
      session: updatedSession,
    });
  } catch (error) {
    console.error('Distill session error:', error);
    res.status(500).json({ error: 'Failed to distill session', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// POST /api/sessions/:sessionId/distill/regenerate - Regenerate note in different format
notesRouter.post('/sessions/:sessionId/distill/regenerate', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const sessionId = req.params.sessionId;
    const { format } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!format || !['full_analysis', 'brief_summary', 'decision_framework', 'json'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Must be: full_analysis, brief_summary, decision_framework, or json' });
    }

    // Find existing note
    const note = db.select().from(notes).where(
      and(eq(notes.sessionId, sessionId), eq(notes.userId, userId))
    ).get();

    if (!note) {
      return res.status(404).json({ error: 'Note not found. Distill session first.' });
    }

    // Update selected format
    const updated = db.update(notes).set({
      selectedFormat: format,
      updatedAt: new Date().toISOString(),
    }).where(eq(notes.id, note.id)).returning().get();

    res.json({ note: updated });
  } catch (error) {
    console.error('Regenerate note error:', error);
    res.status(500).json({ error: 'Failed to regenerate note' });
  }
});

// GET /api/notes - List all notes for a user
notesRouter.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userNotes = db.select().from(notes)
      .where(eq(notes.userId, userId))
      .orderBy(desc(notes.createdAt))
      .all();

    res.json({ notes: userNotes });
  } catch (error) {
    console.error('List notes error:', error);
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

// GET /api/notes/:id - Get a specific note
notesRouter.get('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;
    const noteId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const note = db.select().from(notes).where(
      and(eq(notes.id, noteId), eq(notes.userId, userId))
    ).get();

    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // Get related insights
    const noteInsights = db.select().from(insights)
      .where(eq(insights.noteId, noteId))
      .all();

    res.json({ note, insights: noteInsights });
  } catch (error) {
    console.error('Get note error:', error);
    res.status(500).json({ error: 'Failed to get note' });
  }
});

// PUT /api/notes/:id - Edit note content
notesRouter.put('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const noteId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const note = db.select().from(notes).where(
      and(eq(notes.id, noteId), eq(notes.userId, userId))
    ).get();

    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const { contentFullAnalysis, contentBriefSummary, contentDecisionFramework, contentJson, selectedFormat, title } = req.body;

    const updated = db.update(notes).set({
      contentFullAnalysis: contentFullAnalysis !== undefined ? contentFullAnalysis : note.contentFullAnalysis,
      contentBriefSummary: contentBriefSummary !== undefined ? contentBriefSummary : note.contentBriefSummary,
      contentDecisionFramework: contentDecisionFramework !== undefined ? contentDecisionFramework : note.contentDecisionFramework,
      contentJson: contentJson !== undefined ? contentJson : note.contentJson,
      selectedFormat: selectedFormat !== undefined ? selectedFormat : note.selectedFormat,
      title: title !== undefined ? title : note.title,
      updatedAt: new Date().toISOString(),
    }).where(eq(notes.id, noteId)).returning().get();

    res.json({ note: updated });
  } catch (error) {
    console.error('Update note error:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// GET /api/notes/session/:sessionId - Get note for a specific session
notesRouter.get('/session/:sessionId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;
    const sessionId = req.params.sessionId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const note = db.select().from(notes).where(
      and(eq(notes.sessionId, sessionId), eq(notes.userId, userId))
    ).get();

    if (!note) {
      return res.status(404).json({ error: 'No note found for this session' });
    }

    const noteInsights = db.select().from(insights)
      .where(eq(insights.noteId, note.id))
      .all();

    res.json({ note, insights: noteInsights });
  } catch (error) {
    console.error('Get session note error:', error);
    res.status(500).json({ error: 'Failed to get session note' });
  }
});

// ============================================
// Distillation Generation Functions
// ============================================

interface MessageData {
  role: string;
  content: string;
  isBookmarked?: boolean | number | null;
}

function generateFullAnalysis(
  topicTitle: string,
  topicDescription: string | null,
  userMessages: MessageData[],
  assistantMessages: MessageData[]
): string {
  const userContent = userMessages.map(m => m.content).join('\n\n');

  // Extract key quotes from user messages
  const keyQuotes = userMessages
    .filter(m => m.content.length > 30)
    .slice(0, 5)
    .map(m => {
      // Get the most meaningful sentence
      const sentences = m.content.split(/[.!?]+/).filter(s => s.trim().length > 20);
      return sentences[0]?.trim() || m.content.substring(0, 150);
    });

  // Extract concepts mentioned
  const allWords = userContent.toLowerCase().split(/\s+/);
  const meaningfulWords = allWords.filter(w => w.length > 5);
  const wordFreq: Record<string, number> = {};
  meaningfulWords.forEach(w => {
    const clean = w.replace(/[^a-z]/g, '');
    if (clean.length > 5) {
      wordFreq[clean] = (wordFreq[clean] || 0) + 1;
    }
  });
  const topConcepts = Object.entries(wordFreq)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 8)
    .map(([word]) => word);

  // Build the Full Analysis markdown
  let analysis = `# Full Analysis: ${topicTitle}\n\n`;

  // Context section
  analysis += `## Context\n\n`;
  analysis += `This analysis distills insights from an interview session about **${topicTitle}**`;
  if (topicDescription) {
    analysis += ` — ${topicDescription}`;
  }
  analysis += `.\n\n`;
  analysis += `The session covered ${userMessages.length} user responses across ${userMessages.length + assistantMessages.length} total exchanges.\n\n`;

  // Core Principles section
  analysis += `## Core Principles\n\n`;
  if (keyQuotes.length > 0) {
    analysis += `Based on the conversation, the following core principles emerged:\n\n`;
    keyQuotes.slice(0, 3).forEach((quote, i) => {
      analysis += `${i + 1}. > "${quote}"\n\n`;
    });
  } else {
    analysis += `Further exploration is needed to identify core principles in this area.\n\n`;
  }

  // Mental Models & Frameworks section
  analysis += `## Mental Models & Frameworks\n\n`;
  if (topConcepts.length > 0) {
    analysis += `Key concepts that appeared frequently in the discussion:\n\n`;
    topConcepts.forEach(concept => {
      analysis += `- **${concept}**: Referenced in the context of ${topicTitle}\n`;
    });
    analysis += `\n`;
  }

  // Look for framework-like patterns in user messages
  const frameworkPatterns = userMessages
    .filter(m => m.content.includes('when') || m.content.includes('because') || m.content.includes('always') || m.content.includes('usually') || m.content.includes('tend to'))
    .slice(0, 3);

  if (frameworkPatterns.length > 0) {
    analysis += `Decision-making patterns observed:\n\n`;
    frameworkPatterns.forEach(m => {
      const excerpt = m.content.substring(0, 200).trim();
      analysis += `- "${excerpt}${m.content.length > 200 ? '...' : ''}"\n`;
    });
    analysis += `\n`;
  }

  // Key Examples section
  analysis += `## Key Examples\n\n`;
  const exampleMessages = userMessages.filter(m =>
    m.content.includes('example') || m.content.includes('time when') ||
    m.content.includes('instance') || m.content.includes('remember') ||
    m.content.includes('experience') || m.content.length > 100
  ).slice(0, 3);

  if (exampleMessages.length > 0) {
    exampleMessages.forEach((m, i) => {
      const excerpt = m.content.substring(0, 300).trim();
      analysis += `### Example ${i + 1}\n`;
      analysis += `> "${excerpt}${m.content.length > 300 ? '...' : ''}"\n\n`;
    });
  } else {
    analysis += `No specific examples were shared during this session. Consider exploring concrete experiences in a follow-up session.\n\n`;
  }

  // Open Questions & Tensions section
  analysis += `## Open Questions & Tensions\n\n`;

  // Look for uncertainty markers
  const uncertainMessages = userMessages.filter(m =>
    m.content.includes('not sure') || m.content.includes("don't know") ||
    m.content.includes('maybe') || m.content.includes('complicated') ||
    m.content.includes('but') || m.content.includes('however') ||
    m.content.includes('on the other hand') || m.content.includes('tension')
  ).slice(0, 3);

  if (uncertainMessages.length > 0) {
    analysis += `Areas of tension or uncertainty identified:\n\n`;
    uncertainMessages.forEach(m => {
      const excerpt = m.content.substring(0, 200).trim();
      analysis += `- "${excerpt}${m.content.length > 200 ? '...' : ''}"\n`;
    });
    analysis += `\n`;
  }

  analysis += `### Questions for Further Exploration\n\n`;
  analysis += `- How does this perspective on ${topicTitle} connect to other areas of life?\n`;
  analysis += `- What would change if circumstances were different?\n`;
  analysis += `- Are there counterexamples that challenge the principles identified above?\n`;

  return analysis;
}

function generateBriefSummary(
  topicTitle: string,
  userMessages: MessageData[],
  assistantMessages: MessageData[]
): string {
  let summary = `# Brief Summary: ${topicTitle}\n\n`;

  summary += `## TL;DR\n\n`;
  summary += `Interview session covering ${topicTitle} with ${userMessages.length} responses. `;

  if (userMessages.length > 0) {
    const firstResponse = userMessages[0].content.substring(0, 150).trim();
    summary += `The conversation began with: "${firstResponse}${userMessages[0].content.length > 150 ? '...' : ''}"\n\n`;
  }

  summary += `## Key Takeaways\n\n`;
  const takeaways = userMessages
    .filter(m => m.content.length > 30)
    .slice(0, 5)
    .map(m => {
      const sentences = m.content.split(/[.!?]+/).filter(s => s.trim().length > 15);
      return sentences[0]?.trim() || m.content.substring(0, 100).trim();
    });

  takeaways.forEach((takeaway, i) => {
    summary += `${i + 1}. ${takeaway}\n`;
  });
  summary += `\n`;

  summary += `## One Thing to Remember\n\n`;
  // Pick the longest/most detailed user message as the key insight
  const keyMessage = [...userMessages].sort((a, b) => b.content.length - a.content.length)[0];
  if (keyMessage) {
    const excerpt = keyMessage.content.substring(0, 200).trim();
    summary += `> "${excerpt}${keyMessage.content.length > 200 ? '...' : ''}"\n`;
  }

  return summary;
}

function generateDecisionFramework(
  topicTitle: string,
  userMessages: MessageData[],
  assistantMessages: MessageData[]
): string {
  let framework = `# Decision Framework: ${topicTitle}\n\n`;

  framework += `## Decision Context\n\n`;
  framework += `This framework synthesizes decision-making patterns from an interview about **${topicTitle}**.\n\n`;

  framework += `## Guiding Principles\n\n`;
  const principles = userMessages
    .filter(m => m.content.includes('important') || m.content.includes('believe') ||
      m.content.includes('value') || m.content.includes('always') || m.content.includes('principle'))
    .slice(0, 4);

  if (principles.length > 0) {
    principles.forEach((m, i) => {
      const excerpt = m.content.substring(0, 150).trim();
      framework += `${i + 1}. "${excerpt}${m.content.length > 150 ? '...' : ''}"\n`;
    });
  } else {
    framework += `- Explore further to identify explicit guiding principles\n`;
  }
  framework += `\n`;

  framework += `## Decision Criteria\n\n`;
  framework += `When making decisions about ${topicTitle}, consider:\n\n`;
  framework += `- Does it align with the core principles above?\n`;
  framework += `- How does past experience inform this choice?\n`;
  framework += `- What are the potential trade-offs?\n\n`;

  framework += `## Red Flags\n\n`;
  const concerns = userMessages.filter(m =>
    m.content.includes('worry') || m.content.includes('concern') ||
    m.content.includes('avoid') || m.content.includes('risk') || m.content.includes('problem')
  ).slice(0, 3);

  if (concerns.length > 0) {
    concerns.forEach(m => {
      const excerpt = m.content.substring(0, 150).trim();
      framework += `- "${excerpt}${m.content.length > 150 ? '...' : ''}"\n`;
    });
  } else {
    framework += `- No explicit red flags identified in this session\n`;
  }
  framework += `\n`;

  framework += `## Green Lights\n\n`;
  const positives = userMessages.filter(m =>
    m.content.includes('love') || m.content.includes('enjoy') ||
    m.content.includes('excited') || m.content.includes('passion') || m.content.includes('great')
  ).slice(0, 3);

  if (positives.length > 0) {
    positives.forEach(m => {
      const excerpt = m.content.substring(0, 150).trim();
      framework += `- "${excerpt}${m.content.length > 150 ? '...' : ''}"\n`;
    });
  } else {
    framework += `- Further sessions can help identify positive signals\n`;
  }

  return framework;
}

function generateJsonContent(
  topicTitle: string,
  userMessages: MessageData[],
  assistantMessages: MessageData[]
): string {
  const data = {
    topic: topicTitle,
    sessionDate: new Date().toISOString(),
    messageCount: userMessages.length + assistantMessages.length,
    userResponseCount: userMessages.length,
    principles: userMessages
      .filter(m => m.content.length > 50)
      .slice(0, 5)
      .map(m => {
        const sentences = m.content.split(/[.!?]+/).filter(s => s.trim().length > 15);
        return sentences[0]?.trim() || m.content.substring(0, 100).trim();
      }),
    frameworks: [] as string[],
    examples: userMessages
      .filter(m => m.content.length > 100)
      .slice(0, 3)
      .map(m => m.content.substring(0, 300).trim()),
    decisions: [] as string[],
    tags: extractTags(userMessages),
  };

  return JSON.stringify(data, null, 2);
}

function extractTags(userMessages: MessageData[]): string[] {
  const allText = userMessages.map(m => m.content).join(' ').toLowerCase();
  const tags: string[] = [];

  const tagPatterns: [string, RegExp][] = [
    ['values', /value|believe|principle|important/i],
    ['experience', /experience|memory|remember|time when/i],
    ['decision-making', /decide|choice|decision|chose/i],
    ['growth', /learn|grow|change|develop/i],
    ['relationships', /relationship|people|friend|family|colleague/i],
    ['career', /work|job|career|professional/i],
    ['creativity', /creative|create|design|build|make/i],
    ['leadership', /lead|manage|team|guide/i],
    ['communication', /communicate|talk|express|write/i],
    ['goals', /goal|aim|target|aspire|want to/i],
  ];

  tagPatterns.forEach(([tag, pattern]) => {
    if (pattern.test(allText)) {
      tags.push(tag);
    }
  });

  return tags.slice(0, 6);
}

function extractInsightsFromSession(
  userMessages: MessageData[],
  topicTitle: string
): Array<{ content: string; confidenceScore: number }> {
  const insights: Array<{ content: string; confidenceScore: number }> = [];

  // Extract insight-worthy statements from user messages
  for (const msg of userMessages) {
    // Skip very short messages
    if (msg.content.length < 30) continue;

    // Split into sentences and find insight-worthy ones
    const sentences = msg.content.split(/[.!?]+/).filter(s => s.trim().length > 20);

    for (const sentence of sentences) {
      const trimmed = sentence.trim();

      // Score based on insight markers
      let score = 50;

      if (/\b(believe|think|feel|value|important|always|never|principle)\b/i.test(trimmed)) {
        score += 15;
      }
      if (/\b(because|reason|learned|realized|understand)\b/i.test(trimmed)) {
        score += 10;
      }
      if (trimmed.length > 80) {
        score += 5;
      }
      if (msg.isBookmarked) {
        score += 20;
      }

      // Only include statements with reasonable confidence
      if (score >= 55 && trimmed.length > 25) {
        insights.push({
          content: trimmed.substring(0, 500),
          confidenceScore: Math.min(score, 95),
        });
      }
    }
  }

  // Deduplicate and limit
  const unique = insights.filter((insight, index, self) =>
    index === self.findIndex(t => t.content === insight.content)
  );

  return unique.slice(0, 10);
}
