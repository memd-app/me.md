import { Router } from 'express';
import { db } from '../config/database.js';
import { topics, insights, topicConnections, conceptNodes, conceptEdges, sessions } from '../models/schema.js';
import { eq, and, or, inArray } from 'drizzle-orm';

export const graphRouter = Router();

// GET /api/graph - Get full knowledge graph data for a user
graphRouter.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // 1. Get all user topics
    const userTopics = db.select().from(topics)
      .where(eq(topics.userId, userId))
      .all();

    // 2. Get all insights grouped by topic (for sizing nodes)
    const userInsights = db.select().from(insights)
      .where(eq(insights.userId, userId))
      .all();

    // 3. Get all sessions (for counting depth per topic)
    const userSessions = db.select().from(sessions)
      .where(eq(sessions.userId, userId))
      .all();

    // 4. Get concept nodes for this user
    const userConceptNodes = db.select().from(conceptNodes)
      .where(eq(conceptNodes.userId, userId))
      .all();

    // 5. Get concept edges that connect user's concept nodes (optimized with SQL filter)
    const conceptNodeIds = userConceptNodes.map(cn => cn.id);
    let userConceptEdges: any[] = [];
    if (conceptNodeIds.length > 0) {
      const conceptNodeIdSet = new Set(conceptNodeIds);
      const candidateEdges = db.select().from(conceptEdges)
        .where(inArray(conceptEdges.sourceNodeId, conceptNodeIds))
        .all();
      userConceptEdges = candidateEdges.filter(
        e => conceptNodeIdSet.has(e.targetNodeId)
      );
    }

    // 6. Get explicit topic connections (optimized with SQL filter)
    const topicIds = userTopics.map(t => t.id);
    let userTopicConnections: any[] = [];
    if (topicIds.length > 0) {
      const topicIdSet = new Set(topicIds);
      const candidateConnections = db.select().from(topicConnections)
        .where(inArray(topicConnections.sourceTopicId, topicIds))
        .all();
      userTopicConnections = candidateConnections.filter(
        c => topicIdSet.has(c.targetTopicId)
      );
    }

    // Build graph data structure
    // Nodes: topic-level nodes + concept-level sub-nodes
    const graphNodes: any[] = [];
    const graphEdges: any[] = [];

    // Build topic insight/session counts for sizing
    const insightsByTopic: Record<string, any[]> = {};
    const verifiedInsightsByTopic: Record<string, number> = {};
    for (const insight of userInsights) {
      if (!insightsByTopic[insight.topicId]) {
        insightsByTopic[insight.topicId] = [];
      }
      insightsByTopic[insight.topicId].push(insight);
      if (insight.verificationStatus === 'verified') {
        verifiedInsightsByTopic[insight.topicId] = (verifiedInsightsByTopic[insight.topicId] || 0) + 1;
      }
    }

    const sessionsByTopic: Record<string, number> = {};
    for (const session of userSessions) {
      sessionsByTopic[session.topicId] = (sessionsByTopic[session.topicId] || 0) + 1;
    }

    // Create topic-level nodes
    for (const topic of userTopics) {
      const topicInsights = insightsByTopic[topic.id] || [];
      const verifiedCount = verifiedInsightsByTopic[topic.id] || 0;
      const sessionCount = sessionsByTopic[topic.id] || 0;
      // Weight based on number of sessions and verified insights
      const weight = 1 + (sessionCount * 0.5) + (verifiedCount * 0.3);

      let parsedTags: string[] = [];
      try {
        if (topic.tags) parsedTags = JSON.parse(topic.tags);
      } catch { /* ignore */ }

      graphNodes.push({
        id: `topic-${topic.id}`,
        entityId: topic.id,
        type: 'topic',
        label: topic.title,
        description: topic.description || '',
        status: topic.status,
        category: topic.presetCategory || null,
        tags: parsedTags,
        weight,
        insightCount: topicInsights.length,
        verifiedInsightCount: verifiedCount,
        sessionCount,
        lastUpdated: topic.updatedAt,
      });
    }

    // Create concept-level sub-nodes
    for (const cn of userConceptNodes) {
      graphNodes.push({
        id: `concept-${cn.id}`,
        entityId: cn.id,
        type: 'concept',
        label: cn.label,
        parentTopicId: `topic-${cn.topicId}`,
        weight: cn.weight || 1.0,
        insightId: cn.insightId,
        lastUpdated: cn.updatedAt,
      });

      // Edge from topic to its concept node
      graphEdges.push({
        id: `topic-concept-${cn.topicId}-${cn.id}`,
        source: `topic-${cn.topicId}`,
        target: `concept-${cn.id}`,
        type: 'contains',
        weight: 0.5,
      });
    }

    // Create edges from explicit topic connections
    for (const conn of userTopicConnections) {
      graphEdges.push({
        id: `tc-${conn.id}`,
        source: `topic-${conn.sourceTopicId}`,
        target: `topic-${conn.targetTopicId}`,
        type: conn.connectionType || 'related',
        weight: (conn.relevanceScore || 50) / 100,
      });
    }

    // Create edges from concept edges
    for (const ce of userConceptEdges) {
      graphEdges.push({
        id: `ce-${ce.id}`,
        source: `concept-${ce.sourceNodeId}`,
        target: `concept-${ce.targetNodeId}`,
        type: 'concept_relation',
        relationship: ce.relationship,
        weight: ce.weight || 1.0,
      });
    }

    // Generate edges from shared tags between topics
    const tagToTopics: Record<string, string[]> = {};
    for (const node of graphNodes) {
      if (node.type === 'topic' && node.tags && node.tags.length > 0) {
        for (const tag of node.tags) {
          const normalizedTag = tag.toLowerCase().trim();
          if (!tagToTopics[normalizedTag]) tagToTopics[normalizedTag] = [];
          tagToTopics[normalizedTag].push(node.id);
        }
      }
    }

    // Create tag-shared edges (avoid duplicate pairs)
    const tagEdgeSet = new Set<string>();
    for (const [tag, topicNodeIds] of Object.entries(tagToTopics)) {
      if (topicNodeIds.length < 2) continue;
      for (let i = 0; i < topicNodeIds.length; i++) {
        for (let j = i + 1; j < topicNodeIds.length; j++) {
          const edgeKey = `${topicNodeIds[i]}-${topicNodeIds[j]}`;
          if (!tagEdgeSet.has(edgeKey)) {
            tagEdgeSet.add(edgeKey);
            graphEdges.push({
              id: `tag-${edgeKey}`,
              source: topicNodeIds[i],
              target: topicNodeIds[j],
              type: 'tag_shared',
              tag,
              weight: 0.3,
            });
          }
        }
      }
    }

    // Generate edges from topics that share insights from same session
    // (cross-topic connections via multi-bucket)
    const sessionToTopics: Record<string, Set<string>> = {};
    for (const insight of userInsights) {
      if (insight.sourceSessionId) {
        if (!sessionToTopics[insight.sourceSessionId]) {
          sessionToTopics[insight.sourceSessionId] = new Set();
        }
        sessionToTopics[insight.sourceSessionId].add(insight.topicId);
      }
    }

    const multiBucketEdgeSet = new Set<string>();
    for (const [, topicIdSet] of Object.entries(sessionToTopics)) {
      const tids = Array.from(topicIdSet);
      if (tids.length < 2) continue;
      for (let i = 0; i < tids.length; i++) {
        for (let j = i + 1; j < tids.length; j++) {
          const src = `topic-${tids[i]}`;
          const tgt = `topic-${tids[j]}`;
          const edgeKey = `${src}-${tgt}`;
          if (!multiBucketEdgeSet.has(edgeKey) && !tagEdgeSet.has(edgeKey)) {
            multiBucketEdgeSet.add(edgeKey);
            graphEdges.push({
              id: `mb-${edgeKey}`,
              source: src,
              target: tgt,
              type: 'multi_bucket',
              weight: 0.4,
            });
          }
        }
      }
    }

    res.json({
      nodes: graphNodes,
      edges: graphEdges,
      stats: {
        topicCount: userTopics.length,
        conceptCount: userConceptNodes.length,
        edgeCount: graphEdges.length,
        insightCount: userInsights.length,
        verifiedInsightCount: Object.values(verifiedInsightsByTopic).reduce((a, b) => a + b, 0),
      },
    });
  } catch (error) {
    console.error('Get graph error:', error);
    res.status(500).json({ error: 'Failed to get graph data' });
  }
});

// GET /api/graph/topic/:id - Get sub-graph for a specific topic
graphRouter.get('/topic/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;
    const topicId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Verify topic belongs to user
    const topic = db.select().from(topics).where(
      and(eq(topics.id, topicId), eq(topics.userId, userId))
    ).get();

    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    // Get concept nodes for this topic
    const topicConceptNodes = db.select().from(conceptNodes)
      .where(and(eq(conceptNodes.topicId, topicId), eq(conceptNodes.userId, userId)))
      .all();

    // Get insights for this topic
    const topicInsights = db.select().from(insights)
      .where(and(eq(insights.topicId, topicId), eq(insights.userId, userId)))
      .all();

    // Get concept edges
    const nodeIds = topicConceptNodes.map(n => n.id);
    let topicConceptEdges: any[] = [];
    if (nodeIds.length > 0) {
      const allEdges = db.select().from(conceptEdges).all();
      topicConceptEdges = allEdges.filter(
        e => nodeIds.includes(e.sourceNodeId) && nodeIds.includes(e.targetNodeId)
      );
    }

    res.json({
      topic,
      conceptNodes: topicConceptNodes,
      conceptEdges: topicConceptEdges,
      insights: topicInsights,
    });
  } catch (error) {
    console.error('Get topic graph error:', error);
    res.status(500).json({ error: 'Failed to get topic graph data' });
  }
});
