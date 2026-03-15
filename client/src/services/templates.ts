/**
 * Use Case Templates Service
 * ============================
 * Ported from server/src/routes/templates.ts
 * Manages seeded use case templates that guide interview topics.
 */

import { eq } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import { useCaseTemplates, topics } from '@/db/schema'
import { scheduleSave } from '@/db/persistence'
import { LOCAL_USER_ID } from '@/contexts/UserContext'

type Db = SQLJsDatabase<typeof schema>

// ============================================
// Seed data
// ============================================

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
]

// ============================================
// Public API
// ============================================

/**
 * Seed default templates into the database (idempotent).
 * Deduplicates by title and inserts any missing templates.
 */
export function seedTemplates(db: Db) {
  const existing = db.select().from(useCaseTemplates).all()

  // Deduplicate: keep one per title
  const seenTitles = new Set<string>()
  const toDelete: string[] = []
  for (const tpl of existing) {
    if (seenTitles.has(tpl.title)) {
      toDelete.push(tpl.id)
    } else {
      seenTitles.add(tpl.title)
    }
  }
  for (const id of toDelete) {
    db.delete(useCaseTemplates).where(eq(useCaseTemplates.id, id)).run()
  }

  // Seed missing templates
  const afterClean = db.select().from(useCaseTemplates).all()
  const existingTitles = new Set(afterClean.map(t => t.title))

  let seededCount = 0
  for (const tpl of SEED_TEMPLATES) {
    if (existingTitles.has(tpl.title)) continue
    db.insert(useCaseTemplates).values({
      id: crypto.randomUUID(),
      title: tpl.title,
      description: tpl.description,
      aiUseCaseTag: tpl.aiUseCaseTag,
      interviewPrompts: JSON.stringify(tpl.interviewPrompts),
    }).run()
    seededCount++
  }

  if (seededCount > 0 || toDelete.length > 0) {
    scheduleSave()
  }

  return { seeded: seededCount, cleaned: toDelete.length }
}

/**
 * Get all use case templates.
 */
export function getTemplates(db: Db) {
  const templates = db.select().from(useCaseTemplates).all()
  return { templates }
}

/**
 * Get a single template by ID.
 */
export function getTemplate(db: Db, templateId: string) {
  const template = db.select().from(useCaseTemplates).where(eq(useCaseTemplates.id, templateId)).get()
  if (!template) throw new Error('Template not found')
  return { template }
}

/**
 * Create a topic from a use case template.
 */
export function createTopicFromTemplate(db: Db, templateId: string) {
  const template = db.select().from(useCaseTemplates).where(eq(useCaseTemplates.id, templateId)).get()
  if (!template) throw new Error('Template not found')

  let prompts: string[] = []
  try {
    prompts = template.interviewPrompts ? JSON.parse(template.interviewPrompts) : []
  } catch { /* empty */ }

  const topicId = crypto.randomUUID()
  const newTopic = db.insert(topics).values({
    id: topicId,
    userId: LOCAL_USER_ID,
    title: template.title,
    description: template.description,
    tags: JSON.stringify([template.aiUseCaseTag || 'use-case', 'template']),
    status: 'backlog',
    priority: 'medium',
    intent: 'articulate',
    trigger: prompts.length > 0 ? prompts[0] : null,
    useCaseTemplateId: template.id,
  }).returning().get()

  scheduleSave()

  return {
    topic: newTopic,
    template: {
      id: template.id,
      title: template.title,
      aiUseCaseTag: template.aiUseCaseTag,
    },
  }
}
