import { Router } from 'express';
import { db } from '../config/database.js';
import { insights, topics, users, notes, sessions, messages, topicConnections, importedFiles, assessmentAttempts, assessmentResults } from '../models/schema.js';
import { count } from 'drizzle-orm';
import { eq, and, desc } from 'drizzle-orm';

export const profileRouter = Router();

// ============================================
// Big Five Personality Constants & Helpers
// ============================================
const BIG_FIVE_DOMAIN_LABELS: Record<string, string> = {
  N: 'Neuroticism',
  E: 'Extraversion',
  O: 'Openness to Experience',
  A: 'Agreeableness',
  C: 'Conscientiousness',
};

const BIG_FIVE_FACET_LABELS: Record<string, string[]> = {
  N: ['Anxiety', 'Anger', 'Depression', 'Self-Consciousness', 'Immoderation', 'Vulnerability'],
  E: ['Friendliness', 'Gregariousness', 'Assertiveness', 'Activity Level', 'Excitement-Seeking', 'Cheerfulness'],
  O: ['Imagination', 'Artistic Interests', 'Emotionality', 'Adventurousness', 'Intellect', 'Liberalism'],
  A: ['Trust', 'Morality', 'Altruism', 'Cooperation', 'Modesty', 'Sympathy'],
  C: ['Self-Efficacy', 'Orderliness', 'Dutifulness', 'Achievement-Striving', 'Self-Discipline', 'Cautiousness'],
};

/**
 * Normalize a raw score to 0-5 scale.
 * Domain scores from the bigfive-calculate-score package are raw sums (24-120 for domains, 4-20 for facets).
 * We normalize to 0-5 for readable export.
 */
function normalizeTo5(rawScore: number, questionCount: number): number {
  if (questionCount <= 0) return rawScore;
  return Math.round((rawScore / questionCount) * 100) / 100;
}

function getScoreLevel(normalizedScore: number): string {
  if (normalizedScore >= 4) return 'High';
  if (normalizedScore >= 3.5) return 'Above Average';
  if (normalizedScore >= 2.5) return 'Average';
  if (normalizedScore >= 2) return 'Below Average';
  return 'Low';
}

interface PersonalityExportData {
  hasAssessment: boolean;
  latestAttempt: {
    attemptId: string;
    completedAt: string | null;
  } | null;
  domainScores: Array<{
    domain: string;
    domainLabel: string;
    score: number;
    level: string;
    facets: Array<{
      name: string;
      score: number;
      level: string;
    }>;
  }>;
  verifiedInsights: Array<{
    content: string;
    confidence: number;
    category: string;
  }>;
  changeTrends: Array<{
    attemptId: string;
    completedAt: string | null;
    domainScores: Array<{
      domain: string;
      domainLabel: string;
      score: number;
    }>;
  }>;
  privacyTier: string;
}

/**
 * Fetch Big Five personality data for export, respecting privacy tiers.
 * Returns assessment scores, verified personality insights, and change trends.
 */
function getPersonalityExportData(userId: string, privacyFilter: 'exportable' | 'all' = 'exportable'): PersonalityExportData {
  // Get all completed attempts (for change trends)
  const completedAttempts = db.select()
    .from(assessmentAttempts)
    .where(
      and(
        eq(assessmentAttempts.userId, userId),
        eq(assessmentAttempts.status, 'completed')
      )
    )
    .orderBy(desc(assessmentAttempts.completedAt))
    .all();

  if (completedAttempts.length === 0) {
    return {
      hasAssessment: false,
      latestAttempt: null,
      domainScores: [],
      verifiedInsights: [],
      changeTrends: [],
      privacyTier: privacyFilter,
    };
  }

  const latestAttempt = completedAttempts[0];

  // Get latest domain + facet scores
  const latestResults = db.select()
    .from(assessmentResults)
    .where(eq(assessmentResults.attemptId, latestAttempt.id))
    .all();

  // Domain scores: 24 questions per domain (score range 24-120), normalize to 0-5
  // Facet scores: 4 questions per facet (score range 4-20), normalize to 0-5
  const DOMAIN_QUESTION_COUNT = 24;
  const FACET_QUESTION_COUNT = 4;

  const domainScores = latestResults.map(r => {
    const facetLabels = BIG_FIVE_FACET_LABELS[r.domain] || [];
    const facets: Array<{ name: string; score: number; level: string }> = [];
    const facetScoreValues = [r.facet1Score, r.facet2Score, r.facet3Score, r.facet4Score, r.facet5Score, r.facet6Score];

    for (let i = 0; i < facetScoreValues.length; i++) {
      const fScore = facetScoreValues[i];
      if (fScore !== null && fScore !== undefined) {
        const normalizedFacet = normalizeTo5(fScore, FACET_QUESTION_COUNT);
        facets.push({
          name: facetLabels[i] || `Facet ${i + 1}`,
          score: normalizedFacet,
          level: getScoreLevel(normalizedFacet),
        });
      }
    }

    const normalizedDomain = normalizeTo5(r.domainScore, DOMAIN_QUESTION_COUNT);
    return {
      domain: r.domain,
      domainLabel: BIG_FIVE_DOMAIN_LABELS[r.domain] || r.domain,
      score: normalizedDomain,
      level: getScoreLevel(normalizedDomain),
      facets,
    };
  });

  // Get verified personality insights (from the Big Five assessment topic)
  // These are stored as regular insights linked to the "Big Five Personality Assessment" topic
  const assessmentTopic = db.select()
    .from(topics)
    .where(
      and(
        eq(topics.userId, userId),
        eq(topics.title, 'Big Five Personality Assessment')
      )
    )
    .get();

  let verifiedInsights: Array<{ content: string; confidence: number; category: string }> = [];

  if (assessmentTopic) {
    const insightFilter = privacyFilter === 'exportable'
      ? and(
          eq(insights.topicId, assessmentTopic.id),
          eq(insights.userId, userId),
          eq(insights.verificationStatus, 'verified'),
          eq(insights.privacyTier, 'exportable')
        )
      : and(
          eq(insights.topicId, assessmentTopic.id),
          eq(insights.userId, userId),
          eq(insights.verificationStatus, 'verified')
        );

    const rawInsights = db.select({
      content: insights.content,
      confidenceScore: insights.confidenceScore,
    })
      .from(insights)
      .where(insightFilter)
      .orderBy(desc(insights.confidenceScore))
      .all();

    verifiedInsights = rawInsights.map(i => ({
      content: i.content,
      confidence: i.confidenceScore ?? 50,
      category: 'personality',
    }));
  }

  // Build change trends from all completed attempts
  const changeTrends = completedAttempts.map(attempt => {
    const results = db.select()
      .from(assessmentResults)
      .where(eq(assessmentResults.attemptId, attempt.id))
      .all();

    return {
      attemptId: attempt.id,
      completedAt: attempt.completedAt,
      domainScores: results.map(r => ({
        domain: r.domain,
        domainLabel: BIG_FIVE_DOMAIN_LABELS[r.domain] || r.domain,
        score: normalizeTo5(r.domainScore, DOMAIN_QUESTION_COUNT),
      })),
    };
  });

  return {
    hasAssessment: true,
    latestAttempt: {
      attemptId: latestAttempt.id,
      completedAt: latestAttempt.completedAt,
    },
    domainScores,
    verifiedInsights,
    changeTrends: changeTrends.length > 1 ? changeTrends : [],
    privacyTier: privacyFilter,
  };
}

/**
 * Generate markdown for the personality section of the me.md export.
 */
function generatePersonalityMarkdown(data: PersonalityExportData): string {
  if (!data.hasAssessment) return '';

  const lines: string[] = [];
  lines.push('## Personality Profile (Big Five)');
  lines.push('');
  lines.push('*Based on the IPIP NEO-PI-R 120-item assessment*');
  if (data.latestAttempt?.completedAt) {
    lines.push(`*Latest assessment: ${new Date(data.latestAttempt.completedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}*`);
  }
  lines.push('');

  // Domain scores overview
  for (const domain of data.domainScores) {
    lines.push(`### ${domain.domainLabel}`);
    lines.push(`**Score: ${domain.score.toFixed(2)}/5 (${domain.level})**`);
    lines.push('');

    if (domain.facets.length > 0) {
      lines.push('| Facet | Score | Level |');
      lines.push('|-------|-------|-------|');
      for (const facet of domain.facets) {
        lines.push(`| ${facet.name} | ${facet.score.toFixed(2)} | ${facet.level} |`);
      }
      lines.push('');
    }
  }

  // Verified AI-generated personality insights
  if (data.verifiedInsights.length > 0) {
    lines.push('### Verified Personality Insights');
    lines.push('');
    for (const insight of data.verifiedInsights) {
      lines.push(`- ${insight.content} *(confidence: ${insight.confidence}%)*`);
    }
    lines.push('');
  }

  // Change trends
  if (data.changeTrends.length > 1) {
    lines.push('### Personality Change Trends');
    lines.push('');
    lines.push('| Date | ' + Object.keys(BIG_FIVE_DOMAIN_LABELS).map(d => BIG_FIVE_DOMAIN_LABELS[d]).join(' | ') + ' |');
    lines.push('|------|' + Object.keys(BIG_FIVE_DOMAIN_LABELS).map(() => '---').join('|') + '|');

    for (const trend of data.changeTrends) {
      const date = trend.completedAt
        ? new Date(trend.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Unknown';
      const scoreMap: Record<string, number> = {};
      for (const ds of trend.domainScores) {
        scoreMap[ds.domain] = ds.score;
      }
      const scores = Object.keys(BIG_FIVE_DOMAIN_LABELS).map(d => (scoreMap[d] ?? 0).toFixed(2));
      lines.push(`| ${date} | ${scores.join(' | ')} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

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

// Safely parse JSON fields that may be double-encoded (string containing JSON string)
function safeParseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    let parsed = JSON.parse(value);
    // Handle double-encoded: if result is still a string, parse again
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

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

// GET /api/profile/export/status - Check if there is verified exportable data available
profileRouter.get('/export/status', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Count verified exportable insights
    const verifiedInsights = db.select({
      content: insights.content,
    }).from(insights)
      .where(
        and(
          eq(insights.userId, userId),
          eq(insights.verificationStatus, 'verified'),
          eq(insights.privacyTier, 'exportable')
        )
      )
      .all();

    const topicCount = db.select().from(topics).where(eq(topics.userId, userId)).all().length;

    res.json({
      hasVerifiedData: verifiedInsights.length > 0,
      verifiedInsightCount: verifiedInsights.length,
      topicCount,
    });
  } catch (error) {
    console.error('Export status check error:', error);
    res.status(500).json({ error: 'Failed to check export status' });
  }
});

// GET /api/profile/summary - Get auto-generated profile summary from verified insights
profileRouter.get('/summary', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

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
    const userId = req.headers['x-user-id'] as string;

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
    const userId = req.headers['x-user-id'] as string;

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

    // Get imported sources for markdown appendix
    const userImports = db.select({
      filename: importedFiles.filename,
      fileType: importedFiles.fileType,
      processedContent: importedFiles.processedContent,
      createdAt: importedFiles.createdAt,
    }).from(importedFiles)
      .where(eq(importedFiles.userId, userId))
      .all();

    const importSourcesList = userImports.map(imp => {
      let content: Record<string, unknown> = {};
      try {
        if (imp.processedContent) content = JSON.parse(imp.processedContent);
      } catch { content = {}; }
      return {
        title: (content.title as string) || imp.filename,
        type: imp.fileType,
        isProcessed: content.processingStatus === 'processed',
        insightCount: (content.processedInsightCount as number) || 0,
      };
    });

    let markdown = generateMarkdown(summary);

    // Append personality profile section if assessment data exists
    const personalityData = getPersonalityExportData(userId, 'exportable');
    if (personalityData.hasAssessment) {
      markdown += '\n' + generatePersonalityMarkdown(personalityData);
    }

    // Append imported sources section if any exist
    if (importSourcesList.length > 0) {
      markdown += '\n## Imported Sources\n\n';
      markdown += '*The following external sources were imported and processed to extract insights:*\n\n';
      for (const source of importSourcesList) {
        const typeLabel = source.type === 'chatgpt' ? 'ChatGPT Memory' : source.type === 'url' ? 'URL' : source.type === 'text' ? 'Text' : 'File';
        const processedLabel = source.isProcessed ? ` (${source.insightCount} insights extracted)` : ' (not yet processed)';
        markdown += `- **${source.title}** — ${typeLabel}${processedLabel}\n`;
      }
      markdown += '\n';
    }

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
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get only exportable verified insights with full metadata for round-trip
    const verifiedInsightsForSummary = db.select({
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

    // Get all verified exportable insights with FULL metadata for round-trip re-import
    const verifiedInsightsFull = db.select({
      id: insights.id,
      content: insights.content,
      confidenceScore: insights.confidenceScore,
      verificationStatus: insights.verificationStatus,
      agreementScore: insights.agreementScore,
      privacyTier: insights.privacyTier,
      topicId: insights.topicId,
      noteId: insights.noteId,
      sourceSessionId: insights.sourceSessionId,
      verifiedAt: insights.verifiedAt,
      reVerifyAt: insights.reVerifyAt,
      reVerifyInterval: insights.reVerifyInterval,
      createdAt: insights.createdAt,
      updatedAt: insights.updatedAt,
      topicTitle: topics.title,
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

    // Get all user topics with full details
    const userTopics = db.select().from(topics).where(eq(topics.userId, userId)).all();

    // Parse JSON fields in topics for export (handles double-encoded strings)
    const topicsWithParsedFields = userTopics.map(t => ({
      ...t,
      tags: safeParseJsonArray(t.tags),
      referenceUrls: safeParseJsonArray(t.referenceUrls),
      contextItems: safeParseJsonArray(t.contextItems),
    }));

    // Get topic connections/relationships for this user's topics
    const topicIds = userTopics.map(t => t.id);
    let connections: Array<typeof topicConnections.$inferSelect> = [];
    if (topicIds.length > 0) {
      // Get all connections where either source or target is one of the user's topics
      const allConnections = db.select().from(topicConnections).all();
      connections = allConnections.filter(c =>
        topicIds.includes(c.sourceTopicId) || topicIds.includes(c.targetTopicId)
      );
    }

    const summary = buildProfileSummary(user, verifiedInsightsForSummary, userTopics.length);

    // Get all user notes (distilled session summaries)
    const userNotes = db.select({
      id: notes.id,
      sessionId: notes.sessionId,
      topicId: notes.topicId,
      title: notes.title,
      contentFullAnalysis: notes.contentFullAnalysis,
      contentBriefSummary: notes.contentBriefSummary,
      contentDecisionFramework: notes.contentDecisionFramework,
      contentJson: notes.contentJson,
      selectedFormat: notes.selectedFormat,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
      topicTitle: topics.title,
    }).from(notes)
      .leftJoin(topics, eq(notes.topicId, topics.id))
      .where(eq(notes.userId, userId))
      .orderBy(desc(notes.createdAt))
      .all();

    // Parse contentJson for notes (handles double-encoded strings)
    const notesForExport = userNotes.map(n => {
      let parsedContentJson: unknown = null;
      if (n.contentJson) {
        try {
          let parsed = JSON.parse(n.contentJson);
          if (typeof parsed === 'string') parsed = JSON.parse(parsed);
          parsedContentJson = parsed;
        } catch {
          parsedContentJson = null;
        }
      }
      return {
        id: n.id,
        sessionId: n.sessionId,
        topicId: n.topicId,
        topicTitle: n.topicTitle,
        title: n.title,
        contentFullAnalysis: n.contentFullAnalysis,
        contentBriefSummary: n.contentBriefSummary,
        contentDecisionFramework: n.contentDecisionFramework,
        contentJson: parsedContentJson,
        selectedFormat: n.selectedFormat,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      };
    });

    // Get all user sessions with metadata (title from topic, message count)
    const userSessions = db.select({
      id: sessions.id,
      topicId: sessions.topicId,
      status: sessions.status,
      isMiniSession: sessions.isMiniSession,
      suggestedDurationMinutes: sessions.suggestedDurationMinutes,
      timeSpentSeconds: sessions.timeSpentSeconds,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      completedAt: sessions.completedAt,
      topicTitle: topics.title,
    }).from(sessions)
      .leftJoin(topics, eq(sessions.topicId, topics.id))
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .all();

    // Get message counts per session
    const sessionMessageCounts: Record<string, number> = {};
    if (userSessions.length > 0) {
      const allMsgCounts = db.select({
        sessionId: messages.sessionId,
        msgCount: count(),
      }).from(messages)
        .groupBy(messages.sessionId)
        .all();

      for (const row of allMsgCounts) {
        sessionMessageCounts[row.sessionId] = row.msgCount;
      }
    }

    const sessionsForExport = userSessions.map(s => ({
      id: s.id,
      topicId: s.topicId,
      topicTitle: s.topicTitle,
      status: s.status,
      isMiniSession: s.isMiniSession,
      suggestedDurationMinutes: s.suggestedDurationMinutes,
      timeSpentSeconds: s.timeSpentSeconds,
      messageCount: sessionMessageCounts[s.id] || 0,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      completedAt: s.completedAt,
    }));

    // Get imported source materials for reference
    const userImports = db.select({
      id: importedFiles.id,
      filename: importedFiles.filename,
      fileType: importedFiles.fileType,
      createdAt: importedFiles.createdAt,
      processedContent: importedFiles.processedContent,
    }).from(importedFiles)
      .where(eq(importedFiles.userId, userId))
      .all();

    const importSources = userImports.map(imp => {
      let content: Record<string, unknown> = {};
      try {
        if (imp.processedContent) content = JSON.parse(imp.processedContent);
      } catch { content = {}; }
      return {
        id: imp.id,
        filename: imp.filename,
        fileType: imp.fileType,
        title: (content.title as string) || imp.filename,
        summary: (content.summary as string) || null,
        isProcessed: content.processingStatus === 'processed',
        processedInsightCount: (content.processedInsightCount as number) || 0,
        importedAt: imp.createdAt,
      };
    });

    // Fetch personality assessment data for JSON export
    const personalityExport = getPersonalityExportData(userId, 'exportable');

    const exportData = {
      exportVersion: '1.2',
      exportedAt: new Date().toISOString(),
      source: 'me.md',
      profile: summary,
      personality: personalityExport.hasAssessment ? {
        latestAssessment: personalityExport.latestAttempt,
        domainScores: personalityExport.domainScores,
        verifiedInsights: personalityExport.verifiedInsights,
        changeTrends: personalityExport.changeTrends,
        privacyTier: personalityExport.privacyTier,
      } : null,
      rawData: {
        insights: verifiedInsightsFull,
        topics: topicsWithParsedFields,
        topicConnections: connections,
        notes: notesForExport,
        sessions: sessionsForExport,
        importedSources: importSources,
      },
      metadata: {
        totalVerifiedInsights: verifiedInsightsFull.length,
        totalTopics: userTopics.length,
        totalTopicConnections: connections.length,
        totalNotes: notesForExport.length,
        totalSessions: sessionsForExport.length,
        completedSessions: sessionsForExport.filter(s => s.status === 'completed').length,
        totalImportedSources: importSources.length,
        processedImports: importSources.filter(s => s.isProcessed).length,
        hasPersonalityAssessment: personalityExport.hasAssessment,
        personalityInsightCount: personalityExport.verifiedInsights.length,
        assessmentCount: personalityExport.changeTrends.length || (personalityExport.hasAssessment ? 1 : 0),
      },
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${user.name.replace(/[^a-zA-Z0-9]/g, '_')}_profile.json"`);
    res.json(exportData);
  } catch (error) {
    console.error('Export JSON error:', error);
    res.status(500).json({ error: 'Failed to export profile as JSON' });
  }
});
