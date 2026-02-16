import { Router } from 'express';
import { db } from '../config/database.js';
import { topics, sessions, messages, notes, insights, topicConnections, conceptNodes, bookmarks, users } from '../models/schema.js';
import { eq, and, or, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { generatePersonalizedTopicSuggestions, isAIAvailable, checkUserAIRateLimit } from '../services/ai.js';
import type { TopicSuggestionContext } from '../services/ai.js';

export const topicsRouter = Router();

// Valid enum values for topic fields
const VALID_STATUSES = ['backlog', 'scheduled', 'in_progress', 'extracted', 'refined'];
const VALID_PRIORITIES = ['high', 'medium', 'low'];
const VALID_INTENTS = ['articulate', 'explore', 'decide', 'document'];

// Preset topics data - 16 topics across 5 categories
const PRESET_TOPICS = [
  // Identity (4 topics)
  {
    title: 'Core Values & Beliefs',
    description: 'Explore the fundamental values and beliefs that guide your decisions and shape who you are.',
    category: 'identity',
    intent: 'articulate',
    tags: ['values', 'beliefs', 'identity'],
    suggestedQuestion: 'What are the 3-5 values you would never compromise on, even under pressure?',
  },
  {
    title: 'Personal Identity & Self-Image',
    description: 'How you see yourself, your strengths, and what makes you uniquely you.',
    category: 'identity',
    intent: 'explore',
    tags: ['self-image', 'strengths', 'identity'],
    suggestedQuestion: 'How would your closest friend describe you to someone who has never met you?',
  },
  {
    title: 'Life Philosophy & Worldview',
    description: 'Your overarching philosophy about life, purpose, and meaning.',
    category: 'identity',
    intent: 'articulate',
    tags: ['philosophy', 'worldview', 'meaning'],
    suggestedQuestion: 'What do you believe is the purpose of a well-lived life?',
  },
  // Skills (3 topics)
  {
    title: 'Communication Style',
    description: 'How you communicate in writing, speaking, and different contexts (professional vs personal).',
    category: 'skills',
    intent: 'articulate',
    tags: ['communication', 'writing', 'speaking'],
    suggestedQuestion: 'When you write an important email, what patterns do you notice in your style?',
  },
  {
    title: 'Problem-Solving Approach',
    description: 'Your methods and mental models for tackling challenges and making decisions.',
    category: 'skills',
    intent: 'explore',
    tags: ['problem-solving', 'decision-making', 'thinking'],
    suggestedQuestion: 'Walk me through how you approached the last difficult problem you solved.',
  },
  {
    title: 'Professional Expertise',
    description: 'Your domain knowledge, professional skills, and areas of deep expertise.',
    category: 'skills',
    intent: 'document',
    tags: ['expertise', 'professional', 'skills'],
    suggestedQuestion: 'What is the area where people most often seek your advice or expertise?',
  },
  // Experiences (3 topics)
  {
    title: 'Formative Life Experiences',
    description: 'Key moments and experiences that shaped who you are today.',
    category: 'experiences',
    intent: 'explore',
    tags: ['life-events', 'growth', 'formative'],
    suggestedQuestion: 'What experience in your life changed how you see the world the most?',
  },
  {
    title: 'Career Journey',
    description: 'Your professional path, key transitions, lessons learned, and career defining moments.',
    category: 'experiences',
    intent: 'document',
    tags: ['career', 'professional', 'journey'],
    suggestedQuestion: 'What was the most pivotal career decision you ever made, and what drove it?',
  },
  {
    title: 'Relationships & Social Patterns',
    description: 'How you build and maintain relationships, your social preferences, and interpersonal patterns.',
    category: 'experiences',
    intent: 'explore',
    tags: ['relationships', 'social', 'interpersonal'],
    suggestedQuestion: 'What does a deep, meaningful friendship look like to you?',
  },
  // Perspectives (3 topics)
  {
    title: 'Leadership & Management Style',
    description: 'How you lead, motivate others, handle conflict, and your management philosophy.',
    category: 'perspectives',
    intent: 'articulate',
    tags: ['leadership', 'management', 'team'],
    suggestedQuestion: 'What does great leadership look like to you, and how do you try to embody it?',
  },
  {
    title: 'Creative Process & Inspiration',
    description: 'How you generate ideas, find inspiration, and approach creative work.',
    category: 'perspectives',
    intent: 'explore',
    tags: ['creativity', 'inspiration', 'ideas'],
    suggestedQuestion: 'Where do your best ideas come from? Describe your creative process.',
  },
  {
    title: 'Feedback & Learning Style',
    description: 'How you give and receive feedback, and your preferred ways of learning new things.',
    category: 'perspectives',
    intent: 'explore',
    tags: ['feedback', 'learning', 'growth'],
    suggestedQuestion: 'How do you prefer to receive critical feedback, and how do you give it to others?',
  },
  // Goals (3 topics)
  {
    title: 'Short-term Goals & Priorities',
    description: 'What you are focused on achieving in the next 6-12 months.',
    category: 'goals',
    intent: 'decide',
    tags: ['goals', 'priorities', 'near-term'],
    suggestedQuestion: 'What are the top 3 things you want to accomplish in the next year?',
  },
  {
    title: 'Long-term Vision & Aspirations',
    description: 'Your big-picture aspirations and where you see yourself in 5-10 years.',
    category: 'goals',
    intent: 'explore',
    tags: ['vision', 'aspirations', 'long-term'],
    suggestedQuestion: 'If you could design your ideal life 10 years from now, what would it look like?',
  },
  {
    title: 'Personal Growth Areas',
    description: 'Skills, habits, or qualities you want to develop and improve.',
    category: 'goals',
    intent: 'decide',
    tags: ['growth', 'improvement', 'development'],
    suggestedQuestion: 'What is one area of your life where you feel there is the most room for growth?',
  },
  {
    title: 'Work-Life Balance & Boundaries',
    description: 'How you manage energy, set boundaries, and balance different areas of your life.',
    category: 'goals',
    intent: 'articulate',
    tags: ['balance', 'boundaries', 'wellness'],
    suggestedQuestion: 'What does a truly balanced week look like for you?',
  },
];

// GET /api/topics/presets - Get available preset topics
topicsRouter.get('/presets', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get user's existing preset topics to mark which ones are already selected
    const existingPresets = db.select().from(topics).where(
      and(eq(topics.userId, userId), eq(topics.isPreset, true))
    ).all();

    const existingTitles = new Set(existingPresets.map(t => t.title));

    // Group presets by category
    const categories: Record<string, { label: string; presets: typeof PRESET_TOPICS }> = {
      identity: { label: 'Identity', presets: [] },
      skills: { label: 'Skills', presets: [] },
      experiences: { label: 'Experiences', presets: [] },
      perspectives: { label: 'Perspectives', presets: [] },
      goals: { label: 'Goals', presets: [] },
    };

    const presetsWithStatus = PRESET_TOPICS.map(preset => ({
      ...preset,
      alreadySelected: existingTitles.has(preset.title),
    }));

    for (const preset of presetsWithStatus) {
      if (categories[preset.category]) {
        categories[preset.category].presets.push(preset as any);
      }
    }

    res.json({ presets: presetsWithStatus, categories });
  } catch (error) {
    console.error('Get preset topics error:', error);
    res.status(500).json({ error: 'Failed to get preset topics' });
  }
});

// POST /api/topics/presets/select - Create selected preset topics for the user
topicsRouter.post('/presets/select', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { selectedTopics } = req.body;

    if (!selectedTopics || !Array.isArray(selectedTopics) || selectedTopics.length === 0) {
      return res.status(400).json({ error: 'Please select at least one topic' });
    }

    // Check for existing presets to avoid duplicates
    const existingPresets = db.select().from(topics).where(
      and(eq(topics.userId, userId), eq(topics.isPreset, true))
    ).all();
    const existingTitles = new Set(existingPresets.map(t => t.title));

    const createdTopics = [];

    for (const selectedTitle of selectedTopics) {
      // Find the preset definition
      const presetDef = PRESET_TOPICS.find(p => p.title === selectedTitle);
      if (!presetDef) continue;

      // Skip if already exists
      if (existingTitles.has(selectedTitle)) continue;

      const topicId = uuidv4();
      const newTopic = db.insert(topics).values({
        id: topicId,
        userId,
        title: presetDef.title,
        description: presetDef.description,
        tags: JSON.stringify(presetDef.tags),
        status: 'backlog',
        priority: 'medium',
        intent: presetDef.intent,
        trigger: presetDef.suggestedQuestion,
        isPreset: true,
        presetCategory: presetDef.category,
      }).returning().get();

      createdTopics.push(newTopic);
    }

    res.status(201).json({
      message: `Created ${createdTopics.length} preset topic(s)`,
      topics: createdTopics,
      count: createdTopics.length,
    });
  } catch (error) {
    console.error('Select preset topics error:', error);
    res.status(500).json({ error: 'Failed to create preset topics' });
  }
});

// GET /api/topics/suggestions - Get AI-powered personalized topic suggestions
// Returns hardcoded presets for new users (cold start) or AI-generated suggestions for users with existing data
topicsRouter.get('/suggestions', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get user's existing topics
    const userTopics = db.select().from(topics).where(eq(topics.userId, userId)).all();

    // Get user profile info
    const userRecord = db.select().from(users).where(eq(users.id, userId)).get();

    // Get verified insights for this user
    const verifiedInsights = db.select({
      content: insights.content,
      topicId: insights.topicId,
      confidenceScore: insights.confidenceScore,
    }).from(insights).where(
      and(eq(insights.userId, userId), eq(insights.verificationStatus, 'verified'))
    ).all();

    // Enrich insights with topic titles
    const insightsWithTopics = verifiedInsights.map(insight => {
      const topic = userTopics.find(t => t.id === insight.topicId);
      return {
        content: insight.content,
        topicTitle: topic?.title || 'Unknown Topic',
        confidenceScore: insight.confidenceScore || 50,
      };
    });

    // Cold start: if user has fewer than 3 topics or no verified insights, return presets only
    if (userTopics.length < 3 || verifiedInsights.length === 0) {
      // Get existing preset titles to filter out already-selected ones
      const existingTitles = new Set(userTopics.map(t => t.title.toLowerCase()));

      const coldStartSuggestions = PRESET_TOPICS
        .filter(p => !existingTitles.has(p.title.toLowerCase()))
        .slice(0, 5)
        .map(p => ({
          title: p.title,
          description: p.description,
          category: p.category,
          intent: p.intent,
          tags: p.tags,
          suggestedQuestion: p.suggestedQuestion,
          rationale: 'Recommended starter topic to build your personal knowledge base.',
          source: 'preset' as const,
        }));

      return res.json({
        suggestions: coldStartSuggestions,
        source: 'preset',
        message: 'Showing starter topic suggestions. Complete more sessions to unlock personalized AI suggestions.',
      });
    }

    // Check if AI is available
    if (!isAIAvailable()) {
      // AI not configured: return filtered presets as suggestions
      const existingTitles = new Set(userTopics.map(t => t.title.toLowerCase()));
      const fallbackSuggestions = PRESET_TOPICS
        .filter(p => !existingTitles.has(p.title.toLowerCase()))
        .slice(0, 5)
        .map(p => ({
          title: p.title,
          description: p.description,
          category: p.category,
          intent: p.intent,
          tags: p.tags,
          suggestedQuestion: p.suggestedQuestion,
          rationale: 'Suggested based on common self-knowledge areas.',
          source: 'preset' as const,
        }));

      return res.json({
        suggestions: fallbackSuggestions,
        source: 'preset',
        message: 'AI suggestions are currently unavailable. Showing recommended topics.',
      });
    }

    // Check rate limit
    const rateCheck = checkUserAIRateLimit(userId);
    if (!rateCheck.allowed) {
      const existingTitles = new Set(userTopics.map(t => t.title.toLowerCase()));
      const fallbackSuggestions = PRESET_TOPICS
        .filter(p => !existingTitles.has(p.title.toLowerCase()))
        .slice(0, 5)
        .map(p => ({
          title: p.title,
          description: p.description,
          category: p.category,
          intent: p.intent,
          tags: p.tags,
          suggestedQuestion: p.suggestedQuestion,
          rationale: 'Suggested based on common self-knowledge areas.',
          source: 'preset' as const,
        }));

      return res.json({
        suggestions: fallbackSuggestions,
        source: 'preset',
        message: 'AI rate limit reached. Showing recommended topics. Try again later for personalized suggestions.',
      });
    }

    // Get topic connections for cross-topic analysis
    const allConnections = db.select().from(topicConnections).all();
    const userConnections = allConnections
      .filter(c => {
        const sourceMatch = userTopics.some(t => t.id === c.sourceTopicId);
        const targetMatch = userTopics.some(t => t.id === c.targetTopicId);
        return sourceMatch && targetMatch;
      })
      .map(c => {
        const sourceT = userTopics.find(t => t.id === c.sourceTopicId);
        const targetT = userTopics.find(t => t.id === c.targetTopicId);
        return {
          sourceTopic: sourceT?.title || 'Unknown',
          targetTopic: targetT?.title || 'Unknown',
          connectionType: c.connectionType,
        };
      });

    // Build the context for Claude
    const suggestionContext: TopicSuggestionContext = {
      userName: userRecord?.name || '',
      occupation: userRecord?.occupation || '',
      existingTopics: userTopics.map(t => ({
        title: t.title,
        status: t.status || 'backlog',
        tags: t.tags,
        intent: t.intent,
        presetCategory: t.presetCategory,
      })),
      verifiedInsights: insightsWithTopics,
      topicConnections: userConnections,
    };

    // Call Claude for personalized suggestions
    const aiSuggestions = await generatePersonalizedTopicSuggestions(suggestionContext);

    if (!aiSuggestions || aiSuggestions.length === 0) {
      // Fallback to presets if AI fails
      const existingTitles = new Set(userTopics.map(t => t.title.toLowerCase()));
      const fallbackSuggestions = PRESET_TOPICS
        .filter(p => !existingTitles.has(p.title.toLowerCase()))
        .slice(0, 5)
        .map(p => ({
          title: p.title,
          description: p.description,
          category: p.category,
          intent: p.intent,
          tags: p.tags,
          suggestedQuestion: p.suggestedQuestion,
          rationale: 'Suggested based on common self-knowledge areas.',
          source: 'preset' as const,
        }));

      return res.json({
        suggestions: fallbackSuggestions,
        source: 'preset',
        message: 'Could not generate personalized suggestions at this time. Showing recommended topics.',
      });
    }

    // Filter out suggestions that duplicate existing topic titles
    const existingTitles = new Set(userTopics.map(t => t.title.toLowerCase()));
    const filteredSuggestions = aiSuggestions
      .filter(s => !existingTitles.has(s.title.toLowerCase()))
      .map(s => ({
        ...s,
        source: 'ai' as const,
      }));

    return res.json({
      suggestions: filteredSuggestions,
      source: 'ai',
      message: `Generated ${filteredSuggestions.length} personalized topic suggestions based on your ${verifiedInsights.length} verified insights across ${userTopics.length} topics.`,
    });
  } catch (error) {
    console.error('Get topic suggestions error:', error);
    res.status(500).json({ error: 'Failed to generate topic suggestions' });
  }
});

// POST /api/topics/suggestions/accept - Create a topic from an AI suggestion
topicsRouter.post('/suggestions/accept', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { title, description, category, intent, tags, suggestedQuestion } = req.body;

    if (!title || (typeof title === 'string' && !title.trim())) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const topicId = uuidv4();

    // Sanitize tags
    const sanitizedTags = Array.isArray(tags)
      ? [...new Set(tags.map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 0))]
      : null;

    const newTopic = db.insert(topics).values({
      id: topicId,
      userId,
      title: title.trim(),
      description: description || null,
      tags: sanitizedTags ? JSON.stringify(sanitizedTags) : null,
      status: 'backlog',
      priority: 'medium',
      intent: intent || 'explore',
      trigger: suggestedQuestion || null,
      isPreset: false,
      presetCategory: category || null,
    }).returning().get();

    res.status(201).json({
      topic: newTopic,
      message: `Created topic "${title.trim()}" from AI suggestion`,
    });
  } catch (error) {
    console.error('Accept topic suggestion error:', error);
    res.status(500).json({ error: 'Failed to create topic from suggestion' });
  }
});

// GET /api/topics/check-title - Check if a topic with this title already exists for the user
topicsRouter.get('/check-title', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const title = req.query.title as string;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title query parameter is required' });
    }

    const trimmedTitle = title.trim().toLowerCase();

    // Find existing topics with the same title (case-insensitive)
    const userTopics = db.select().from(topics).where(eq(topics.userId, userId)).all();
    const duplicates = userTopics.filter(t => t.title.trim().toLowerCase() === trimmedTitle);

    res.json({
      exists: duplicates.length > 0,
      count: duplicates.length,
      existingTopics: duplicates.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    console.error('Check title error:', error);
    res.status(500).json({ error: 'Failed to check title' });
  }
});

// GET /api/topics - List all topics for a user
topicsRouter.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userTopics = db.select().from(topics).where(eq(topics.userId, userId)).orderBy(desc(topics.createdAt)).all();

    res.json({ topics: userTopics });
  } catch (error) {
    console.error('List topics error:', error);
    res.status(500).json({ error: 'Failed to list topics' });
  }
});

// POST /api/topics - Create a new topic
topicsRouter.post('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { title, description, tags, status, priority, intent, trigger, referenceUrls, contextItems, isPreset, presetCategory } = req.body;

    if (!title || (typeof title === 'string' && !title.trim())) {
      return res.status(400).json({ error: 'Title is required. Please provide a descriptive name for your topic.' });
    }

    if (typeof title === 'string' && title.trim().length > 200) {
      return res.status(400).json({ error: 'Title is too long. Please keep it under 200 characters.' });
    }

    // Validate status if provided
    if (status !== undefined && status !== null && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`
      });
    }

    // Validate priority if provided
    if (priority !== undefined && priority !== null && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        error: `Invalid priority "${priority}". Must be one of: ${VALID_PRIORITIES.join(', ')}`
      });
    }

    // Validate intent if provided
    if (intent !== undefined && intent !== null && !VALID_INTENTS.includes(intent)) {
      return res.status(400).json({
        error: `Invalid intent "${intent}". Must be one of: ${VALID_INTENTS.join(', ')}`
      });
    }

    // Validate tags is an array if provided
    if (tags !== undefined && tags !== null && !Array.isArray(tags)) {
      return res.status(400).json({ error: 'Tags must be an array of strings' });
    }

    // Validate tag count and individual tag lengths
    if (Array.isArray(tags)) {
      if (tags.length > 20) {
        return res.status(400).json({ error: 'Too many tags. Maximum of 20 tags allowed.' });
      }
      for (const tag of tags) {
        if (typeof tag !== 'string') {
          return res.status(400).json({ error: 'Each tag must be a string.' });
        }
        if (tag.trim().length === 0) {
          return res.status(400).json({ error: 'Tags cannot be empty strings.' });
        }
        if (tag.trim().length > 50) {
          return res.status(400).json({ error: `Tag "${tag.trim().slice(0, 20)}..." is too long. Maximum 50 characters per tag.` });
        }
      }
    }

    // Validate description length if provided
    if (description && typeof description === 'string' && description.length > 2000) {
      return res.status(400).json({ error: 'Description is too long. Please keep it under 2000 characters.' });
    }

    // Check for existing topics with same title (case-insensitive) for duplicate warning
    const trimmedTitle = title.trim().toLowerCase();
    const userTopics = db.select().from(topics).where(eq(topics.userId, userId)).all();
    const existingDuplicates = userTopics.filter(t => t.title.trim().toLowerCase() === trimmedTitle);

    const topicId = uuidv4();

    // Sanitize tags: trim, lowercase, deduplicate
    const sanitizedTags = Array.isArray(tags)
      ? [...new Set(tags.map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 0))]
      : null;

    const newTopic = db.insert(topics).values({
      id: topicId,
      userId,
      title,
      description: description || null,
      tags: sanitizedTags ? JSON.stringify(sanitizedTags) : null,
      status: status || 'backlog',
      priority: priority || 'medium',
      intent: intent || null,
      trigger: trigger || null,
      referenceUrls: referenceUrls ? JSON.stringify(referenceUrls) : null,
      contextItems: contextItems ? JSON.stringify(contextItems) : null,
      isPreset: isPreset || false,
      presetCategory: presetCategory || null,
    }).returning().get();

    const response: Record<string, any> = { topic: newTopic };

    // Include duplicate warning if there were existing topics with the same title
    if (existingDuplicates.length > 0) {
      response.warning = `A topic with the title "${title.trim()}" already exists. Both topics have been kept — you can distinguish them by their creation dates and descriptions.`;
      response.duplicateCount = existingDuplicates.length;
      response.existingTopics = existingDuplicates.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        createdAt: t.createdAt,
      }));
    }

    res.status(201).json(response);
  } catch (error) {
    console.error('Create topic error:', error);
    res.status(500).json({ error: 'Failed to create topic. Please try again later.' });
  }
});

// GET /api/topics/:id - Get a specific topic
topicsRouter.get('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const topicId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const topic = db.select().from(topics).where(
      and(eq(topics.id, topicId), eq(topics.userId, userId))
    ).get();

    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    // Fetch related insights for this topic
    const topicInsights = db.select().from(insights).where(
      and(eq(insights.topicId, topicId), eq(insights.userId, userId))
    ).all();

    // Fetch connected topics via topic_connections
    const connections = db.select().from(topicConnections).where(
      or(eq(topicConnections.sourceTopicId, topicId), eq(topicConnections.targetTopicId, topicId))
    ).all();

    // Get details for connected topic IDs
    const connectedTopicIds = connections.map(c =>
      c.sourceTopicId === topicId ? c.targetTopicId : c.sourceTopicId
    ).filter((id, index, self) => self.indexOf(id) === index); // deduplicate

    const connectedTopics = connectedTopicIds.map(ctId => {
      const ct = db.select().from(topics).where(
        and(eq(topics.id, ctId), eq(topics.userId, userId))
      ).get();
      if (!ct) return null;
      const conn = connections.find(c =>
        (c.sourceTopicId === topicId && c.targetTopicId === ctId) ||
        (c.targetTopicId === topicId && c.sourceTopicId === ctId)
      );
      return {
        id: ct.id,
        title: ct.title,
        status: ct.status,
        connectionType: conn?.connectionType || 'unknown',
        relevanceScore: conn?.relevanceScore || 0,
      };
    }).filter(Boolean);

    res.json({ topic, insights: topicInsights, connectedTopics });
  } catch (error) {
    console.error('Get topic error:', error);
    res.status(500).json({ error: 'Failed to get topic' });
  }
});

// POST /api/topics/:id/connections - Create cross-topic connections (multi-bucket)
topicsRouter.post('/:id/connections', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const sourceTopicId = req.params.id;
    const { connections } = req.body; // Array of { targetTopicId, relevanceScore }

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Verify source topic belongs to user
    const sourceTopic = db.select().from(topics).where(
      and(eq(topics.id, sourceTopicId), eq(topics.userId, userId))
    ).get();

    if (!sourceTopic) {
      return res.status(404).json({ error: 'Source topic not found' });
    }

    if (!connections || !Array.isArray(connections) || connections.length === 0) {
      return res.status(400).json({ error: 'connections array is required' });
    }

    const created = [];
    for (const conn of connections) {
      const { targetTopicId, relevanceScore } = conn;

      // Verify target topic belongs to user
      const targetTopic = db.select().from(topics).where(
        and(eq(topics.id, targetTopicId), eq(topics.userId, userId))
      ).get();

      if (!targetTopic) continue;

      // Check for existing connection (avoid duplicates)
      const existing = db.select().from(topicConnections).where(
        or(
          and(
            eq(topicConnections.sourceTopicId, sourceTopicId),
            eq(topicConnections.targetTopicId, targetTopicId)
          ),
          and(
            eq(topicConnections.sourceTopicId, targetTopicId),
            eq(topicConnections.targetTopicId, sourceTopicId)
          )
        )
      ).get();

      if (existing) continue; // Skip duplicates

      const connectionId = uuidv4();
      const saved = db.insert(topicConnections).values({
        id: connectionId,
        sourceTopicId,
        targetTopicId,
        connectionType: 'multi_bucket',
        relevanceScore: Math.min(Math.max(relevanceScore || 0, 0), 100),
      }).returning().get();

      created.push({
        ...saved,
        targetTopicTitle: targetTopic.title,
      });
    }

    res.status(201).json({ connections: created, count: created.length });
  } catch (error) {
    console.error('Create topic connections error:', error);
    res.status(500).json({ error: 'Failed to create topic connections' });
  }
});

// PUT /api/topics/:id - Update a topic
topicsRouter.put('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const topicId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Verify the topic belongs to the user
    const existing = db.select().from(topics).where(
      and(eq(topics.id, topicId), eq(topics.userId, userId))
    ).get();

    if (!existing) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    const { title, description, tags, status, priority, intent, trigger, referenceUrls, contextItems } = req.body;

    // Validate title if provided
    if (title !== undefined) {
      if (!title || (typeof title === 'string' && !title.trim())) {
        return res.status(400).json({ error: 'Title cannot be empty.' });
      }
      if (typeof title === 'string' && title.trim().length > 200) {
        return res.status(400).json({ error: 'Title is too long. Please keep it under 200 characters.' });
      }
    }

    // Validate status if provided
    if (status !== undefined && status !== null && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`
      });
    }

    // Validate priority if provided
    if (priority !== undefined && priority !== null && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        error: `Invalid priority "${priority}". Must be one of: ${VALID_PRIORITIES.join(', ')}`
      });
    }

    // Validate intent if provided
    if (intent !== undefined && intent !== null && !VALID_INTENTS.includes(intent)) {
      return res.status(400).json({
        error: `Invalid intent "${intent}". Must be one of: ${VALID_INTENTS.join(', ')}`
      });
    }

    // Validate tags is an array if provided
    if (tags !== undefined && tags !== null && !Array.isArray(tags)) {
      return res.status(400).json({ error: 'Tags must be an array of strings' });
    }

    // Validate tag count and individual tag lengths
    if (Array.isArray(tags)) {
      if (tags.length > 20) {
        return res.status(400).json({ error: 'Too many tags. Maximum of 20 tags allowed.' });
      }
      for (const tag of tags) {
        if (typeof tag !== 'string') {
          return res.status(400).json({ error: 'Each tag must be a string.' });
        }
        if (tag.trim().length === 0) {
          return res.status(400).json({ error: 'Tags cannot be empty strings.' });
        }
        if (tag.trim().length > 50) {
          return res.status(400).json({ error: `Tag "${tag.trim().slice(0, 20)}..." is too long. Maximum 50 characters per tag.` });
        }
      }
    }

    // Validate description length if provided
    if (description !== undefined && description !== null && typeof description === 'string' && description.length > 2000) {
      return res.status(400).json({ error: 'Description is too long. Please keep it under 2000 characters.' });
    }

    // Sanitize tags: trim, lowercase, deduplicate
    const sanitizedTags = Array.isArray(tags)
      ? [...new Set(tags.map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 0))]
      : undefined;

    const updated = db.update(topics)
      .set({
        title: title !== undefined ? title : existing.title,
        description: description !== undefined ? description : existing.description,
        tags: sanitizedTags !== undefined ? JSON.stringify(sanitizedTags) : (tags === null ? null : existing.tags),
        status: status !== undefined ? status : existing.status,
        priority: priority !== undefined ? priority : existing.priority,
        intent: intent !== undefined ? intent : existing.intent,
        trigger: trigger !== undefined ? trigger : existing.trigger,
        referenceUrls: referenceUrls !== undefined ? JSON.stringify(referenceUrls) : existing.referenceUrls,
        contextItems: contextItems !== undefined ? JSON.stringify(contextItems) : existing.contextItems,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(topics.id, topicId), eq(topics.userId, userId)))
      .returning()
      .get();

    const response: Record<string, any> = { topic: updated };

    // Check for duplicate title warning when title is being updated
    if (title !== undefined && title.trim()) {
      const trimmedTitle = title.trim().toLowerCase();
      const userTopics = db.select().from(topics).where(eq(topics.userId, userId)).all();
      const duplicates = userTopics.filter(t => t.id !== topicId && t.title.trim().toLowerCase() === trimmedTitle);
      if (duplicates.length > 0) {
        response.warning = `Another topic with the title "${title.trim()}" already exists. Both topics have been kept.`;
        response.duplicateCount = duplicates.length;
      }
    }

    res.json(response);
  } catch (error) {
    console.error('Update topic error:', error);
    res.status(500).json({ error: 'Failed to update topic' });
  }
});

// DELETE /api/topics/:id - Delete a topic (cascades to sessions, messages, notes, insights, connections, concept nodes)
topicsRouter.delete('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const topicId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const existing = db.select().from(topics).where(
      and(eq(topics.id, topicId), eq(topics.userId, userId))
    ).get();

    if (!existing) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    // Count related data before deletion for response info
    const relatedSessions = db.select().from(sessions).where(eq(sessions.topicId, topicId)).all();
    const sessionIds = relatedSessions.map(s => s.id);

    let messageCount = 0;
    let bookmarkCount = 0;
    for (const sid of sessionIds) {
      const msgs = db.select().from(messages).where(eq(messages.sessionId, sid)).all();
      messageCount += msgs.length;
      const bks = db.select().from(bookmarks).where(eq(bookmarks.sessionId, sid)).all();
      bookmarkCount += bks.length;
    }

    const relatedNotes = db.select().from(notes).where(eq(notes.topicId, topicId)).all();
    const relatedInsights = db.select().from(insights).where(eq(insights.topicId, topicId)).all();
    const relatedConnections = db.select().from(topicConnections).where(
      or(eq(topicConnections.sourceTopicId, topicId), eq(topicConnections.targetTopicId, topicId))
    ).all();
    const relatedConceptNodes = db.select().from(conceptNodes).where(eq(conceptNodes.topicId, topicId)).all();

    const cascadedCounts = {
      sessions: relatedSessions.length,
      messages: messageCount,
      notes: relatedNotes.length,
      insights: relatedInsights.length,
      connections: relatedConnections.length,
      conceptNodes: relatedConceptNodes.length,
      bookmarks: bookmarkCount,
    };

    // Delete the topic - ON DELETE CASCADE handles all related data
    db.delete(topics).where(eq(topics.id, topicId)).run();

    res.json({
      message: 'Topic deleted successfully',
      topicId,
      topicTitle: existing.title,
      cascaded: cascadedCounts,
    });
  } catch (error) {
    console.error('Delete topic error:', error);
    res.status(500).json({ error: 'Failed to delete topic' });
  }
});
