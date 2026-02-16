import { Router } from 'express';
import { db, sqlite } from '../config/database.js';
import { mcpAccessPermissions, insights, topics, users, notes, assessmentAttempts, assessmentResults } from '../models/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export const mcpRouter = Router();

// ============================================
// MCP Access Permissions Management
// ============================================

// GET /api/mcp/permissions - List all MCP access permissions for a user
mcpRouter.get('/permissions', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const permissions = db.select()
      .from(mcpAccessPermissions)
      .where(eq(mcpAccessPermissions.userId, userId))
      .orderBy(desc(mcpAccessPermissions.createdAt))
      .all();

    res.json({ permissions });
  } catch (error) {
    console.error('Get MCP permissions error:', error);
    res.status(500).json({ error: 'Failed to fetch MCP permissions' });
  }
});

// POST /api/mcp/permissions - Add a new MCP agent connection
mcpRouter.post('/permissions', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { agentName } = req.body;

    if (!agentName || typeof agentName !== 'string' || !agentName.trim()) {
      return res.status(400).json({ error: 'Agent name is required' });
    }

    // Check if agent already exists for this user
    const existing = db.select()
      .from(mcpAccessPermissions)
      .where(
        and(
          eq(mcpAccessPermissions.userId, userId),
          eq(mcpAccessPermissions.agentName, agentName.trim())
        )
      )
      .get();

    if (existing) {
      return res.status(409).json({ error: 'Agent connection already exists' });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    db.insert(mcpAccessPermissions).values({
      id,
      userId,
      agentName: agentName.trim(),
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    }).run();

    const permission = db.select()
      .from(mcpAccessPermissions)
      .where(eq(mcpAccessPermissions.id, id))
      .get();

    res.status(201).json({ permission });
  } catch (error) {
    console.error('Create MCP permission error:', error);
    res.status(500).json({ error: 'Failed to create MCP permission' });
  }
});

// PUT /api/mcp/permissions/:id - Update a permission (enable/disable)
mcpRouter.put('/permissions/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const { isEnabled } = req.body;

    if (typeof isEnabled !== 'boolean') {
      return res.status(400).json({ error: 'isEnabled must be a boolean' });
    }

    // Verify permission belongs to user
    const existing = db.select()
      .from(mcpAccessPermissions)
      .where(
        and(
          eq(mcpAccessPermissions.id, id),
          eq(mcpAccessPermissions.userId, userId)
        )
      )
      .get();

    if (!existing) {
      return res.status(404).json({ error: 'Permission not found' });
    }

    const now = new Date().toISOString();

    db.update(mcpAccessPermissions)
      .set({ isEnabled, updatedAt: now })
      .where(eq(mcpAccessPermissions.id, id))
      .run();

    const updated = db.select()
      .from(mcpAccessPermissions)
      .where(eq(mcpAccessPermissions.id, id))
      .get();

    res.json({ permission: updated });
  } catch (error) {
    console.error('Update MCP permission error:', error);
    res.status(500).json({ error: 'Failed to update MCP permission' });
  }
});

// DELETE /api/mcp/permissions/:id - Revoke/delete an MCP agent connection
mcpRouter.delete('/permissions/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;

    // Verify permission belongs to user
    const existing = db.select()
      .from(mcpAccessPermissions)
      .where(
        and(
          eq(mcpAccessPermissions.id, id),
          eq(mcpAccessPermissions.userId, userId)
        )
      )
      .get();

    if (!existing) {
      return res.status(404).json({ error: 'Permission not found' });
    }

    db.delete(mcpAccessPermissions)
      .where(eq(mcpAccessPermissions.id, id))
      .run();

    res.json({ message: 'Permission revoked successfully', deletedId: id });
  } catch (error) {
    console.error('Delete MCP permission error:', error);
    res.status(500).json({ error: 'Failed to delete MCP permission' });
  }
});


// ============================================
// MCP Resource Endpoints
// These serve the same data that the MCP protocol resources serve,
// accessible via REST for testing and internal use.
// ============================================

/**
 * Helper: Check if an agent has MCP access to a user's data
 */
function checkAgentAccess(userId: string, agentName?: string): boolean {
  if (!agentName) return true; // Direct user access (no agent specified) is always allowed

  const permission = db.select()
    .from(mcpAccessPermissions)
    .where(
      and(
        eq(mcpAccessPermissions.userId, userId),
        eq(mcpAccessPermissions.agentName, agentName)
      )
    )
    .get();

  if (!permission) return false; // No permission record = no access
  return permission.isEnabled === true;
}

// ============================================
// Big Five Personality Constants
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

const DOMAIN_Q_COUNT = 24;
const FACET_Q_COUNT = 4;

// GET /api/mcp/resources/profile - user://profile resource
// Serves verified profile context as structured data
mcpRouter.get('/resources/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const agentName = req.headers['x-agent-name'] as string || req.query.agentName as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check agent access if agent name is provided
    if (agentName && !checkAgentAccess(userId, agentName)) {
      return res.status(403).json({ error: 'Agent does not have MCP access' });
    }

    // Get user profile
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get only verified, exportable insights
    const verifiedInsights = db.select({
      id: insights.id,
      content: insights.content,
      topicId: insights.topicId,
      topicTitle: topics.title,
      confidenceScore: insights.confidenceScore,
      verifiedAt: insights.verifiedAt,
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

    // Get topics explored
    const userTopics = db.select({
      id: topics.id,
      title: topics.title,
      status: topics.status,
      tags: topics.tags,
    }).from(topics)
      .where(eq(topics.userId, userId))
      .all();

    // Get personality assessment data
    const completedAttempts = db.select()
      .from(assessmentAttempts)
      .where(
        and(
          eq(assessmentAttempts.userId, userId),
          eq(assessmentAttempts.status, 'completed')
        )
      )
      .orderBy(desc(assessmentAttempts.completedAt))
      .limit(1)
      .all();

    let personalitySection: any = null;
    if (completedAttempts.length > 0) {
      const latestResults = db.select()
        .from(assessmentResults)
        .where(eq(assessmentResults.attemptId, completedAttempts[0].id))
        .all();

      if (latestResults.length > 0) {
        const domainScores = latestResults.map(r => {
          const normalized = normalizeTo5(r.domainScore, DOMAIN_Q_COUNT);
          return {
            domain: r.domain,
            domainLabel: BIG_FIVE_DOMAIN_LABELS[r.domain] || r.domain,
            score: normalized,
            level: getScoreLevel(normalized),
          };
        });

        // Get verified personality insights
        const assessmentTopic = db.select()
          .from(topics)
          .where(and(eq(topics.userId, userId), eq(topics.title, 'Big Five Personality Assessment')))
          .get();

        let personalityInsights: Array<{ content: string; confidence: number | null }> = [];
        if (assessmentTopic) {
          personalityInsights = db.select({ content: insights.content, confidence: insights.confidenceScore })
            .from(insights)
            .where(and(
              eq(insights.topicId, assessmentTopic.id),
              eq(insights.userId, userId),
              eq(insights.verificationStatus, 'verified'),
              eq(insights.privacyTier, 'exportable')
            ))
            .orderBy(desc(insights.confidenceScore))
            .all();
        }

        personalitySection = {
          latestAssessment: {
            attemptId: completedAttempts[0].id,
            completedAt: completedAttempts[0].completedAt,
          },
          domainScores,
          verifiedInsights: personalityInsights.map(i => ({
            content: i.content,
            confidence: i.confidence ?? 50,
          })),
        };
      }
    }

    // Categorize insights into profile sections
    const profileContext = {
      uri: 'user://profile',
      resourceType: 'profile',
      userName: user.name,
      email: user.email,
      occupation: user.occupation,
      location: user.location,
      generatedAt: new Date().toISOString(),
      totalVerifiedInsights: verifiedInsights.length,
      topicsExplored: userTopics.length,
      insights: verifiedInsights.map(i => ({
        id: i.id,
        content: i.content,
        topicTitle: i.topicTitle,
        confidenceScore: i.confidenceScore,
        verifiedAt: i.verifiedAt,
      })),
      topics: userTopics.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        tags: t.tags ? JSON.parse(t.tags as string) : [],
      })),
      personality: personalitySection,
    };

    // Update last accessed time for the agent
    if (agentName) {
      const now = new Date().toISOString();
      db.update(mcpAccessPermissions)
        .set({ lastAccessedAt: now, updatedAt: now })
        .where(
          and(
            eq(mcpAccessPermissions.userId, userId),
            eq(mcpAccessPermissions.agentName, agentName)
          )
        )
        .run();
    }

    res.json(profileContext);
  } catch (error) {
    console.error('MCP profile resource error:', error);
    res.status(500).json({ error: 'Failed to serve profile context' });
  }
});

// GET /api/mcp/resources/knowledge/:topicId - user://knowledge/{topic} resource
// Serves topic-level knowledge and insights
mcpRouter.get('/resources/knowledge/:topicId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const agentName = req.headers['x-agent-name'] as string || req.query.agentName as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check agent access
    if (agentName && !checkAgentAccess(userId, agentName)) {
      return res.status(403).json({ error: 'Agent does not have MCP access' });
    }

    const { topicId } = req.params;

    // Get topic (verify it belongs to user)
    const topic = db.select()
      .from(topics)
      .where(
        and(
          eq(topics.id, topicId),
          eq(topics.userId, userId)
        )
      )
      .get();

    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    // Get only verified, exportable insights for this topic
    const topicInsights = db.select({
      id: insights.id,
      content: insights.content,
      confidenceScore: insights.confidenceScore,
      verifiedAt: insights.verifiedAt,
      privacyTier: insights.privacyTier,
      verificationStatus: insights.verificationStatus,
    }).from(insights)
      .where(
        and(
          eq(insights.topicId, topicId),
          eq(insights.userId, userId),
          eq(insights.verificationStatus, 'verified'),
          eq(insights.privacyTier, 'exportable')
        )
      )
      .orderBy(desc(insights.confidenceScore))
      .all();

    // Get notes for this topic
    const topicNotes = db.select({
      id: notes.id,
      title: notes.title,
      selectedFormat: notes.selectedFormat,
      createdAt: notes.createdAt,
    }).from(notes)
      .where(
        and(
          eq(notes.topicId, topicId),
          eq(notes.userId, userId)
        )
      )
      .orderBy(desc(notes.createdAt))
      .all();

    const knowledgeContext = {
      uri: `user://knowledge/${topicId}`,
      resourceType: 'knowledge',
      topic: {
        id: topic.id,
        title: topic.title,
        description: topic.description,
        status: topic.status,
        tags: topic.tags ? JSON.parse(topic.tags as string) : [],
        intent: topic.intent,
      },
      verifiedInsights: topicInsights.map(i => ({
        id: i.id,
        content: i.content,
        confidenceScore: i.confidenceScore,
        verifiedAt: i.verifiedAt,
      })),
      notes: topicNotes.map(n => ({
        id: n.id,
        title: n.title,
        format: n.selectedFormat,
        createdAt: n.createdAt,
      })),
      generatedAt: new Date().toISOString(),
    };

    // Update last accessed time for the agent
    if (agentName) {
      const now = new Date().toISOString();
      db.update(mcpAccessPermissions)
        .set({ lastAccessedAt: now, updatedAt: now })
        .where(
          and(
            eq(mcpAccessPermissions.userId, userId),
            eq(mcpAccessPermissions.agentName, agentName)
          )
        )
        .run();
    }

    res.json(knowledgeContext);
  } catch (error) {
    console.error('MCP knowledge resource error:', error);
    res.status(500).json({ error: 'Failed to serve topic knowledge' });
  }
});

// GET /api/mcp/tools/search - search_knowledge tool
// Semantic search across verified insights
mcpRouter.get('/tools/search', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const agentName = req.headers['x-agent-name'] as string || req.query.agentName as string;
    const query = req.query.q as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (agentName && !checkAgentAccess(userId, agentName)) {
      return res.status(403).json({ error: 'Agent does not have MCP access' });
    }

    if (!query) {
      return res.status(400).json({ error: 'Search query (q) is required' });
    }

    // Search across verified, exportable insights
    const searchPattern = `%${query}%`;

    const results = sqlite.prepare(`
      SELECT
        i.id, i.content, i.confidence_score as confidenceScore,
        i.verified_at as verifiedAt,
        t.title as topicTitle, t.id as topicId
      FROM insights i
      LEFT JOIN topics t ON i.topic_id = t.id
      WHERE i.user_id = ?
        AND i.verification_status = 'verified'
        AND i.privacy_tier = 'exportable'
        AND i.content LIKE ?
      ORDER BY i.confidence_score DESC
      LIMIT 50
    `).all(userId, searchPattern) as Array<{
      id: string;
      content: string;
      confidenceScore: number;
      verifiedAt: string;
      topicTitle: string;
      topicId: string;
    }>;

    res.json({
      tool: 'search_knowledge',
      query,
      results: results.map(r => ({
        id: r.id,
        content: r.content,
        confidenceScore: r.confidenceScore,
        verifiedAt: r.verifiedAt,
        topicTitle: r.topicTitle,
        topicId: r.topicId,
      })),
      totalResults: results.length,
    });
  } catch (error) {
    console.error('MCP search tool error:', error);
    res.status(500).json({ error: 'Failed to search knowledge' });
  }
});

// GET /api/mcp/tools/context-summary - get_context_summary tool
// Returns portable me.md context as markdown
mcpRouter.get('/tools/context-summary', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const agentName = req.headers['x-agent-name'] as string || req.query.agentName as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (agentName && !checkAgentAccess(userId, agentName)) {
      return res.status(403).json({ error: 'Agent does not have MCP access' });
    }

    // Get user
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get verified exportable insights with topic context
    const verifiedInsights = db.select({
      content: insights.content,
      topicTitle: topics.title,
      confidenceScore: insights.confidenceScore,
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

    // Group insights by topic
    const insightsByTopic: Record<string, string[]> = {};
    for (const insight of verifiedInsights) {
      const topicName = insight.topicTitle || 'General';
      if (!insightsByTopic[topicName]) {
        insightsByTopic[topicName] = [];
      }
      insightsByTopic[topicName].push(insight.content);
    }

    // Generate markdown summary
    const lines: string[] = [];
    lines.push(`# ${user.name}'s Personal Context`);
    lines.push('');
    lines.push(`> ${user.occupation} based in ${user.location}`);
    lines.push(`> ${verifiedInsights.length} verified insights`);
    lines.push('');

    for (const [topic, topicInsights] of Object.entries(insightsByTopic)) {
      lines.push(`## ${topic}`);
      lines.push('');
      for (const insight of topicInsights) {
        lines.push(`- ${insight}`);
      }
      lines.push('');
    }

    // Include personality assessment data in context summary
    const completedAttempts = db.select()
      .from(assessmentAttempts)
      .where(
        and(
          eq(assessmentAttempts.userId, userId),
          eq(assessmentAttempts.status, 'completed')
        )
      )
      .orderBy(desc(assessmentAttempts.completedAt))
      .limit(1)
      .all();

    let hasPersonalityData = false;
    if (completedAttempts.length > 0) {
      const latestResults = db.select()
        .from(assessmentResults)
        .where(eq(assessmentResults.attemptId, completedAttempts[0].id))
        .all();

      if (latestResults.length > 0) {
        hasPersonalityData = true;
        lines.push('## Personality Profile (Big Five)');
        lines.push('');
        for (const r of latestResults) {
          const domainLabel = BIG_FIVE_DOMAIN_LABELS[r.domain] || r.domain;
          const normalized = normalizeTo5(r.domainScore, DOMAIN_Q_COUNT);
          const level = getScoreLevel(normalized);
          lines.push(`- **${domainLabel}**: ${normalized.toFixed(2)}/5 (${level})`);
        }
        lines.push('');

        // Include verified personality insights
        const assessmentTopic = db.select()
          .from(topics)
          .where(
            and(
              eq(topics.userId, userId),
              eq(topics.title, 'Big Five Personality Assessment')
            )
          )
          .get();

        if (assessmentTopic) {
          const personalityInsights = db.select({ content: insights.content })
            .from(insights)
            .where(
              and(
                eq(insights.topicId, assessmentTopic.id),
                eq(insights.userId, userId),
                eq(insights.verificationStatus, 'verified'),
                eq(insights.privacyTier, 'exportable')
              )
            )
            .orderBy(desc(insights.confidenceScore))
            .all();

          if (personalityInsights.length > 0) {
            lines.push('### Verified Personality Insights');
            lines.push('');
            for (const pi of personalityInsights) {
              lines.push(`- ${pi.content}`);
            }
            lines.push('');
          }
        }
      }
    }

    lines.push('---');
    lines.push('*Generated by me.md*');

    const markdown = lines.join('\n');

    res.json({
      tool: 'get_context_summary',
      format: 'markdown',
      content: markdown,
      totalInsights: verifiedInsights.length,
      topics: Object.keys(insightsByTopic),
      hasPersonalityData,
    });
  } catch (error) {
    console.error('MCP context summary tool error:', error);
    res.status(500).json({ error: 'Failed to generate context summary' });
  }
});

// GET /api/mcp/resources/personality - user://personality resource
// Serves Big Five personality assessment data (respecting privacy tiers)
mcpRouter.get('/resources/personality', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const agentName = req.headers['x-agent-name'] as string || req.query.agentName as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check agent access
    if (agentName && !checkAgentAccess(userId, agentName)) {
      return res.status(403).json({ error: 'Agent does not have MCP access' });
    }

    // Get user
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get all completed attempts
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
      return res.json({
        uri: 'user://personality',
        resourceType: 'personality',
        userName: user.name,
        hasAssessment: false,
        message: 'No completed personality assessment found',
        generatedAt: new Date().toISOString(),
      });
    }

    const latestAttempt = completedAttempts[0];

    // Get latest results
    const latestResults = db.select()
      .from(assessmentResults)
      .where(eq(assessmentResults.attemptId, latestAttempt.id))
      .all();

    const domainScores = latestResults.map(r => {
      const facetLabels = BIG_FIVE_FACET_LABELS[r.domain] || [];
      const facetScoreValues = [r.facet1Score, r.facet2Score, r.facet3Score, r.facet4Score, r.facet5Score, r.facet6Score];
      const facets: Array<{ name: string; score: number; level: string }> = [];

      for (let i = 0; i < facetScoreValues.length; i++) {
        const fScore = facetScoreValues[i];
        if (fScore !== null && fScore !== undefined) {
          const normalizedFacet = normalizeTo5(fScore, FACET_Q_COUNT);
          facets.push({
            name: facetLabels[i] || `Facet ${i + 1}`,
            score: normalizedFacet,
            level: getScoreLevel(normalizedFacet),
          });
        }
      }

      const normalizedDomain = normalizeTo5(r.domainScore, DOMAIN_Q_COUNT);
      return {
        domain: r.domain,
        domainLabel: BIG_FIVE_DOMAIN_LABELS[r.domain] || r.domain,
        score: normalizedDomain,
        level: getScoreLevel(normalizedDomain),
        facets,
      };
    });

    // Get verified exportable personality insights
    const assessmentTopic = db.select()
      .from(topics)
      .where(
        and(
          eq(topics.userId, userId),
          eq(topics.title, 'Big Five Personality Assessment')
        )
      )
      .get();

    let verifiedInsights: Array<{ content: string; confidence: number | null }> = [];
    if (assessmentTopic) {
      verifiedInsights = db.select({
        content: insights.content,
        confidence: insights.confidenceScore,
      })
        .from(insights)
        .where(
          and(
            eq(insights.topicId, assessmentTopic.id),
            eq(insights.userId, userId),
            eq(insights.verificationStatus, 'verified'),
            eq(insights.privacyTier, 'exportable')
          )
        )
        .orderBy(desc(insights.confidenceScore))
        .all();
    }

    // Build change trends
    const changeTrends = completedAttempts.length > 1 ? completedAttempts.map(attempt => {
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
          score: normalizeTo5(r.domainScore, DOMAIN_Q_COUNT),
        })),
      };
    }) : [];

    // Update last accessed time for the agent
    if (agentName) {
      const now = new Date().toISOString();
      db.update(mcpAccessPermissions)
        .set({ lastAccessedAt: now, updatedAt: now })
        .where(
          and(
            eq(mcpAccessPermissions.userId, userId),
            eq(mcpAccessPermissions.agentName, agentName)
          )
        )
        .run();
    }

    res.json({
      uri: 'user://personality',
      resourceType: 'personality',
      userName: user.name,
      hasAssessment: true,
      latestAssessment: {
        attemptId: latestAttempt.id,
        completedAt: latestAttempt.completedAt,
      },
      domainScores,
      verifiedInsights: verifiedInsights.map(i => ({
        content: i.content,
        confidence: i.confidence ?? 50,
      })),
      changeTrends,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('MCP personality resource error:', error);
    res.status(500).json({ error: 'Failed to serve personality data' });
  }
});
