import { Router } from 'express';
import { db } from '../config/database.js';
import { insights, topics, users, notes } from '../models/schema.js';
import { eq, and, desc } from 'drizzle-orm';

export const profileRouter = Router();

interface ProfileSection {
  title: string;
  content: string[];
  topicSources: string[];
}

interface ProfileSummary {
  userName: string;
  occupation: string;
  location: string;
  generatedAt: string;
  totalVerifiedInsights: number;
  topicsExplored: number;
  sections: {
    personalPortrait: ProfileSection;
    communicationStyle: ProfileSection;
    decisionMakingPatterns: ProfileSection;
    strengthsAndExpertise: ProfileSection;
    toneOfVoice: ProfileSection;
    keyThemes: ProfileSection;
  };
}

// Keywords for categorizing insights into profile sections
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  personalPortrait: [
    'value', 'believe', 'belief', 'core', 'trait', 'identity', 'principle',
    'important to me', 'who i am', 'personality', 'character', 'define',
    'fundamental', 'deeply', 'always', 'never', 'matter', 'care about',
    'passionate', 'driven', 'motivated', 'philosophy', 'worldview',
    'perspective', 'conviction', 'authentic', 'integrity', 'moral',
  ],
  communicationStyle: [
    'communicate', 'communication', 'speak', 'talk', 'write', 'writing',
    'email', 'conversation', 'express', 'tone', 'language', 'word',
    'listen', 'feedback', 'direct', 'indirect', 'formal', 'informal',
    'prefer to say', 'way i', 'style', 'approach to', 'respond',
    'message', 'clarity', 'concise', 'verbose', 'articulate',
  ],
  decisionMakingPatterns: [
    'decide', 'decision', 'choose', 'choice', 'evaluate', 'weigh',
    'consider', 'prioritize', 'priority', 'trade-off', 'tradeoff',
    'framework', 'criteria', 'factor', 'process', 'approach',
    'strategy', 'analyze', 'analysis', 'risk', 'opportunity',
    'gut feeling', 'intuition', 'data-driven', 'rational', 'logic',
  ],
  strengthsAndExpertise: [
    'strength', 'strong', 'expert', 'expertise', 'skill', 'skilled',
    'good at', 'excel', 'talent', 'ability', 'capable', 'competent',
    'proficient', 'experience', 'knowledge', 'know how', 'specialize',
    'professional', 'craft', 'master', 'accomplish', 'achievement',
    'excel at', 'best at', 'naturally', 'gifted',
  ],
  toneOfVoice: [
    'tone', 'voice', 'humor', 'humour', 'sarcasm', 'sarcastic',
    'serious', 'casual', 'formal', 'warm', 'cold', 'empathetic',
    'blunt', 'diplomatic', 'friendly', 'reserved', 'enthusiastic',
    'calm', 'passionate', 'measured', 'emotional', 'detached',
    'witty', 'dry', 'encouraging', 'supportive', 'critical',
  ],
};

function categorizeInsight(content: string, topicTitle: string): string[] {
  const lowerContent = content.toLowerCase();
  const lowerTopic = topicTitle.toLowerCase();
  const combined = `${lowerContent} ${lowerTopic}`;
  const categories: string[] = [];

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const matchCount = keywords.filter(kw => combined.includes(kw)).length;
    if (matchCount >= 1) {
      categories.push(category);
    }
  }

  // If no category matched, put it in personalPortrait as a catch-all
  if (categories.length === 0) {
    categories.push('personalPortrait');
  }

  return categories;
}

function buildProfileSummary(
  user: typeof users.$inferSelect,
  verifiedInsights: Array<{ content: string; topicTitle: string | null; confidenceScore: number | null }>,
  topicCount: number
): ProfileSummary {
  // Initialize sections
  const sectionData: Record<string, { content: string[]; topicSources: Set<string> }> = {
    personalPortrait: { content: [], topicSources: new Set() },
    communicationStyle: { content: [], topicSources: new Set() },
    decisionMakingPatterns: { content: [], topicSources: new Set() },
    strengthsAndExpertise: { content: [], topicSources: new Set() },
    toneOfVoice: { content: [], topicSources: new Set() },
    keyThemes: { content: [], topicSources: new Set() },
  };

  // Categorize each insight
  for (const insight of verifiedInsights) {
    const topicTitle = insight.topicTitle || 'General';
    const categories = categorizeInsight(insight.content, topicTitle);

    for (const category of categories) {
      if (sectionData[category]) {
        sectionData[category].content.push(insight.content);
        sectionData[category].topicSources.add(topicTitle);
      }
    }
  }

  // Build key themes from topic sources that appear across multiple insights
  const topicInsightCounts: Record<string, number> = {};
  for (const insight of verifiedInsights) {
    const t = insight.topicTitle || 'General';
    topicInsightCounts[t] = (topicInsightCounts[t] || 0) + 1;
  }

  const keyThemes = Object.entries(topicInsightCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([topic, count]) => `${topic} (${count} verified insight${count > 1 ? 's' : ''})`);

  sectionData.keyThemes.content = keyThemes;
  sectionData.keyThemes.topicSources = new Set(Object.keys(topicInsightCounts));

  const makeSectionObj = (key: string, title: string): ProfileSection => ({
    title,
    content: sectionData[key].content,
    topicSources: Array.from(sectionData[key].topicSources),
  });

  return {
    userName: user.name,
    occupation: user.occupation,
    location: user.location,
    generatedAt: new Date().toISOString(),
    totalVerifiedInsights: verifiedInsights.length,
    topicsExplored: topicCount,
    sections: {
      personalPortrait: makeSectionObj('personalPortrait', 'Personal Portrait'),
      communicationStyle: makeSectionObj('communicationStyle', 'Communication Style'),
      decisionMakingPatterns: makeSectionObj('decisionMakingPatterns', 'Decision-Making Patterns'),
      strengthsAndExpertise: makeSectionObj('strengthsAndExpertise', 'Strengths & Expertise'),
      toneOfVoice: makeSectionObj('toneOfVoice', 'Tone of Voice'),
      keyThemes: makeSectionObj('keyThemes', 'Key Themes & Connections'),
    },
  };
}

function generateMarkdown(summary: ProfileSummary): string {
  const lines: string[] = [];
  lines.push(`# ${summary.userName}'s me.md`);
  lines.push('');
  lines.push(`> Auto-generated personal context profile`);
  lines.push(`> Generated: ${new Date(summary.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
  lines.push(`> ${summary.totalVerifiedInsights} verified insights across ${summary.topicsExplored} topics`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Personal Portrait
  const portrait = summary.sections.personalPortrait;
  lines.push(`## ${portrait.title}`);
  lines.push('');
  if (lines.length > 0 && portrait.content.length > 0) {
    lines.push(`*${summary.occupation} based in ${summary.location}*`);
    lines.push('');
    for (const item of portrait.content) {
      lines.push(`- ${item}`);
    }
    if (portrait.topicSources.length > 0) {
      lines.push('');
      lines.push(`*Sources: ${portrait.topicSources.join(', ')}*`);
    }
  } else {
    lines.push('*No verified insights in this category yet.*');
  }
  lines.push('');

  // Communication Style
  const comm = summary.sections.communicationStyle;
  lines.push(`## ${comm.title}`);
  lines.push('');
  if (comm.content.length > 0) {
    for (const item of comm.content) {
      lines.push(`- ${item}`);
    }
    if (comm.topicSources.length > 0) {
      lines.push('');
      lines.push(`*Sources: ${comm.topicSources.join(', ')}*`);
    }
  } else {
    lines.push('*No verified insights in this category yet.*');
  }
  lines.push('');

  // Decision-Making Patterns
  const decisions = summary.sections.decisionMakingPatterns;
  lines.push(`## ${decisions.title}`);
  lines.push('');
  if (decisions.content.length > 0) {
    for (const item of decisions.content) {
      lines.push(`- ${item}`);
    }
    if (decisions.topicSources.length > 0) {
      lines.push('');
      lines.push(`*Sources: ${decisions.topicSources.join(', ')}*`);
    }
  } else {
    lines.push('*No verified insights in this category yet.*');
  }
  lines.push('');

  // Strengths & Expertise
  const strengths = summary.sections.strengthsAndExpertise;
  lines.push(`## ${strengths.title}`);
  lines.push('');
  if (strengths.content.length > 0) {
    for (const item of strengths.content) {
      lines.push(`- ${item}`);
    }
    if (strengths.topicSources.length > 0) {
      lines.push('');
      lines.push(`*Sources: ${strengths.topicSources.join(', ')}*`);
    }
  } else {
    lines.push('*No verified insights in this category yet.*');
  }
  lines.push('');

  // Tone of Voice
  const tone = summary.sections.toneOfVoice;
  lines.push(`## ${tone.title}`);
  lines.push('');
  if (tone.content.length > 0) {
    for (const item of tone.content) {
      lines.push(`- ${item}`);
    }
    if (tone.topicSources.length > 0) {
      lines.push('');
      lines.push(`*Sources: ${tone.topicSources.join(', ')}*`);
    }
  } else {
    lines.push('*No verified insights in this category yet.*');
  }
  lines.push('');

  // Key Themes
  const themes = summary.sections.keyThemes;
  lines.push(`## ${themes.title}`);
  lines.push('');
  if (themes.content.length > 0) {
    for (const item of themes.content) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('*No themes identified yet.*');
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('*This profile was generated by [me.md](https://memd.app) — your personal knowledge system for AI.*');
  lines.push('');

  return lines.join('\n');
}

// GET /api/profile/summary - Get auto-generated profile summary from verified insights
profileRouter.get('/summary', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get user profile
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get all verified insights with exportable privacy tier, joined with topic titles
    // Excludes insights marked as 'never_export' so profile summary respects privacy settings
    const verifiedInsights = db.select({
      content: insights.content,
      topicTitle: topics.title,
      confidenceScore: insights.confidenceScore,
      privacyTier: insights.privacyTier,
    }).from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(
        and(
          eq(insights.userId, userId),
          eq(insights.verificationStatus, 'verified'),
          eq(insights.privacyTier, 'exportable')
        )
      )
      .orderBy(desc(insights.confidenceScore))
      .all();

    // Count topics explored
    const userTopics = db.select().from(topics).where(eq(topics.userId, userId)).all();
    const topicCount = userTopics.length;

    const summary = buildProfileSummary(user, verifiedInsights, topicCount);

    res.json({ summary });
  } catch (error) {
    console.error('Get profile summary error:', error);
    res.status(500).json({ error: 'Failed to generate profile summary' });
  }
});

// POST /api/profile/regenerate - Force regenerate profile summary
profileRouter.post('/regenerate', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.body.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get user profile
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get all verified exportable insights joined with topics
    // Respects privacy tier settings - excludes 'never_export' insights
    const verifiedInsights = db.select({
      content: insights.content,
      topicTitle: topics.title,
      confidenceScore: insights.confidenceScore,
      privacyTier: insights.privacyTier,
    }).from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(
        and(
          eq(insights.userId, userId),
          eq(insights.verificationStatus, 'verified'),
          eq(insights.privacyTier, 'exportable')
        )
      )
      .orderBy(desc(insights.confidenceScore))
      .all();

    const userTopics = db.select().from(topics).where(eq(topics.userId, userId)).all();

    const summary = buildProfileSummary(user, verifiedInsights, userTopics.length);

    res.json({ summary, message: 'Profile summary regenerated successfully' });
  } catch (error) {
    console.error('Regenerate profile error:', error);
    res.status(500).json({ error: 'Failed to regenerate profile summary' });
  }
});

// GET /api/profile/export/markdown - Export profile as me.md markdown file
profileRouter.get('/export/markdown', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get only exportable verified insights (exclude never_export)
    const verifiedInsights = db.select({
      content: insights.content,
      topicTitle: topics.title,
      confidenceScore: insights.confidenceScore,
      privacyTier: insights.privacyTier,
    }).from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(
        and(
          eq(insights.userId, userId),
          eq(insights.verificationStatus, 'verified'),
          eq(insights.privacyTier, 'exportable')
        )
      )
      .orderBy(desc(insights.confidenceScore))
      .all();

    const userTopics = db.select().from(topics).where(eq(topics.userId, userId)).all();

    const summary = buildProfileSummary(user, verifiedInsights, userTopics.length);
    const markdown = generateMarkdown(summary);

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${user.name.replace(/[^a-zA-Z0-9]/g, '_')}_me.md"`);
    res.send(markdown);
  } catch (error) {
    console.error('Export markdown error:', error);
    res.status(500).json({ error: 'Failed to export profile as markdown' });
  }
});

// GET /api/profile/export/json - Export profile as JSON
profileRouter.get('/export/json', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get only exportable verified insights
    const verifiedInsights = db.select({
      content: insights.content,
      topicTitle: topics.title,
      confidenceScore: insights.confidenceScore,
      privacyTier: insights.privacyTier,
    }).from(insights)
      .leftJoin(topics, eq(insights.topicId, topics.id))
      .where(
        and(
          eq(insights.userId, userId),
          eq(insights.verificationStatus, 'verified'),
          eq(insights.privacyTier, 'exportable')
        )
      )
      .orderBy(desc(insights.confidenceScore))
      .all();

    const userTopics = db.select().from(topics).where(eq(topics.userId, userId)).all();

    const summary = buildProfileSummary(user, verifiedInsights, userTopics.length);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${user.name.replace(/[^a-zA-Z0-9]/g, '_')}_profile.json"`);
    res.json({ profile: summary });
  } catch (error) {
    console.error('Export JSON error:', error);
    res.status(500).json({ error: 'Failed to export profile as JSON' });
  }
});
