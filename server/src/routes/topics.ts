import { Router } from 'express';
import { db } from '../config/database.js';
import { topics } from '../models/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export const topicsRouter = Router();

// GET /api/topics - List all topics for a user
topicsRouter.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userTopics = db.select().from(topics).where(eq(topics.userId, userId)).all();

    res.json({ topics: userTopics });
  } catch (error) {
    console.error('List topics error:', error);
    res.status(500).json({ error: 'Failed to list topics' });
  }
});

// POST /api/topics - Create a new topic
topicsRouter.post('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { title, description, tags, status, priority, intent, trigger, referenceUrls, contextItems, isPreset, presetCategory } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const topicId = uuidv4();

    const newTopic = db.insert(topics).values({
      id: topicId,
      userId,
      title,
      description: description || null,
      tags: tags ? JSON.stringify(tags) : null,
      status: status || 'backlog',
      priority: priority || 'medium',
      intent: intent || null,
      trigger: trigger || null,
      referenceUrls: referenceUrls ? JSON.stringify(referenceUrls) : null,
      contextItems: contextItems ? JSON.stringify(contextItems) : null,
      isPreset: isPreset || false,
      presetCategory: presetCategory || null,
    }).returning().get();

    res.status(201).json({ topic: newTopic });
  } catch (error) {
    console.error('Create topic error:', error);
    res.status(500).json({ error: 'Failed to create topic', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// GET /api/topics/:id - Get a specific topic
topicsRouter.get('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;
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

    res.json({ topic });
  } catch (error) {
    console.error('Get topic error:', error);
    res.status(500).json({ error: 'Failed to get topic' });
  }
});

// PUT /api/topics/:id - Update a topic
topicsRouter.put('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
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

    const updated = db.update(topics)
      .set({
        title: title !== undefined ? title : existing.title,
        description: description !== undefined ? description : existing.description,
        tags: tags !== undefined ? JSON.stringify(tags) : existing.tags,
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

    res.json({ topic: updated });
  } catch (error) {
    console.error('Update topic error:', error);
    res.status(500).json({ error: 'Failed to update topic' });
  }
});

// DELETE /api/topics/:id - Delete a topic
topicsRouter.delete('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;
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

    db.delete(topics).where(eq(topics.id, topicId)).run();

    res.json({ message: 'Topic deleted successfully' });
  } catch (error) {
    console.error('Delete topic error:', error);
    res.status(500).json({ error: 'Failed to delete topic' });
  }
});
