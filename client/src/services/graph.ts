import { eq, and, inArray, not, desc } from 'drizzle-orm'
import { scheduleSave } from '@/db/persistence'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import {
  topics, insights, topicConnections, conceptNodes, conceptEdges,
  sessions, assessmentAttempts, assessmentResults,
} from '@/db/schema'

type Db = any // Drizzle sql.js instance

const ALL_CATEGORIES = ['identity', 'skills', 'experiences', 'perspectives', 'goals']
const CATEGORY_LABELS: Record<string, string> = {
  identity: 'Identity',
  skills: 'Skills',
  experiences: 'Experiences',
  perspectives: 'Perspectives',
  goals: 'Goals',
}
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  identity: 'Explore your core values, beliefs, personality traits, and what makes you who you are',
  skills: 'Discover and document your abilities, expertise, and areas of competence',
  experiences: 'Reflect on significant life events, milestones, and formative experiences',
  perspectives: 'Examine your worldviews, opinions, and how you see different aspects of life',
  goals: 'Clarify your aspirations, objectives, and what you want to achieve',
}

const DOMAIN_LABELS: Record<string, string> = {
  O: 'Openness to Experience',
  C: 'Conscientiousness',
  E: 'Extraversion',
  A: 'Agreeableness',
  N: 'Neuroticism',
}
const DOMAIN_SHORT: Record<string, string> = {
  O: 'Openness',
  C: 'Conscientiousness',
  E: 'Extraversion',
  A: 'Agreeableness',
  N: 'Neuroticism',
}
const FACET_LABELS: Record<string, string[]> = {
  O: ['Imagination', 'Artistic Interests', 'Emotionality', 'Adventurousness', 'Intellect', 'Liberalism'],
  C: ['Self-Efficacy', 'Orderliness', 'Dutifulness', 'Achievement-Striving', 'Self-Discipline', 'Cautiousness'],
  E: ['Friendliness', 'Gregariousness', 'Assertiveness', 'Activity Level', 'Excitement-Seeking', 'Cheerfulness'],
  A: ['Trust', 'Morality', 'Altruism', 'Cooperation', 'Modesty', 'Sympathy'],
  N: ['Anxiety', 'Anger', 'Depression', 'Self-Consciousness', 'Immoderation', 'Vulnerability'],
}

/**
 * Get full knowledge graph data for D3 visualization.
 * Returns nodes and edges with topic, concept, gap, and personality data.
 */
export function getGraphData(db: Db) {
  const userId = LOCAL_USER_ID

  // 1. Get all user topics
  const userTopics = db.select().from(topics)
    .where(eq(topics.userId, userId))
    .all()

  // 2. Get all non-rejected insights
  const userInsights = db.select().from(insights)
    .where(
      and(
        eq(insights.userId, userId),
        not(eq(insights.verificationStatus, 'rejected'))
      )
    )
    .all()

  // 3. Get all sessions
  const userSessions = db.select().from(sessions)
    .where(eq(sessions.userId, userId))
    .all()

  // 4. Get concept nodes (filter out those linked to rejected insights)
  const rejectedInsightIds = new Set(
    db.select({ id: insights.id }).from(insights)
      .where(and(eq(insights.userId, userId), eq(insights.verificationStatus, 'rejected')))
      .all()
      .map((i: any) => i.id)
  )
  const allUserConceptNodes = db.select().from(conceptNodes)
    .where(eq(conceptNodes.userId, userId))
    .all()
  const userConceptNodes = allUserConceptNodes.filter(
    (cn: any) => !cn.insightId || !rejectedInsightIds.has(cn.insightId)
  )

  // 5. Get concept edges
  const conceptNodeIds = userConceptNodes.map((cn: any) => cn.id)
  let userConceptEdges: any[] = []
  if (conceptNodeIds.length > 0) {
    const conceptNodeIdSet = new Set(conceptNodeIds)
    const candidateEdges = db.select().from(conceptEdges)
      .where(inArray(conceptEdges.sourceNodeId, conceptNodeIds))
      .all()
    userConceptEdges = candidateEdges.filter(
      (e: any) => conceptNodeIdSet.has(e.targetNodeId)
    )
  }

  // 6. Get explicit topic connections
  const topicIds = userTopics.map((t: any) => t.id)
  let userTopicConnections: any[] = []
  if (topicIds.length > 0) {
    const topicIdSet = new Set(topicIds)
    const candidateConnections = db.select().from(topicConnections)
      .where(inArray(topicConnections.sourceTopicId, topicIds))
      .all()
    userTopicConnections = candidateConnections.filter(
      (c: any) => topicIdSet.has(c.targetTopicId)
    )
  }

  // Build graph data structure
  const graphNodes: any[] = []
  const graphEdges: any[] = []

  // Build topic insight/session counts for sizing
  const insightsByTopic: Record<string, any[]> = {}
  const verifiedInsightsByTopic: Record<string, number> = {}
  for (const insight of userInsights) {
    if (!insightsByTopic[insight.topicId]) {
      insightsByTopic[insight.topicId] = []
    }
    insightsByTopic[insight.topicId].push(insight)
    if (insight.verificationStatus === 'verified') {
      verifiedInsightsByTopic[insight.topicId] = (verifiedInsightsByTopic[insight.topicId] || 0) + 1
    }
  }

  const sessionsByTopic: Record<string, number> = {}
  for (const session of userSessions) {
    sessionsByTopic[session.topicId] = (sessionsByTopic[session.topicId] || 0) + 1
  }

  // Create topic-level nodes
  for (const topic of userTopics) {
    const topicInsights = insightsByTopic[topic.id] || []
    const verifiedCount = verifiedInsightsByTopic[topic.id] || 0
    const sessionCount = sessionsByTopic[topic.id] || 0
    const weight = 1 + (sessionCount * 0.5) + (verifiedCount * 0.3)

    let parsedTags: string[] = []
    try {
      if (topic.tags) parsedTags = JSON.parse(topic.tags)
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
    })
  }

  // Build insight verification status lookup
  const insightStatusMap: Record<string, string> = {}
  for (const insight of userInsights) {
    insightStatusMap[insight.id] = insight.verificationStatus
  }

  // Create placeholder nodes for unexplored categories (gap visualization)
  const exploredCategories = new Set<string>()
  for (const topic of userTopics) {
    if (topic.presetCategory) {
      exploredCategories.add(topic.presetCategory)
    }
  }

  for (const category of ALL_CATEGORIES) {
    if (!exploredCategories.has(category)) {
      graphNodes.push({
        id: `gap-${category}`,
        entityId: category,
        type: 'gap',
        label: CATEGORY_LABELS[category],
        description: CATEGORY_DESCRIPTIONS[category],
        status: 'unexplored',
        category,
        tags: [],
        weight: 0.5,
        insightCount: 0,
        verifiedInsightCount: 0,
        sessionCount: 0,
        isUnexplored: true,
      })
    }
  }

  // Create concept-level sub-nodes
  for (const cn of userConceptNodes) {
    const insightVerificationStatus = cn.insightId ? (insightStatusMap[cn.insightId] || 'unverified') : 'unverified'
    graphNodes.push({
      id: `concept-${cn.id}`,
      entityId: cn.id,
      type: 'concept',
      label: cn.label,
      parentTopicId: `topic-${cn.topicId}`,
      weight: cn.weight || 1.0,
      insightId: cn.insightId,
      verificationStatus: insightVerificationStatus,
      lastUpdated: cn.updatedAt,
    })

    graphEdges.push({
      id: `topic-concept-${cn.topicId}-${cn.id}`,
      source: `topic-${cn.topicId}`,
      target: `concept-${cn.id}`,
      type: 'contains',
      weight: 0.5,
    })
  }

  // Create edges from explicit topic connections
  for (const conn of userTopicConnections) {
    graphEdges.push({
      id: `tc-${conn.id}`,
      source: `topic-${conn.sourceTopicId}`,
      target: `topic-${conn.targetTopicId}`,
      type: conn.connectionType || 'related',
      weight: (conn.relevanceScore || 50) / 100,
    })
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
    })
  }

  // Personality (Big Five) domain & facet nodes
  const latestCompletedAttempt = db.select()
    .from(assessmentAttempts)
    .where(and(
      eq(assessmentAttempts.userId, userId),
      eq(assessmentAttempts.status, 'completed'),
    ))
    .orderBy(desc(assessmentAttempts.completedAt))
    .limit(1)
    .get()

  let personalityNodeCount = 0

  if (latestCompletedAttempt) {
    const domainResults = db.select()
      .from(assessmentResults)
      .where(eq(assessmentResults.attemptId, latestCompletedAttempt.id))
      .all()

    if (domainResults.length > 0) {
      const assessmentTopic = userTopics.find((t: any) => t.title === 'Big Five Personality Assessment')
      const assessmentTopicNodeId = assessmentTopic ? `topic-${assessmentTopic.id}` : null

      for (const dr of domainResults) {
        const domainNodeId = `personality-domain-${dr.domain}`
        const domainLabel = DOMAIN_SHORT[dr.domain] || dr.domain
        const score = dr.domainScore
        const scoreLevel = score >= 4 ? 'High' : score >= 3.5 ? 'Above Average' : score >= 2.5 ? 'Average' : score >= 2 ? 'Below Average' : 'Low'

        graphNodes.push({
          id: domainNodeId,
          entityId: dr.domain,
          type: 'personality_domain',
          label: domainLabel,
          description: `${DOMAIN_LABELS[dr.domain] || dr.domain}: ${score.toFixed(1)}/5 (${scoreLevel})`,
          weight: 1.5 + (score / 5),
          domainScore: score,
          scoreLevel,
          domainKey: dr.domain,
          completedAt: latestCompletedAttempt.completedAt,
        })
        personalityNodeCount++

        if (assessmentTopicNodeId) {
          graphEdges.push({
            id: `personality-topic-${dr.domain}`,
            source: assessmentTopicNodeId,
            target: domainNodeId,
            type: 'personality_contains',
            weight: 0.6,
          })
        }

        // Create facet sub-nodes
        const facetLabels = FACET_LABELS[dr.domain] || []
        const facetScores = [
          dr.facet1Score, dr.facet2Score, dr.facet3Score,
          dr.facet4Score, dr.facet5Score, dr.facet6Score,
        ]

        for (let fi = 0; fi < facetScores.length; fi++) {
          const facetScore = facetScores[fi]
          if (facetScore === null || facetScore === undefined) continue

          const facetNodeId = `personality-facet-${dr.domain}-${fi + 1}`
          const facetLabel = facetLabels[fi] || `Facet ${fi + 1}`
          const facetLevel = facetScore >= 4 ? 'High' : facetScore >= 3 ? 'Moderate-High' : facetScore >= 2.5 ? 'Average' : 'Low'

          graphNodes.push({
            id: facetNodeId,
            entityId: `${dr.domain}-facet-${fi + 1}`,
            type: 'personality_facet',
            label: facetLabel,
            description: `${facetLabel}: ${facetScore.toFixed(1)}/5 (${facetLevel})`,
            parentDomainId: domainNodeId,
            weight: 0.8 + (facetScore / 5) * 0.5,
            facetScore,
            scoreLevel: facetLevel,
            domainKey: dr.domain,
          })
          personalityNodeCount++

          graphEdges.push({
            id: `personality-df-${dr.domain}-${fi + 1}`,
            source: domainNodeId,
            target: facetNodeId,
            type: 'personality_contains',
            weight: 0.4,
          })
        }
      }

      // Cross-link personality nodes with relevant existing topic nodes
      if (assessmentTopic) {
        const personalityCategoryKeywords: Record<string, string[]> = {
          O: ['creative', 'imagination', 'artistic', 'curious', 'adventurous', 'intellectual', 'open'],
          C: ['organized', 'discipline', 'goal', 'achievement', 'planning', 'efficient', 'reliable'],
          E: ['social', 'communication', 'leadership', 'energy', 'outgoing', 'enthusiastic', 'assertive'],
          A: ['empathy', 'trust', 'cooperation', 'helping', 'altruism', 'compassion', 'kind'],
          N: ['stress', 'anxiety', 'emotional', 'worry', 'mood', 'coping', 'resilience'],
        }

        for (const topic of userTopics) {
          if (topic.id === assessmentTopic.id) continue

          let parsedTags: string[] = []
          try {
            if (topic.tags) parsedTags = JSON.parse(topic.tags)
          } catch { /* ignore */ }

          const topicText = `${topic.title} ${topic.description || ''} ${parsedTags.join(' ')}`.toLowerCase()

          for (const [domainKey, keywords] of Object.entries(personalityCategoryKeywords)) {
            const matchCount = keywords.filter(kw => topicText.includes(kw)).length
            if (matchCount >= 2) {
              graphEdges.push({
                id: `personality-cross-${domainKey}-${topic.id}`,
                source: `personality-domain-${domainKey}`,
                target: `topic-${topic.id}`,
                type: 'personality_related',
                weight: 0.3 + (matchCount * 0.1),
                relationship: `Related to ${DOMAIN_SHORT[domainKey]}`,
              })
            }
          }
        }
      }
    }
  }

  // Generate edges from shared tags between topics
  const tagToTopics: Record<string, string[]> = {}
  for (const node of graphNodes) {
    if (node.type === 'topic' && node.tags && node.tags.length > 0) {
      for (const tag of node.tags) {
        const normalizedTag = tag.toLowerCase().trim()
        if (!tagToTopics[normalizedTag]) tagToTopics[normalizedTag] = []
        tagToTopics[normalizedTag].push(node.id)
      }
    }
  }

  const tagEdgeSet = new Set<string>()
  for (const [tag, topicNodeIds] of Object.entries(tagToTopics)) {
    if (topicNodeIds.length < 2) continue
    for (let i = 0; i < topicNodeIds.length; i++) {
      for (let j = i + 1; j < topicNodeIds.length; j++) {
        const edgeKey = `${topicNodeIds[i]}-${topicNodeIds[j]}`
        if (!tagEdgeSet.has(edgeKey)) {
          tagEdgeSet.add(edgeKey)
          graphEdges.push({
            id: `tag-${edgeKey}`,
            source: topicNodeIds[i],
            target: topicNodeIds[j],
            type: 'tag_shared',
            tag,
            weight: 0.3,
          })
        }
      }
    }
  }

  // Generate edges from topics that share insights from same session (multi-bucket)
  const sessionToTopics: Record<string, Set<string>> = {}
  for (const insight of userInsights) {
    if (insight.sourceSessionId) {
      if (!sessionToTopics[insight.sourceSessionId]) {
        sessionToTopics[insight.sourceSessionId] = new Set()
      }
      sessionToTopics[insight.sourceSessionId].add(insight.topicId)
    }
  }

  const multiBucketEdgeSet = new Set<string>()
  for (const [, topicIdSet] of Object.entries(sessionToTopics)) {
    const tids = Array.from(topicIdSet)
    if (tids.length < 2) continue
    for (let i = 0; i < tids.length; i++) {
      for (let j = i + 1; j < tids.length; j++) {
        const src = `topic-${tids[i]}`
        const tgt = `topic-${tids[j]}`
        const edgeKey = `${src}-${tgt}`
        if (!multiBucketEdgeSet.has(edgeKey) && !tagEdgeSet.has(edgeKey)) {
          multiBucketEdgeSet.add(edgeKey)
          graphEdges.push({
            id: `mb-${edgeKey}`,
            source: src,
            target: tgt,
            type: 'multi_bucket',
            weight: 0.4,
          })
        }
      }
    }
  }

  const unexploredCount = ALL_CATEGORIES.length - exploredCategories.size

  return {
    nodes: graphNodes,
    edges: graphEdges,
    stats: {
      topicCount: userTopics.length,
      conceptCount: userConceptNodes.length,
      personalityNodeCount,
      edgeCount: graphEdges.length,
      insightCount: userInsights.length,
      verifiedInsightCount: Object.values(verifiedInsightsByTopic).reduce((a, b) => a + b, 0),
      unexploredCategories: unexploredCount,
      exploredCategories: exploredCategories.size,
      totalCategories: ALL_CATEGORIES.length,
    },
  }
}

/**
 * Get sub-graph for a specific topic.
 */
export function getTopicGraph(db: Db, topicId: string) {
  const userId = LOCAL_USER_ID

  const topic = db.select().from(topics).where(
    and(eq(topics.id, topicId), eq(topics.userId, userId))
  ).get()

  if (!topic) {
    throw new Error('Topic not found')
  }

  // Get concept nodes (exclude those linked to rejected insights)
  const topicRejectedInsightIds = new Set(
    db.select({ id: insights.id }).from(insights)
      .where(and(eq(insights.topicId, topicId), eq(insights.userId, userId), eq(insights.verificationStatus, 'rejected')))
      .all()
      .map((i: any) => i.id)
  )
  const allTopicConceptNodes = db.select().from(conceptNodes)
    .where(and(eq(conceptNodes.topicId, topicId), eq(conceptNodes.userId, userId)))
    .all()
  const topicConceptNodes = allTopicConceptNodes.filter(
    (cn: any) => !cn.insightId || !topicRejectedInsightIds.has(cn.insightId)
  )

  // Get non-rejected insights
  const topicInsights = db.select().from(insights)
    .where(and(
      eq(insights.topicId, topicId),
      eq(insights.userId, userId),
      not(eq(insights.verificationStatus, 'rejected'))
    ))
    .all()

  // Get concept edges
  const nodeIds = topicConceptNodes.map((n: any) => n.id)
  let topicConceptEdges: any[] = []
  if (nodeIds.length > 0) {
    const allEdges = db.select().from(conceptEdges).all()
    topicConceptEdges = allEdges.filter(
      (e: any) => nodeIds.includes(e.sourceNodeId) && nodeIds.includes(e.targetNodeId)
    )
  }

  return {
    topic,
    conceptNodes: topicConceptNodes,
    conceptEdges: topicConceptEdges,
    insights: topicInsights,
  }
}

/**
 * Create a concept node.
 */
export function createConceptNode(
  db: Db,
  data: { topicId: string; insightId?: string; label: string; weight?: number }
) {
  const userId = LOCAL_USER_ID

  if (!data.topicId || !data.label) {
    throw new Error('topicId and label are required')
  }

  // Verify topic belongs to user
  const topic = db.select().from(topics).where(
    and(eq(topics.id, data.topicId), eq(topics.userId, userId))
  ).get()

  if (!topic) {
    throw new Error('Topic not found')
  }

  // Verify insight belongs to user if provided
  if (data.insightId) {
    const insight = db.select().from(insights).where(
      and(eq(insights.id, data.insightId), eq(insights.userId, userId))
    ).get()

    if (!insight) {
      throw new Error('Insight not found')
    }
  }

  const node = db.insert(conceptNodes).values({
    id: crypto.randomUUID(),
    userId,
    topicId: data.topicId,
    insightId: data.insightId || null,
    label: data.label,
    weight: data.weight || 1.0,
  }).returning().get()

  scheduleSave()

  return { conceptNode: node }
}

/**
 * Create a concept edge between two concept nodes.
 */
export function createConceptEdge(
  db: Db,
  data: { sourceNodeId: string; targetNodeId: string; relationship?: string; weight?: number }
) {
  const userId = LOCAL_USER_ID

  if (!data.sourceNodeId || !data.targetNodeId) {
    throw new Error('sourceNodeId and targetNodeId are required')
  }

  // Verify both nodes belong to user
  const sourceNode = db.select().from(conceptNodes).where(
    and(eq(conceptNodes.id, data.sourceNodeId), eq(conceptNodes.userId, userId))
  ).get()

  const targetNode = db.select().from(conceptNodes).where(
    and(eq(conceptNodes.id, data.targetNodeId), eq(conceptNodes.userId, userId))
  ).get()

  if (!sourceNode || !targetNode) {
    throw new Error('One or both concept nodes not found')
  }

  const edge = db.insert(conceptEdges).values({
    id: crypto.randomUUID(),
    sourceNodeId: data.sourceNodeId,
    targetNodeId: data.targetNodeId,
    relationship: data.relationship || 'related',
    weight: data.weight || 1.0,
  }).returning().get()

  scheduleSave()

  return { conceptEdge: edge }
}
