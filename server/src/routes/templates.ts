import { Router } from 'express';
import { db } from '../config/database.js';
import { useCaseTemplates, topics } from '../models/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export const templatesRouter = Router();

// Seed data for use case templates
const SEED_TEMPLATES = [
  {
    title: 'Teach AI to Write Emails Like Me',
    description: 'Extract your email writing style, tone preferences, common phrases, and communication patterns so AI can draft emails that sound authentically like you.',
    aiUseCaseTag: 'email_writing',
    interviewPrompts: [
      'Walk me through how you typically structure an important email.',
      'What phrases or sign-offs do you use most often?',
      'How does your tone change between a colleague, a client, and a friend?',
      'What makes an email feel "like you" vs generic?',
      'Show me an email you were proud of. What made it effective?',
    ],
  },
  {
    title: 'Teach AI My Management Style',
    description: 'Capture your approach to leading teams, giving feedback, making decisions, delegating work, and handling difficult conversations.',
    aiUseCaseTag: 'management_style',
    interviewPrompts: [
      'How do you approach giving constructive feedback to a team member?',
      'What does your ideal team dynamic look like?',
      'Describe a time you had to make a tough decision that affected your team.',
      'How do you decide what to delegate vs handle yourself?',
      'What is your philosophy on work-life balance for your team?',
    ],
  },
  {
    title: 'Teach AI How I Give Feedback',
    description: 'Document your feedback philosophy, delivery style, what you prioritize, and how you tailor feedback to different people and situations.',
    aiUseCaseTag: 'feedback_style',
    interviewPrompts: [
      'What is your go-to framework for giving feedback?',
      'How do you balance being honest with being kind?',
      'How does your feedback approach change for a senior vs junior person?',
      'What is the best piece of feedback you ever received?',
      'How do you deliver feedback on sensitive topics?',
    ],
  },
  {
    title: 'Teach AI My Decision-Making Process',
    description: 'Map out how you weigh options, handle uncertainty, balance intuition with data, and make high-stakes choices.',
    aiUseCaseTag: 'decision_making',
    interviewPrompts: [
      'Walk me through a recent important decision from start to finish.',
      'How do you balance gut feeling vs data when making choices?',
      'What do you do when you have to decide with incomplete information?',
      'What are your biggest decision-making biases, and how do you counter them?',
      'What is your process for reversing a bad decision?',
    ],
  },
  {
    title: 'Teach AI My Communication Preferences',
    description: 'Capture how you prefer to communicate across different channels, your tone, formality levels, and what good communication looks like to you.',
    aiUseCaseTag: 'communication_preferences',
    interviewPrompts: [
      'Do you prefer direct or diplomatic communication? In what contexts?',
      'How do you adjust your communication for different audiences?',
      'What is a communication pet peeve of yours?',
      'How do you handle misunderstandings or miscommunications?',
      'What does "clear communication" mean to you?',
    ],
  },
  {
    title: 'Teach AI My Problem-Solving Approach',
    description: 'Extract your mental models, frameworks, and step-by-step process for tackling complex problems.',
    aiUseCaseTag: 'problem_solving',
    interviewPrompts: [
      'When you face a new complex problem, what is the first thing you do?',
      'What mental models or frameworks do you rely on most?',
      'How do you break down a problem that feels overwhelming?',
      'Describe your approach to debugging or root cause analysis.',
      'How do you know when a problem is "good enough" solved vs needs more work?',
    ],
  },
  {
    title: 'Teach AI My Creative Process',
    description: 'Document where your ideas come from, how you brainstorm, what inspires you, and your process for turning ideas into reality.',
    aiUseCaseTag: 'creative_process',
    interviewPrompts: [
      'Where do your best ideas tend to come from?',
      'Describe your ideal creative environment.',
      'How do you evaluate which ideas are worth pursuing?',
      'What role does collaboration play in your creative process?',
      'What do you do when you hit a creative block?',
    ],
  },
  {
    title: 'Teach AI My Work Priorities',
    description: 'Map out how you prioritize tasks, manage your time, handle competing deadlines, and decide what matters most.',
    aiUseCaseTag: 'work_priorities',
    interviewPrompts: [
      'How do you decide what to work on first each day?',
      'What is your system for handling competing priorities?',
      'How do you distinguish between urgent and important?',
      'When do you say no to a request, and how?',
      'What does a productive day look like for you?',
    ],
  },
];

// Ensure templates are seeded in the database (idempotent - deduplicates by title)
function seedTemplatesIfNeeded() {
  const existing = db.select().from(useCaseTemplates).all();

  // Deduplicate: keep one per title, delete the rest
  const seenTitles = new Set<string>();
  const toDelete: string[] = [];
  for (const tpl of existing) {
    if (seenTitles.has(tpl.title)) {
      toDelete.push(tpl.id);
    } else {
      seenTitles.add(tpl.title);
    }
  }
  for (const id of toDelete) {
    db.delete(useCaseTemplates).where(eq(useCaseTemplates.id, id)).run();
  }
  if (toDelete.length > 0) {
    console.log(`[me.md] Cleaned ${toDelete.length} duplicate templates`);
  }

  // Seed any missing templates
  const afterClean = db.select().from(useCaseTemplates).all();
  const existingTitles = new Set(afterClean.map(t => t.title));

  let seededCount = 0;
  for (const tpl of SEED_TEMPLATES) {
    if (existingTitles.has(tpl.title)) continue;
    db.insert(useCaseTemplates).values({
      id: uuidv4(),
      title: tpl.title,
      description: tpl.description,
      aiUseCaseTag: tpl.aiUseCaseTag,
      interviewPrompts: JSON.stringify(tpl.interviewPrompts),
    }).run();
    seededCount++;
  }
  if (seededCount > 0) {
    console.log(`[me.md] Seeded ${seededCount} use case templates`);
  }
}

// Seed on import
seedTemplatesIfNeeded();

// GET /api/templates - List all use case templates
templatesRouter.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const templates = db.select().from(useCaseTemplates).all();

    res.json({ templates });
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// GET /api/templates/:id - Get template detail
templatesRouter.get('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;
    const templateId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const template = db.select().from(useCaseTemplates).where(
      eq(useCaseTemplates.id, templateId)
    ).get();

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ template });
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

// POST /api/topics/from-template/:templateId - Create a topic from a use case template
templatesRouter.post('/:id/create-topic', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;
    const templateId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const template = db.select().from(useCaseTemplates).where(
      eq(useCaseTemplates.id, templateId)
    ).get();

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Parse interview prompts
    let prompts: string[] = [];
    try {
      prompts = template.interviewPrompts ? JSON.parse(template.interviewPrompts) : [];
    } catch {
      prompts = [];
    }

    // Create a topic based on the template
    const topicId = uuidv4();
    const newTopic = db.insert(topics).values({
      id: topicId,
      userId,
      title: template.title,
      description: template.description,
      tags: JSON.stringify([template.aiUseCaseTag || 'use-case', 'template']),
      status: 'backlog',
      priority: 'medium',
      intent: 'articulate',
      trigger: prompts.length > 0 ? prompts[0] : null,
      useCaseTemplateId: template.id,
    }).returning().get();

    res.status(201).json({
      topic: newTopic,
      template: {
        id: template.id,
        title: template.title,
        aiUseCaseTag: template.aiUseCaseTag,
      },
    });
  } catch (error) {
    console.error('Create topic from template error:', error);
    res.status(500).json({ error: 'Failed to create topic from template' });
  }
});
