import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { eq, and, desc, ne, or } from 'drizzle-orm'
import {
  sessions, messages, topics, users, insights,
  topicConnections,
} from '../db/schema'
import { scheduleSave } from '../db/persistence'
import { LOCAL_USER_ID } from '../contexts/UserContext'
import {
  isAIAvailable,
  streamClaudeResponse,
  generateClaudeQuickReplies,
} from './ai'
import { cleanText } from './textCleaning'
import type {
  AIResponseOptions,
  ProfileContext,
  InterviewMap,
  InterviewMapAngle,
} from './ai'

// ============================================
// Types
// ============================================

// Re-export for convenience
export type { ProfileContext, InterviewMap, InterviewMapAngle }

type Db = SQLJsDatabase<Record<string, unknown>>

// ============================================
// Default Interview Map
// ============================================

const DEFAULT_INTERVIEW_MAP_ANGLES: InterviewMapAngle[] = [
  {
    id: 'journey',
    label: 'Journey',
    description: 'Personal story and evolution over time',
    questionFocus: 'how you got here, pivotal moments, and how your relationship with this topic has evolved',
    explored: false,
  },
  {
    id: 'principles',
    label: 'Principles',
    description: 'Core beliefs, values, and guiding rules',
    questionFocus: 'what you believe to be true, your non-negotiables, and the rules you live by regarding this topic',
    explored: false,
  },
  {
    id: 'frameworks',
    label: 'Frameworks',
    description: 'Mental models and decision-making approaches',
    questionFocus: 'how you think about and structure your approach, the mental models you use, and your decision-making process',
    explored: false,
  },
  {
    id: 'examples',
    label: 'Examples',
    description: 'Concrete stories, cases, and lived experiences',
    questionFocus: 'specific situations, real stories, and concrete examples that illustrate your perspective',
    explored: false,
  },
  {
    id: 'tensions',
    label: 'Tensions',
    description: 'Contradictions, trade-offs, and unresolved questions',
    questionFocus: 'where you feel conflicted, what trade-offs you navigate, and what questions remain unresolved',
    explored: false,
  },
]

function createDefaultInterviewMap(): InterviewMap {
  return {
    type: 'default',
    angles: DEFAULT_INTERVIEW_MAP_ANGLES.map(a => ({ ...a })),
    currentAngleIndex: 0,
    breadthFirstComplete: false,
  }
}

function getCurrentInterviewAngle(interviewMap: InterviewMap, userMessageCount: number): InterviewMapAngle {
  const angleIndex = userMessageCount % interviewMap.angles.length
  return interviewMap.angles[angleIndex]
}

// ============================================
// Helper Functions
// ============================================

function parseJsonArray(jsonStr: string | null): string[] {
  if (!jsonStr) return []
  try {
    const parsed = JSON.parse(jsonStr)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function buildContextSummary(referenceUrls: string[], contextItems: string[]): string {
  const parts: string[] = []
  if (referenceUrls.length > 0) {
    parts.push(`${referenceUrls.length} reference URL(s) provided: ${referenceUrls.join(', ')}`)
  }
  if (contextItems.length > 0) {
    parts.push(`${contextItems.length} context item(s) provided`)
  }
  return parts.join('; ')
}

// ============================================
// Profile Context Gathering
// ============================================

function gatherProfileContext(db: Db, currentTopicId: string): ProfileContext {
  const user = (db as any).select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()

  const allVerifiedInsights = (db as any).select({
    content: insights.content,
    topicId: insights.topicId,
    confidenceScore: insights.confidenceScore,
  }).from(insights).where(
    and(
      eq(insights.userId, LOCAL_USER_ID),
      eq(insights.verificationStatus, 'verified')
    )
  ).all()

  const topicIds = [...new Set(allVerifiedInsights.map((i: any) => i.topicId))]
  const topicMap = new Map<string, string>()
  if (topicIds.length > 0) {
    const topicRows = (db as any).select({ id: topics.id, title: topics.title })
      .from(topics)
      .where(eq(topics.userId, LOCAL_USER_ID))
      .all()
    for (const t of topicRows) {
      topicMap.set(t.id, t.title)
    }
  }

  const verifiedInsights = allVerifiedInsights.map((i: any) => ({
    content: i.content,
    topicTitle: topicMap.get(i.topicId) || 'Unknown Topic',
    confidenceScore: i.confidenceScore || 50,
  }))

  const completedSessions = (db as any).select({
    topicId: sessions.topicId,
  }).from(sessions).where(
    and(
      eq(sessions.userId, LOCAL_USER_ID),
      eq(sessions.status, 'completed')
    )
  ).all()

  const sessionCountByTopic = new Map<string, number>()
  for (const s of completedSessions) {
    sessionCountByTopic.set(s.topicId, (sessionCountByTopic.get(s.topicId) || 0) + 1)
  }

  const allUserTopics = (db as any).select({ id: topics.id, title: topics.title, status: topics.status })
    .from(topics)
    .where(eq(topics.userId, LOCAL_USER_ID))
    .all()

  const previousSessionTopics: Array<{ title: string; sessionCount: number; status: string }> = []
  for (const t of allUserTopics) {
    const count = sessionCountByTopic.get(t.id) || 0
    if (count > 0 && t.id !== currentTopicId) {
      previousSessionTopics.push({
        title: t.title,
        sessionCount: count,
        status: t.status || 'backlog',
      })
    }
  }

  const currentTopicConnectionRows = (db as any).select().from(topicConnections).where(
    or(
      eq(topicConnections.sourceTopicId, currentTopicId),
      eq(topicConnections.targetTopicId, currentTopicId)
    )
  ).all()

  const connectedTopicIds = new Set<string>()
  for (const c of currentTopicConnectionRows) {
    if (c.sourceTopicId !== currentTopicId) connectedTopicIds.add(c.sourceTopicId)
    if (c.targetTopicId !== currentTopicId) connectedTopicIds.add(c.targetTopicId)
  }
  connectedTopicIds.add(currentTopicId)

  const relatedInsights = verifiedInsights
    .filter((i: any) => {
      const topicId = allVerifiedInsights.find((vi: any) => vi.content === i.content)?.topicId
      return topicId && connectedTopicIds.has(topicId)
    })
    .sort((a: any, b: any) => b.confidenceScore - a.confidenceScore)
    .slice(0, 10)

  return {
    userName: user?.name || '',
    occupation: user?.occupation || '',
    verifiedInsights: verifiedInsights.sort((a: any, b: any) => b.confidenceScore - a.confidenceScore).slice(0, 15),
    previousSessionTopics: previousSessionTopics.slice(0, 10),
    relatedInsights,
  }
}

// ============================================
// Opening Message Generation
// ============================================

function generateOpeningMessage(
  title: string,
  description: string | null,
  intent: string | null,
  referenceUrls: string[] = [],
  profileContext?: ProfileContext,
): string {
  const intentPhrases: Record<string, string> = {
    articulate: 'help you articulate your thoughts on',
    explore: 'explore and discover new perspectives about',
    decide: 'help you work through a decision related to',
    document: 'capture and document your knowledge about',
  }

  const intentPhrase = intent && intentPhrases[intent]
    ? intentPhrases[intent]
    : ''

  let message = `We'll begin gathering the story only you can tell about **${title}**.`
  if (intentPhrase) message = `Let's ${intentPhrase} **${title}**.`

  if (description) {
    message += `\n\n${description}`
  }

  // Inject profile context
  if (profileContext) {
    const hasVerifiedInsights = profileContext.verifiedInsights.length > 0
    const hasPreviousTopics = profileContext.previousSessionTopics.length > 0
    const hasRelatedInsights = profileContext.relatedInsights.length > 0

    if (hasVerifiedInsights || hasPreviousTopics) {
      message += `\n\n**From what you've already verified:**`

      if (hasPreviousTopics) {
        const topicNames = profileContext.previousSessionTopics.slice(0, 3).map(t => `"${t.title}"`).join(', ')
        message += ` I see you've already explored topics like ${topicNames}.`
      }

      if (hasVerifiedInsights) {
        const insightsByTopic = new Map<string, Array<{ content: string; topicTitle: string; confidenceScore: number }>>()
        for (const insight of profileContext.verifiedInsights) {
          if (!insightsByTopic.has(insight.topicTitle)) {
            insightsByTopic.set(insight.topicTitle, [])
          }
          insightsByTopic.get(insight.topicTitle)!.push(insight)
        }

        const topicEntries = Array.from(insightsByTopic.entries()).slice(0, 3)

        if (topicEntries.length >= 2) {
          message += ` I can see connections forming across your explorations:`
          for (const [topicName, topicInsights] of topicEntries) {
            const bestInsight = topicInsights[0]
            const snippet = bestInsight.content.length > 100
              ? bestInsight.content.substring(0, 100) + '...'
              : bestInsight.content
            message += `\n- From **"${topicName}"**: *"${snippet}"*`
          }
          message += `\n\nI'll draw on these threads to help us find connections with **${title}**.`
        } else if (topicEntries.length === 1) {
          const [topicName, topicInsights] = topicEntries[0]
          const snippet = topicInsights[0].content.length > 120
            ? topicInsights[0].content.substring(0, 120) + '...'
            : topicInsights[0].content
          message += ` From your exploration of **"${topicName}"**, you've verified that *"${snippet}"*`
          if (profileContext.verifiedInsights.length > 1) {
            message += ` — and you have ${profileContext.verifiedInsights.length - 1} other verified insight${profileContext.verifiedInsights.length > 2 ? 's' : ''} across your knowledge base`
          }
          message += '.'
        }
      } else if (hasRelatedInsights) {
        const topInsight = profileContext.relatedInsights[0]
        message += ` From your work on **"${topInsight.topicTitle}"**, you've established that *"${topInsight.content.length > 120 ? topInsight.content.substring(0, 120) + '...' : topInsight.content}"*`
        if (profileContext.relatedInsights.length > 1) {
          message += ` — along with ${profileContext.relatedInsights.length - 1} other verified insight${profileContext.relatedInsights.length > 2 ? 's' : ''} from related areas`
        }
        message += '.'
      }

      message += ` I'll weave this existing knowledge into our conversation about **${title}**.`
    }
  }

  if (referenceUrls.length > 0) {
    message += `\n\n**Pre-interview context:** I see you've provided ${referenceUrls.length} reference${referenceUrls.length > 1 ? 's' : ''} to help guide our conversation:`
    referenceUrls.forEach((url, index) => {
      message += `\n- [Reference ${index + 1}](${url})`
    })
    message += `\n\nI'll use these references to ask more targeted questions and better understand your perspective on **${title}**.`
    message += `\n\nWhere would you like to start — the aspect of “${title}” that matters most to you right now?`
  } else {
    message += `\n\n**Our interview map:** I'll guide us through five key angles to build a comprehensive picture of your knowledge:`
    message += `\n- **Journey** — your personal story and evolution`
    message += `\n- **Principles** — your core beliefs and guiding values`
    message += `\n- **Frameworks** — your mental models and decision-making approaches`
    message += `\n- **Examples** — concrete stories and lived experiences`
    message += `\n- **Tensions** — contradictions, trade-offs, and open questions`
    message += `\n\nWe'll touch on each angle breadth-first, then go deeper where it matters most.`
    message += `\n\nTo begin: what first comes to mind when you think about “${title}”? A thought, a memory, a question — anything is a good start.`
  }

  return message
}

// ============================================
// Gap-Aware Greeting (for session resume)
// ============================================

function generateGapAwareGreeting(
  topicTitle: string,
  timeGap: string,
  lastUserMessages: string[],
  totalMessageCount: number,
): string {
  let greeting = `Where were we — it's been ${timeGap} since we last talked about **${topicTitle}**.`

  if (lastUserMessages.length > 0) {
    const lastThought = lastUserMessages[lastUserMessages.length - 1]
    const snippet = lastThought.length > 100 ? lastThought.substring(0, 100) + '…' : lastThought
    greeting += `\n\nLast time, you were thinking through: “${snippet}”.`
  }

  greeting += totalMessageCount > 6
    ? `\n\nWe've built good depth here. Pick up where we left off, or start somewhere new?`
    : `\n\nWe were just getting going. Continue from there, or take a different direction?`

  return greeting
}

// ============================================
// Template-based Fallback Responses
// ============================================

type Methodology = 'clean_language' | 'socratic' | 'five_whys' | 'appreciative_inquiry' | 'micro_phenomenology'

function selectMethodology(messageCount: number, intent: string): Methodology {
  const sequences: Record<string, Methodology[]> = {
    articulate: ['clean_language', 'micro_phenomenology', 'socratic', 'appreciative_inquiry', 'five_whys'],
    explore: ['appreciative_inquiry', 'socratic', 'clean_language', 'micro_phenomenology', 'five_whys'],
    decide: ['socratic', 'five_whys', 'clean_language', 'appreciative_inquiry', 'micro_phenomenology'],
    document: ['micro_phenomenology', 'clean_language', 'appreciative_inquiry', 'socratic', 'five_whys'],
  }
  const seq = sequences[intent] || sequences['explore']
  return seq[messageCount % seq.length]
}

function extractKeyPhrases(message: string): string[] {
  const words = message.replace(/[^\w\s'-]/g, '').split(/\s+/).filter(w => w.length > 4)
  const stopWords = new Set([
    'about', 'after', 'again', 'always', 'being', 'biggest', 'could', 'doing',
    'every', 'feels', 'first', 'going', 'great', 'having', 'honestly', 'image',
    'instead', 'maybe', 'might', 'myself', 'never', 'often', 'other', 'place',
    'quite', 'rather', 'really', 'right', 'seems', 'should', 'since', 'small',
    'sometimes', 'something', 'still', 'their', 'there', 'these', 'thing',
    'things', 'think', 'those', 'though', 'through', 'turned', 'under', 'until',
    'where', 'which', 'while', 'would', 'comes', 'makes', 'people', 'wonder',
    'that', 'this', 'with', 'from', 'have', 'been', 'were', 'they', 'them',
    'will', 'just', 'also', 'very', 'much', 'some', 'into', 'when', 'what',
    'like', 'know', 'make', 'made', 'does', 'done', 'more', 'than', 'then',
  ])
  const meaningful = words.filter(w => !stopWords.has(w.toLowerCase()))
  return meaningful.sort((a, b) => b.length - a.length).slice(0, 5)
}

function extractQuote(message: string, maxLength: number = 80): string {
  const clean = cleanText(message)
  const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 15)
  const best = sentences.sort((a, b) => b.length - a.length)[0] ?? clean
  return best.length > maxLength ? best.substring(0, maxLength).trimEnd() + '…' : best
}

function generateReflection(
  methodology: Methodology,
  topicTitle: string,
  lastUserMessage: string,
  previousUserMessages: string[],
  messageCount: number,
): string {
  const quote = extractQuote(lastUserMessage)
  const keyPhrases = extractKeyPhrases(lastUserMessage)
  const keyPhrase = keyPhrases.length > 0 ? keyPhrases[0] : ''

  let priorReference = ''
  if (previousUserMessages.length > 0 && messageCount > 1) {
    const earlierQuote = extractQuote(previousUserMessages[previousUserMessages.length - 1], 60)
    priorReference = ` Earlier you mentioned “${earlierQuote}” — that gives us a thread to compare.`
  }

  const reflections: Record<Methodology, string[]> = {
    clean_language: [
      `When you say “${quote}”, you're giving us exact language to work with. ${keyPhrase ? `The word “${keyPhrase}” gives us a handle on how you frame **${topicTitle}**.` : `That phrasing gives us a handle on how you frame **${topicTitle}**.`}${priorReference}`,
      `I notice the wording here: “${quote}”. ${keyPhrase ? `“${keyPhrase}” seems to carry weight in how you describe **${topicTitle}**.` : `Your phrasing gives us a specific entry point into **${topicTitle}**.`}${priorReference}`,
      `You put the experience this way: “${quote}”. ${keyPhrase ? `Let's stay with “${keyPhrase}” and see what it does in your thinking.` : 'Let’s stay with the wording and see what it points to.'}${priorReference}`,
    ],
    socratic: [
      `You made a clear claim: “${quote}”. ${keyPhrase ? `The point about “${keyPhrase}” gives us an assumption to examine.` : 'That gives us an assumption to examine.'}${priorReference}`,
      `When you say “${quote}”, there is a belief we can test carefully. ${keyPhrase ? `“${keyPhrase}” looks central to how you see **${topicTitle}**.` : `Your framing of **${topicTitle}** gives us something concrete to question.`}${priorReference}`,
      `“${quote}” gives us a position to work from. ${keyPhrase ? `Let's define what “${keyPhrase}” means here and where its limits are.` : 'Let’s define the idea and where its limits are.'}${priorReference}`,
    ],
    five_whys: [
      `“${quote}” points to a lower layer. ${keyPhrase ? `“${keyPhrase}” may be the visible part of a reason underneath your approach to **${topicTitle}**.` : `There may be a reason underneath your approach to **${topicTitle}**.`}${priorReference}`,
      `You named it as “${quote}”. ${keyPhrase ? `The idea of “${keyPhrase}” may be a surface expression of a more basic motive.` : 'That may be a surface expression of a more basic motive.'}${priorReference}`,
      `I hear the shape of it in “${quote}”. ${keyPhrase ? `Let's look at what drives “${keyPhrase}” rather than taking it as the final layer.` : 'Let’s look at what drives it rather than taking it as the final layer.'}${priorReference}`,
    ],
    appreciative_inquiry: [
      `You put that precisely: “${quote}”. ${keyPhrase ? `The way you hold “${keyPhrase}” looks like a real strength in how you navigate **${topicTitle}**.` : `There's a clear self-awareness in how you frame **${topicTitle}**.`}${priorReference}`,
      `“${quote}” names something that is working. ${keyPhrase ? `Your relationship to “${keyPhrase}” gives us a strength to examine directly.` : `Your framing of **${topicTitle}** gives us a strength to examine directly.`}${priorReference}`,
      `You described it as “${quote}”. ${keyPhrase ? `“${keyPhrase}” seems connected to what you rely on when **${topicTitle}** is going well.` : `Let's look at what you rely on when **${topicTitle}** is going well.`}${priorReference}`,
    ],
    micro_phenomenology: [
      `“${quote}” gives us a moment to slow down. ${keyPhrase ? `When “${keyPhrase}” comes up, we can look at the sequence of thought, feeling, and attention.` : 'We can look at the sequence of thought, feeling, and attention.'}${priorReference}`,
      `You described the moment as “${quote}”. ${keyPhrase ? `I'm interested in what happens in experience when “${keyPhrase}” appears around **${topicTitle}**.` : `I'm interested in what happens in experience around **${topicTitle}**.`}${priorReference}`,
      `When you describe “${quote}”, we have enough to inspect the texture of the experience. ${keyPhrase ? `“${keyPhrase}” can anchor the close observation.` : 'The wording can anchor the close observation.'}${priorReference}`,
    ],
  }

  const methodReflections = reflections[methodology]
  return methodReflections[messageCount % methodReflections.length]
}

function generateQuestion(
  methodology: Methodology,
  topicTitle: string,
  lastUserMessage: string,
  previousUserMessages: string[],
  messageCount: number,
  _topicIntent: string,
): string {
  const keyPhrases = extractKeyPhrases(lastUserMessage)
  const keyPhrase = keyPhrases.length > 0 ? keyPhrases[0] : topicTitle
  const secondPhrase = keyPhrases.length > 1 ? keyPhrases[1] : ''

  const hasPrior = previousUserMessages.length > 0
  const priorKeyPhrases = hasPrior ? extractKeyPhrases(previousUserMessages[previousUserMessages.length - 1]) : []
  const priorPhrase = priorKeyPhrases.length > 0 ? priorKeyPhrases[0] : ''

  const questions: Record<Methodology, string[]> = {
    clean_language: [
      `And when you experience **${keyPhrase}**${secondPhrase ? ` and **${secondPhrase}**` : ''} in relation to **${topicTitle}**, what kind of **${keyPhrase}** is that?`,
      `You mentioned **${keyPhrase}** — and is there anything else about **${keyPhrase}** as it relates to **${topicTitle}**?`,
      `When **${keyPhrase}** happens in the context of **${topicTitle}**, **where do you feel that** — and what's it like?`,
      `What would you like to have happen with **${keyPhrase}** and your understanding of **${topicTitle}**?`,
      hasPrior && priorPhrase
        ? `You've touched on both **${priorPhrase}** and now **${keyPhrase}** — **what's the relationship between these two** in how you think about **${topicTitle}**?`
        : `And **${keyPhrase}** is like... what? **What metaphor or image** comes to mind when you think about this aspect of **${topicTitle}**?`,
    ],
    socratic: [
      `What **evidence from your experience** supports this view of **${keyPhrase}** in relation to **${topicTitle}**? And is there **any counter-evidence** you've encountered?`,
      `If someone held the **opposite view** about **${keyPhrase}** and **${topicTitle}**, what would be their **strongest argument**?`,
      `**What assumptions are you making** about **${keyPhrase}** that might be worth examining? Which of those assumptions feel most certain and which feel shaky?`,
      `How would you **define ${keyPhrase}** precisely? And does that **definition hold up** across different situations in your life?`,
      hasPrior && priorPhrase
        ? `Earlier you discussed **${priorPhrase}**, and now **${keyPhrase}** — are these **consistent with each other**, or is there a tension worth exploring?`
        : `**What would need to be true** for your perspective on **${keyPhrase}** to be completely wrong? And how likely do you think that is?`,
    ],
    five_whys: [
      `**Why does ${keyPhrase} matter** so much to you in the context of **${topicTitle}**? What's at stake if it were different?`,
      `You've identified **${keyPhrase}** as important — but **why is that the case** rather than something else? What makes it fundamental?`,
      `If we go one level deeper: **why do you think** you feel this way about **${keyPhrase}**? What **experience or belief** is driving it?`,
      `**What would change** in your life if **${keyPhrase}** were no longer part of how you see **${topicTitle}**? And why would that matter?`,
      hasPrior && priorPhrase
        ? `We've traced from **${priorPhrase}** to **${keyPhrase}** — **why does this chain** exist for you? What's the **deepest reason** connecting them?`
        : `**Why is ${keyPhrase} the way you chose** to express this? What's underneath that choice?`,
    ],
    appreciative_inquiry: [
      `When **${keyPhrase}** is at its **best** in relation to **${topicTitle}**, what does that look like? Can you describe a **peak moment**?`,
      `What **strengths of yours** make your approach to **${keyPhrase}** and **${topicTitle}** particularly effective? What are you **most proud of** here?`,
      `**Imagine the ideal future** where your understanding of **${keyPhrase}** is fully realized — **what would be different** about how you engage with **${topicTitle}**?`,
      `What **conditions or environments** help you be at your best with **${keyPhrase}**? What do those conditions make possible around **${topicTitle}**?`,
      hasPrior && priorPhrase
        ? `You've shown real depth in discussing both **${priorPhrase}** and **${keyPhrase}** — **what's the greatest strength** you bring to understanding **${topicTitle}**?`
        : `If you could **amplify what's already working** about your relationship with **${keyPhrase}**, **what would you do more of**?`,
    ],
    micro_phenomenology: [
      `When **${keyPhrase}** comes up for you, **what's the very first thing** you notice — a thought, a feeling, a sensation? **Walk me through that moment** in slow motion.`,
      `If you close your eyes and think about **${keyPhrase}** in the context of **${topicTitle}**, **what images or sensations** arise? **Where in your body** do you notice them?`,
      `**At the exact moment** when you're engaged with **${keyPhrase}**, what is the **quality of your attention**? Is it focused, diffuse, excited, calm?`,
      `Can you **replay a specific moment** when **${keyPhrase}** was most vivid for you? **What were you seeing, hearing, feeling** in that precise instant?`,
      hasPrior && priorPhrase
        ? `Compare the **felt experience** of **${priorPhrase}** with **${keyPhrase}** — do they **feel different** in your body or mind? How would you describe that difference?`
        : `**What's the texture** of your experience with **${keyPhrase}**? If it had a **color, temperature, or rhythm**, what would it be?`,
    ],
  }

  const methodQuestions = questions[methodology]
  return methodQuestions[messageCount % methodQuestions.length]
}

function generateAngleQuestion(
  angle: InterviewMapAngle,
  topicTitle: string,
  lastUserMessage: string,
  _previousUserMessages: string[],
  messageCount: number,
  _methodology: Methodology,
): string {
  const keyPhrases = extractKeyPhrases(lastUserMessage)
  const keyPhrase = keyPhrases.length > 0 ? keyPhrases[0] : topicTitle

  const angleQuestions: Record<string, string[]> = {
    journey: [
      `Let's explore your **journey** with **${topicTitle}**. **How did you first get involved** with **${keyPhrase}**, and how has your relationship with it **evolved over time**?`,
      `Thinking about **${keyPhrase}** and your path with **${topicTitle}** — **what was a pivotal moment** that shaped how you see this today?`,
      `Looking back at your **journey** with **${topicTitle}** — **where did you start**, and what **turning points** brought you to where you are now with **${keyPhrase}**?`,
      `**How has your perspective on ${keyPhrase}** changed over the course of your experience with **${topicTitle}**? Was there a **before-and-after moment**?`,
      `Tell me about the **arc of your experience** with **${topicTitle}** — **what chapter** are you in now, and what led you here?`,
    ],
    principles: [
      `Let's dig into your **principles** around **${topicTitle}**. When it comes to **${keyPhrase}**, **what do you believe to be fundamentally true**?`,
      `What are your **non-negotiables** when it comes to **${keyPhrase}** in the context of **${topicTitle}**? What **rules or values** guide you here?`,
      `If you had to distill your **core beliefs** about **${keyPhrase}** and **${topicTitle}** into a few guiding principles, **what would they be**?`,
      `**What principle** about **${keyPhrase}** would you **never compromise on**, even under pressure? Why does it matter so deeply?`,
      `When someone asks your advice about **${topicTitle}**, what's the **first principle** you share? How does **${keyPhrase}** fit into that?`,
    ],
    frameworks: [
      `I'd love to understand your **mental models** for **${topicTitle}**. When you encounter **${keyPhrase}**, **how do you think through it**? What's your framework?`,
      `**How do you structure your thinking** about **${keyPhrase}** in relation to **${topicTitle}**? Do you have a **step-by-step approach** or a **mental model** you rely on?`,
      `When you need to make a **decision** about **${keyPhrase}** and **${topicTitle}**, **what framework** do you use? Walk me through your process.`,
      `What **mental model or analogy** best captures how you approach **${keyPhrase}**? How does it help you navigate **${topicTitle}**?`,
      `If you were teaching someone your approach to **${topicTitle}**, what **framework** would you share? How does **${keyPhrase}** fit into that structure?`,
    ],
    examples: [
      `Let's ground this in a **concrete example**. Can you share a **specific situation** involving **${keyPhrase}** and **${topicTitle}** that really illustrates your perspective?`,
      `**Tell me a story** about **${keyPhrase}** — a **real moment** that captures what **${topicTitle}** means to you in practice.`,
      `Think of a **specific time** when **${keyPhrase}** came into play with **${topicTitle}** — **what happened**, and what did it reveal about you?`,
      `What's the **best example** you can think of that shows how you handle **${keyPhrase}** in the context of **${topicTitle}**? What made it memorable?`,
      `Can you walk me through a **real scenario** where your approach to **${keyPhrase}** was put to the test? How did it play out?`,
    ],
    tensions: [
      `Now let's explore the **tensions** and **trade-offs**. Where do you feel **conflicted** about **${keyPhrase}** and **${topicTitle}**? What's not fully resolved?`,
      `Is there a **contradiction** in how you think about **${keyPhrase}**? A place where your **beliefs pull in different directions** regarding **${topicTitle}**?`,
      `**What trade-off** do you navigate most often with **${keyPhrase}** and **${topicTitle}**? What do you **gain and lose** in that balancing act?`,
      `What's an **unresolved question** you have about **${keyPhrase}** and **${topicTitle}**? Something that still **keeps you thinking**?`,
      `Where does your thinking about **${keyPhrase}** feel **incomplete or uncertain**? What would you need to **resolve that tension**?`,
    ],
  }

  const questions = angleQuestions[angle.id] || angleQuestions['journey']
  return questions[messageCount % questions.length]
}

function generateProfileContextBridge(
  lastUserMessage: string,
  profileContext: ProfileContext,
  topicTitle: string,
  messageCount: number,
): string {
  const lastMessageLower = lastUserMessage.toLowerCase()
  const lastMessageWords = lastMessageLower.split(/\s+/).filter(w => w.length > 3)

  const crossTopicInsights = profileContext.verifiedInsights.filter(
    i => i.topicTitle.toLowerCase() !== topicTitle.toLowerCase()
  )
  const insightsPool = crossTopicInsights.length > 0 ? crossTopicInsights : profileContext.verifiedInsights

  const scoredInsights = insightsPool.map(insight => {
    const insightLower = insight.content.toLowerCase()
    let score = 0
    for (const word of lastMessageWords) {
      if (insightLower.includes(word)) score += 3
    }
    const isRelated = profileContext.relatedInsights.some(r => r.content === insight.content)
    if (isRelated) score += 5
    if (insight.topicTitle.toLowerCase() !== topicTitle.toLowerCase()) score += 2
    if (insight.confidenceScore >= 75) score += 2
    return { ...insight, relevanceScore: score }
  }).sort((a, b) => b.relevanceScore - a.relevanceScore)

  const bestInsight = scoredInsights.find(i => i.relevanceScore > 0)
  if (!bestInsight) return ''

  const insightSnippet = bestInsight.content.length > 100
    ? bestInsight.content.substring(0, 100) + '...'
    : bestInsight.content

  const bridges = [
    `This connects to something you've already verified about yourself — from your exploration of **"${bestInsight.topicTitle}"**, you established: *"${insightSnippet}"* How does that relate to what you're sharing now about **${topicTitle}**?`,
    `Interestingly, your verified insight from **"${bestInsight.topicTitle}"** — *"${insightSnippet}"* — seems to resonate with what you're describing here. I'd love to understand how these threads connect for you.`,
    `I'm noticing a pattern here. In your work on **"${bestInsight.topicTitle}"**, you verified: *"${insightSnippet}"* There's a clear connection to what you're exploring in **${topicTitle}** right now.`,
    `This builds on something you've already articulated. From **"${bestInsight.topicTitle}"**: *"${insightSnippet}"* — and what you're sharing now adds another dimension to that understanding.`,
    `Your previous insight from **"${bestInsight.topicTitle}"** — *"${insightSnippet}"* — adds interesting context to what you're exploring here in **${topicTitle}**.`,
    `I see a thread connecting your exploration of **"${bestInsight.topicTitle}"** to what we're discussing now. You verified: *"${insightSnippet}"* — this seems deeply relevant to **${topicTitle}**.`,
    `Drawing on your verified self-knowledge from **"${bestInsight.topicTitle}"**: *"${insightSnippet}"* — there's a meaningful overlap with what you're sharing about **${topicTitle}** here.`,
  ]

  return bridges[messageCount % bridges.length]
}

function generateAIResponse(
  topicTitle: string,
  _topicDescription: string,
  topicIntent: string,
  conversationHistory: Array<{ role: string; content: string }>,
  profileContext?: ProfileContext,
  interviewMap?: InterviewMap | null,
): string {
  const userMessages = conversationHistory.filter(m => m.role === 'user')
  const messageCount = userMessages.length
  const lastUserMessage = userMessages[userMessages.length - 1]?.content || ''
  const previousUserMessages = userMessages.slice(0, -1).map(m => m.content)

  const methodology = selectMethodology(messageCount, topicIntent || 'explore')

  const reflection = generateReflection(
    methodology,
    topicTitle,
    lastUserMessage,
    previousUserMessages,
    messageCount,
  )

  let question: string
  let angleLabel = ''

  if (interviewMap && interviewMap.type === 'default') {
    const currentAngle = getCurrentInterviewAngle(interviewMap, messageCount)
    angleLabel = currentAngle.label

    question = generateAngleQuestion(
      currentAngle,
      topicTitle,
      lastUserMessage,
      previousUserMessages,
      messageCount,
      methodology,
    )
  } else {
    question = generateQuestion(
      methodology,
      topicTitle,
      lastUserMessage,
      previousUserMessages,
      messageCount,
      topicIntent || 'explore',
    )
  }

  let profileBridge = ''
  if (profileContext && profileContext.verifiedInsights.length > 0) {
    profileBridge = generateProfileContextBridge(
      lastUserMessage,
      profileContext,
      topicTitle,
      messageCount,
    )
  }

  if (messageCount === 0) {
    const base = `I appreciate you getting started. Let me reflect on what you've shared.\n\n${reflection}`
    return profileBridge
      ? `${base}\n\n${profileBridge}\n\n${question}`
      : `${base}\n\n${question}`
  }

  if (messageCount >= 3 && messageCount % 3 === 0) {
    let transition: string
    if (angleLabel) {
      const angleTransitions = [
        `Let me shift our angle to explore your **${angleLabel.toLowerCase()}** perspective.`,
        `I'd like to approach this from the **${angleLabel.toLowerCase()}** angle now.`,
        `Let's look at this through the lens of **${angleLabel.toLowerCase()}**.`,
        `I want to explore the **${angleLabel.toLowerCase()}** dimension of this topic.`,
      ]
      transition = angleTransitions[(messageCount / 3) % angleTransitions.length]
    } else {
      const transitions = [
        `Let me shift our angle slightly here.`,
        `I'd like to explore this from a different direction now.`,
        `Let's approach this from a new perspective.`,
        `I want to zoom into something specific.`,
      ]
      transition = transitions[(messageCount / 3) % transitions.length]
    }
    return profileBridge
      ? `${reflection}\n\n${profileBridge}\n\n${transition}\n\n${question}`
      : `${reflection}\n\n${transition}\n\n${question}`
  }

  const hasCrossTopicInsights = profileContext && profileContext.verifiedInsights.some(
    i => i.topicTitle.toLowerCase() !== topicTitle.toLowerCase()
  )
  if (profileBridge && (hasCrossTopicInsights || messageCount % 2 === 1 || messageCount <= 2)) {
    return `${reflection}\n\n${profileBridge}\n\n${question}`
  }

  return `${reflection}\n\n${question}`
}

// Template quick replies
function extractTopicWord(conversationHistory: Array<{ role: string; content: string }>): string {
  const userMessages = conversationHistory.filter(m => m.role === 'user')
  if (userMessages.length === 0) return ''

  const lastMsg = userMessages[userMessages.length - 1].content
  const words = lastMsg.replace(/[^\w\s'-]/g, '').split(/\s+/).filter(w => w.length >= 6)
  const stopWords = new Set([
    'about', 'after', 'again', 'always', 'anything', 'before', 'being',
    'between', 'biggest', 'because', 'cannot', 'comes', 'could', 'different',
    'doing', 'during', 'either', 'enough', 'every', 'everything', 'feels',
    'first', 'getting', 'going', 'great', 'having', 'honestly', 'however',
    'image', 'instead', 'itself', 'makes', 'maybe', 'might', 'myself',
    'never', 'nothing', 'often', 'other', 'people', 'place', 'pretty',
    'quite', 'rather', 'really', 'right', 'seems', 'should', 'since',
    'small', 'something', 'someone', 'sometimes', 'still', 'their',
    'there', 'these', 'thing', 'things', 'think', 'those', 'though',
    'through', 'turned', 'under', 'understand', 'until', 'where',
    'which', 'while', 'within', 'without', 'wonder', 'would',
  ])
  const meaningful = words.filter(w => !stopWords.has(w.toLowerCase()))
  return meaningful.length > 0 ? meaningful[0].toLowerCase() : ''
}

function generateQuickReplies(
  messageCount: number,
  _lastAiMessage?: string,
  conversationHistory?: Array<{ role: string; content: string }>,
): string[] {
  const topicWord = conversationHistory ? extractTopicWord(conversationHistory) : ''

  if (messageCount === 0) {
    return [
      'I have a specific experience that comes to mind',
      "I'd like to start with the big picture",
      "I'm still figuring out my thoughts on this",
    ]
  }

  if (messageCount === 1) {
    return [
      topicWord ? `I feel strongly about ${topicWord} in my life` : 'I feel strongly about this in my life',
      'I see it differently than most people do',
      'I need to think about that more carefully',
    ]
  }

  const contextualSets = [
    [
      'Yes, that really resonates with how I see it',
      'I want to share a personal example of this',
      "I think there's a contradiction I should explore",
    ],
    [
      "I've changed my mind on this over the years",
      topicWord ? `My experience with ${topicWord} is complex` : 'My experience here is more complex than expected',
      'I want to go deeper into that question',
    ],
    [
      'I have a story that illustrates this perfectly',
      "I'm realizing something new about myself right now",
      "I'd like to explore a different angle instead",
    ],
    [
      topicWord ? `I'm not sure why ${topicWord} matters so much` : "I'm not sure why this matters so much to me",
      'I can see both sides of this tension clearly',
      'I want to challenge my own assumption here',
    ],
    [
      "I've never put this into words before now",
      'My perspective on this has shifted recently',
      'I think the answer is more nuanced than that',
    ],
  ]

  return contextualSets[(messageCount - 2) % contextualSets.length]
}

async function getAIQuickReplies(
  messageCount: number,
  aiResponseContent: string,
  conversationHistory: Array<{ role: string; content: string }>,
): Promise<string[]> {
  if (conversationHistory.length > 0 && aiResponseContent) {
    try {
      const aiReplies = await generateClaudeQuickReplies(conversationHistory, aiResponseContent)
      if (aiReplies && aiReplies.length >= 2) {
        return aiReplies
      }
    } catch {
      // Fall through to template
    }
  }
  return generateQuickReplies(messageCount, aiResponseContent, conversationHistory)
}

// ============================================
// Public Session Service Functions
// ============================================

/**
 * Create a new interview session for a topic.
 */
export async function createSession(
  db: Db,
  topicId: string,
): Promise<{
  session: any
  topic: any
  messages: any[]
}> {
  // Verify the topic belongs to the user
  const topic = (db as any).select().from(topics).where(
    and(eq(topics.id, topicId), eq(topics.userId, LOCAL_USER_ID))
  ).get()

  if (!topic) {
    throw new Error('This topic no longer exists. It may have been deleted. Please go back and select a different topic.')
  }

  const sessionId = crypto.randomUUID()

  // Look up user session length preference
  const userRecord = (db as any).select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  const suggestedDuration = userRecord?.sessionLengthDefault ?? 15

  // Parse reference URLs and context items
  const referenceUrls = parseJsonArray(topic.referenceUrls)
  const contextItems = parseJsonArray(topic.contextItems)

  const sessionContextData = referenceUrls.length > 0 || contextItems.length > 0
    ? {
      referenceUrls,
      contextItems,
      processedAt: new Date().toISOString(),
      urlCount: referenceUrls.length,
      contextItemCount: contextItems.length,
      summary: buildContextSummary(referenceUrls, contextItems),
    }
    : null

  const newSession = (db as any).insert(sessions).values({
    id: sessionId,
    topicId,
    userId: LOCAL_USER_ID,
    status: 'active',
    isMiniSession: false,
    suggestedDurationMinutes: suggestedDuration,
    timeSpentSeconds: 0,
    researchData: sessionContextData ? JSON.stringify(sessionContextData) : null,
    interviewMap: JSON.stringify(createDefaultInterviewMap()),
  }).returning().get()

  // Update topic status
  if (topic.status === 'backlog') {
    ;(db as any).update(topics).set({
      status: 'in_progress',
      updatedAt: new Date().toISOString(),
    }).where(eq(topics.id, topicId)).run()
  }

  // Gather profile context
  const profileContext = gatherProfileContext(db, topicId)

  // Create opening message
  const openingMessageContent = generateOpeningMessage(
    topic.title,
    topic.description,
    topic.intent,
    referenceUrls,
    profileContext,
  )

  const openingMessageId = crypto.randomUUID()
  const openingMessage = (db as any).insert(messages).values({
    id: openingMessageId,
    sessionId,
    role: 'assistant',
    content: openingMessageContent,
    quickReplies: JSON.stringify([
      'I have something specific on my mind about this',
      "I'd like to explore this openly and see what emerges",
      "I'm not sure where to start, guide me",
    ]),
    suggestsCompletion: false,
    isBookmarked: false,
    isVoiceInput: false,
  }).returning().get()

  scheduleSave()

  return {
    session: newSession,
    topic,
    messages: [openingMessage],
  }
}

/**
 * Get a specific session with its messages and topic.
 */
export function getSession(
  db: Db,
  id: string,
): {
  session: any
  topic: any
  messages: any[]
} {
  const session = (db as any).select().from(sessions).where(
    and(eq(sessions.id, id), eq(sessions.userId, LOCAL_USER_ID))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  const topic = (db as any).select().from(topics).where(eq(topics.id, session.topicId)).get()

  const sessionMessages = (db as any).select().from(messages)
    .where(eq(messages.sessionId, id))
    .orderBy(messages.createdAt)
    .all()

  return {
    session,
    topic,
    messages: sessionMessages,
  }
}

/**
 * List all sessions for the local user.
 */
export function getSessions(db: Db): any[] {
  return (db as any).select().from(sessions).where(
    eq(sessions.userId, LOCAL_USER_ID)
  ).orderBy(desc(sessions.createdAt)).all()
}

/**
 * List sessions for a specific topic.
 */
export function getSessionsByTopic(db: Db, topicId: string): any[] {
  return (db as any).select().from(sessions).where(
    and(eq(sessions.userId, LOCAL_USER_ID), eq(sessions.topicId, topicId))
  ).orderBy(desc(sessions.createdAt)).all()
}

/**
 * Pause an active session.
 */
export function pauseSession(db: Db, id: string): any {
  const session = (db as any).select().from(sessions).where(
    and(eq(sessions.id, id), eq(sessions.userId, LOCAL_USER_ID))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  if (session.status !== 'active') {
    throw new Error('Only active sessions can be paused')
  }

  const updated = (db as any).update(sessions).set({
    status: 'paused',
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, id)).returning().get()

  scheduleSave()
  return updated
}

/**
 * Resume a paused session with a gap-aware greeting message.
 */
export function resumeSession(
  db: Db,
  id: string,
): {
  session: any
  topic: any
  greetingMessage: any
} {
  const session = (db as any).select().from(sessions).where(
    and(eq(sessions.id, id), eq(sessions.userId, LOCAL_USER_ID))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  if (session.status !== 'paused') {
    throw new Error('Only paused sessions can be resumed')
  }

  // Get topic context
  const topic = (db as any).select().from(topics).where(eq(topics.id, session.topicId)).get()

  // Get conversation history
  const conversationHistory = (db as any).select().from(messages)
    .where(eq(messages.sessionId, id))
    .orderBy(messages.createdAt)
    .all()

  // Calculate time gap
  const pausedAt = new Date(session.updatedAt)
  const now = new Date()
  const gapMs = now.getTime() - pausedAt.getTime()
  const gapMinutes = Math.floor(gapMs / 60000)
  const gapHours = Math.floor(gapMinutes / 60)
  const gapDays = Math.floor(gapHours / 24)

  let timeGapDescription = ''
  if (gapDays > 0) {
    timeGapDescription = gapDays === 1 ? 'a day' : `${gapDays} days`
  } else if (gapHours > 0) {
    timeGapDescription = gapHours === 1 ? 'an hour' : `${gapHours} hours`
  } else if (gapMinutes > 5) {
    timeGapDescription = `${gapMinutes} minutes`
  } else {
    timeGapDescription = 'a moment'
  }

  // Get last user messages for context
  const lastUserMessages = conversationHistory
    .filter((m: any) => m.role === 'user')
    .slice(-2)
    .map((m: any) => m.content)

  // Generate gap-aware greeting
  const topicTitle = topic?.title || 'our discussion'
  const gapGreeting = generateGapAwareGreeting(topicTitle, timeGapDescription, lastUserMessages, conversationHistory.length)

  // Update session status back to active
  const updated = (db as any).update(sessions).set({
    status: 'active',
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, id)).returning().get()

  // Insert the gap-aware greeting message
  const greetingMessageId = crypto.randomUUID()
  const greetingMessage = (db as any).insert(messages).values({
    id: greetingMessageId,
    sessionId: id,
    role: 'assistant',
    content: gapGreeting,
    quickReplies: JSON.stringify([
      "Let's continue where we left off",
      "I've had some new thoughts to share",
      'Can you remind me what we covered?',
    ]),
    suggestsCompletion: false,
    isBookmarked: false,
    isVoiceInput: false,
  }).returning().get()

  scheduleSave()

  return {
    session: updated,
    topic,
    greetingMessage,
  }
}

/**
 * Complete a session. Sets status to completed.
 * NOTE: Insight extraction is handled separately when notes are distilled.
 */
export function completeSession(db: Db, id: string): any {
  const session = (db as any).select().from(sessions).where(
    and(eq(sessions.id, id), eq(sessions.userId, LOCAL_USER_ID))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  const updated = (db as any).update(sessions).set({
    status: 'completed',
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, id)).returning().get()

  scheduleSave()
  return updated
}

/**
 * Update session status and/or time spent.
 */
export function updateSession(
  db: Db,
  id: string,
  updates: { status?: string; timeSpentSeconds?: number },
): any {
  const session = (db as any).select().from(sessions).where(
    and(eq(sessions.id, id), eq(sessions.userId, LOCAL_USER_ID))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  const updated = (db as any).update(sessions).set({
    status: updates.status !== undefined ? updates.status : session.status,
    timeSpentSeconds: updates.timeSpentSeconds !== undefined ? updates.timeSpentSeconds : session.timeSpentSeconds,
    updatedAt: new Date().toISOString(),
    completedAt: updates.status === 'completed' ? new Date().toISOString() : session.completedAt,
  }).where(eq(sessions.id, id)).returning().get()

  scheduleSave()
  return updated
}

/**
 * Update time tracking for a session.
 */
export function updateSessionTime(db: Db, sessionId: string, seconds: number): any {
  const session = (db as any).select().from(sessions).where(
    and(eq(sessions.id, sessionId), eq(sessions.userId, LOCAL_USER_ID))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  const updated = (db as any).update(sessions).set({
    timeSpentSeconds: seconds,
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, sessionId)).returning().get()

  scheduleSave()
  return updated
}

/**
 * Delete a session and all related data.
 * CASCADE handles messages, bookmarks, notes, insights, etc.
 */
export function deleteSession(
  db: Db,
  id: string,
): { success: boolean; topicId: string; remainingSessionsForTopic: number } {
  const session = (db as any).select().from(sessions).where(
    and(eq(sessions.id, id), eq(sessions.userId, LOCAL_USER_ID))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  const topicId = session.topicId

  // Clear source_session_id references in insights from other sessions
  ;(db as any).update(insights).set({
    sourceSessionId: null,
  }).where(eq(insights.sourceSessionId, id)).run()

  // Delete the session (CASCADE handles related data)
  ;(db as any).delete(sessions).where(eq(sessions.id, id)).run()

  // Count remaining sessions for the topic
  const remainingSessions = (db as any).select().from(sessions).where(
    eq(sessions.topicId, topicId)
  ).all()

  // Reset topic to backlog if no sessions remain
  if (remainingSessions.length === 0) {
    ;(db as any).update(topics).set({
      status: 'backlog',
      updatedAt: new Date().toISOString(),
    }).where(
      and(eq(topics.id, topicId), eq(topics.userId, LOCAL_USER_ID))
    ).run()
  }

  scheduleSave()

  return {
    success: true,
    topicId,
    remainingSessionsForTopic: remainingSessions.length,
  }
}

/**
 * Send a message in a session and stream the AI response.
 * Returns an async generator that yields string chunks.
 * After the generator is consumed, the assistant message has been saved to the DB.
 */
export async function* sendMessage(
  db: Db,
  sessionId: string,
  content: string,
  opts?: { isVoiceInput?: boolean },
): AsyncGenerator<string, void, undefined> {
  // Verify session
  const session = (db as any).select().from(sessions).where(
    and(eq(sessions.id, sessionId), eq(sessions.userId, LOCAL_USER_ID))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  if (!content) {
    throw new Error('Message content is required')
  }

  // Save the user message
  const userMessageId = crypto.randomUUID()
  ;(db as any).insert(messages).values({
    id: userMessageId,
    sessionId,
    role: 'user',
    content,
    isBookmarked: false,
    isVoiceInput: opts?.isVoiceInput || false,
  }).returning().get()

  // Get topic
  const topic = (db as any).select().from(topics).where(eq(topics.id, session.topicId)).get()

  // Get conversation history
  const conversationHistory = (db as any).select().from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  const historyForAI = conversationHistory.map((m: any) => ({ role: m.role, content: m.content }))
  const userMessageCount = conversationHistory.filter((m: any) => m.role === 'user').length
  const msgProfileContext = gatherProfileContext(db, session.topicId)
  const sessionInterviewMap: InterviewMap | null = session.interviewMap
    ? JSON.parse(session.interviewMap as string)
    : null

  // Build AI options
  const aiOptions: AIResponseOptions = {
    topicTitle: topic?.title || 'Unknown Topic',
    topicDescription: topic?.description || '',
    topicIntent: topic?.intent || '',
    conversationHistory: historyForAI,
    profileContext: msgProfileContext,
    interviewMap: sessionInterviewMap,
  }

  let fullResponseText = ''
  let usedRealStreaming = false

  // PRIMARY PATH: Real Claude Streaming
  if (isAIAvailable()) {
    try {
      const streamGen = streamClaudeResponse(aiOptions)
      for await (const chunk of streamGen) {
        fullResponseText += chunk
        yield chunk
      }
      if (fullResponseText && fullResponseText.trim().length > 0) {
        usedRealStreaming = true
      }
    } catch (streamError) {
      console.error('[me.md:sessions] Stream failed, falling back to template:', streamError)
      fullResponseText = ''
    }
  }

  // FALLBACK: Template-based response
  if (!usedRealStreaming) {
    fullResponseText = generateAIResponse(
      topic?.title || 'Unknown Topic',
      topic?.description || '',
      topic?.intent || '',
      historyForAI,
      aiOptions.profileContext,
      aiOptions.interviewMap,
    )
    // Yield the fallback as a single chunk
    yield fullResponseText
  }

  // Append completion suggestion if enough messages
  const shouldSuggestCompletion = userMessageCount >= 10
  if (shouldSuggestCompletion) {
    const completionNote = '\n\n---\n\n*We\'ve explored many angles together. Feel free to **continue exploring** if there\'s more to uncover, or **finish and distill** to capture your insights.*'
    fullResponseText += completionNote
    yield completionNote
  }

  // Generate quick replies
  const quickRepliesArr = await getAIQuickReplies(userMessageCount, fullResponseText, historyForAI)

  // Save the complete AI message
  const aiMessageId = crypto.randomUUID()
  ;(db as any).insert(messages).values({
    id: aiMessageId,
    sessionId,
    role: 'assistant',
    content: fullResponseText,
    quickReplies: JSON.stringify(quickRepliesArr),
    suggestsCompletion: shouldSuggestCompletion,
    isBookmarked: false,
    isVoiceInput: false,
  }).returning().get()

  // Update session timestamp
  ;(db as any).update(sessions).set({
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, sessionId)).run()

  scheduleSave()
}

/**
 * Retry AI response for the last user message (when AI failed previously).
 * Returns an async generator that yields string chunks.
 */
export async function* retryMessage(
  db: Db,
  sessionId: string,
): AsyncGenerator<string, void, undefined> {
  const session = (db as any).select().from(sessions).where(
    and(eq(sessions.id, sessionId), eq(sessions.userId, LOCAL_USER_ID))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  // Get conversation history
  const conversationHistory = (db as any).select().from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  // Check that the last message is from the user
  const lastMessage = conversationHistory[conversationHistory.length - 1]
  if (!lastMessage || lastMessage.role !== 'user') {
    throw new Error('No pending user message to retry. The last message is not from a user.')
  }

  const topic = (db as any).select().from(topics).where(eq(topics.id, session.topicId)).get()

  const historyForAI = conversationHistory.map((m: any) => ({ role: m.role, content: m.content }))
  const userMessageCount = conversationHistory.filter((m: any) => m.role === 'user').length

  const retryProfileContext = gatherProfileContext(db, session.topicId)
  const retryInterviewMap: InterviewMap | null = session.interviewMap
    ? JSON.parse(session.interviewMap as string)
    : null

  let fullResponseText = ''
  let usedRealStreaming = false

  // Try streaming first
  if (isAIAvailable()) {
    try {
      const aiOptions: AIResponseOptions = {
        topicTitle: topic?.title || 'Unknown Topic',
        topicDescription: topic?.description || '',
        topicIntent: topic?.intent || '',
        conversationHistory: historyForAI,
        profileContext: retryProfileContext,
        interviewMap: retryInterviewMap,
      }

      const streamGen = streamClaudeResponse(aiOptions)
      for await (const chunk of streamGen) {
        fullResponseText += chunk
        yield chunk
      }
      if (fullResponseText && fullResponseText.trim().length > 0) {
        usedRealStreaming = true
      }
    } catch {
      fullResponseText = ''
    }
  }

  // Fallback to template
  if (!usedRealStreaming) {
    fullResponseText = generateAIResponse(
      topic?.title || 'Unknown Topic',
      topic?.description || '',
      topic?.intent || '',
      historyForAI,
      retryProfileContext,
      retryInterviewMap,
    )
    yield fullResponseText
  }

  // Quick replies and completion
  const quickRepliesArr = await getAIQuickReplies(userMessageCount, fullResponseText, historyForAI)
  const shouldSuggestCompletion = userMessageCount >= 10

  if (shouldSuggestCompletion) {
    const completionNote = '\n\n---\n\n*We\'ve explored many angles together. Feel free to **continue exploring** if there\'s more to uncover, or **finish and distill** to capture your insights.*'
    fullResponseText += completionNote
    yield completionNote
  }

  // Save AI message
  const aiMessageId = crypto.randomUUID()
  ;(db as any).insert(messages).values({
    id: aiMessageId,
    sessionId,
    role: 'assistant',
    content: fullResponseText,
    quickReplies: JSON.stringify(quickRepliesArr),
    suggestsCompletion: shouldSuggestCompletion,
    isBookmarked: false,
    isVoiceInput: false,
  }).returning().get()

  ;(db as any).update(sessions).set({
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, sessionId)).run()

  scheduleSave()
}

/**
 * Get AI-suggested quick replies for a session.
 */
export async function getQuickReplies(
  db: Db,
  sessionId: string,
): Promise<string[]> {
  const session = (db as any).select().from(sessions).where(
    and(eq(sessions.id, sessionId), eq(sessions.userId, LOCAL_USER_ID))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  const conversationHistory = (db as any).select().from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  const historyForAI = conversationHistory.map((m: any) => ({ role: m.role, content: m.content }))
  const userMessageCount = conversationHistory.filter((m: any) => m.role === 'user').length
  const lastAiMessage = conversationHistory.filter((m: any) => m.role === 'assistant').pop()

  return getAIQuickReplies(
    userMessageCount,
    lastAiMessage?.content || '',
    historyForAI,
  )
}

/**
 * Get cross-topic relevance suggestions for a session.
 */
export function getMultiBucketSuggestions(
  db: Db,
  sessionId: string,
): {
  suggestedConnections: Array<{ targetTopicId: string; topicTitle: string; relevanceScore: number }>
  savedTargetIds: string[]
} {
  const session = (db as any).select().from(sessions).where(
    and(eq(sessions.id, sessionId), eq(sessions.userId, LOCAL_USER_ID))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  // Get user messages from this session
  const sessionMessages = (db as any).select().from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
    .orderBy(messages.createdAt)
    .all()

  if (sessionMessages.length === 0) {
    return { suggestedConnections: [], savedTargetIds: [] }
  }

  // Get all other topics
  const otherTopics = (db as any).select().from(topics).where(
    and(eq(topics.userId, LOCAL_USER_ID), ne(topics.id, session.topicId))
  ).all()

  if (otherTopics.length === 0) {
    return { suggestedConnections: [], savedTargetIds: [] }
  }

  // Build content summary from user messages
  const contentSummary = sessionMessages.map((m: any) => m.content).join(' ').toLowerCase()
  const contentWords = contentSummary.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 3)

  const stopWords = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'they', 'will', 'would', 'could', 'should', 'what', 'when', 'where', 'which', 'their', 'about', 'more', 'some', 'very', 'just', 'also', 'than', 'them', 'into', 'most', 'only', 'your', 'like', 'then', 'make', 'over', 'such', 'much', 'know', 'think', 'really', 'things', 'because', 'something'])
  const meaningfulWords = contentWords.filter((w: string) => !stopWords.has(w))

  const wordFreq = new Map<string, number>()
  for (const w of meaningfulWords) {
    wordFreq.set(w, (wordFreq.get(w) || 0) + 1)
  }
  const topKeywords = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word)

  const suggestedConnections: Array<{ targetTopicId: string; topicTitle: string; relevanceScore: number }> = []

  for (const otherTopic of otherTopics) {
    const topicText = `${otherTopic.title} ${otherTopic.description || ''}`.toLowerCase()
    let topicTagsParsed: string[] = []
    if (otherTopic.tags) {
      try {
        let parsed = JSON.parse(otherTopic.tags as string)
        if (typeof parsed === 'string') parsed = JSON.parse(parsed)
        topicTagsParsed = Array.isArray(parsed) ? parsed : []
      } catch { topicTagsParsed = [] }
    }
    const topicTagsLower = topicTagsParsed.map((t: string) => t.toLowerCase())

    let score = 0

    for (const keyword of topKeywords) {
      if (topicText.includes(keyword)) score += 5
    }
    for (const tag of topicTagsLower) {
      if (contentSummary.includes(tag)) score += 10
      for (const keyword of topKeywords) {
        if (tag.includes(keyword) || keyword.includes(tag)) score += 8
      }
    }
    const titleWords = topicText.split(/\s+/).filter((w: string) => w.length > 3 && !stopWords.has(w))
    for (const tw of titleWords) {
      if (contentSummary.includes(tw)) score += 7
    }

    score = Math.min(score, 100)
    if (score >= 15) {
      suggestedConnections.push({
        targetTopicId: otherTopic.id,
        topicTitle: otherTopic.title,
        relevanceScore: score,
      })
    }
  }

  suggestedConnections.sort((a, b) => b.relevanceScore - a.relevanceScore)

  // Check existing connections
  const existingConnections = (db as any).select().from(topicConnections).where(
    or(
      eq(topicConnections.sourceTopicId, session.topicId),
      eq(topicConnections.targetTopicId, session.topicId)
    )
  ).all()

  const savedTargetIds = existingConnections.map((c: any) =>
    c.sourceTopicId === session.topicId ? c.targetTopicId : c.sourceTopicId
  )

  return { suggestedConnections, savedTargetIds }
}

/**
 * Save selected cross-topic connections from multi-bucket suggestions.
 */
export function saveMultiBucketConnections(
  db: Db,
  sessionId: string,
  selectedConnections: Array<{ targetTopicId: string; relevanceScore?: number }>,
): { connections: any[]; count: number } {
  const session = (db as any).select().from(sessions).where(
    and(eq(sessions.id, sessionId), eq(sessions.userId, LOCAL_USER_ID))
  ).get()

  if (!session) {
    throw new Error('Session not found')
  }

  if (!selectedConnections || !Array.isArray(selectedConnections) || selectedConnections.length === 0) {
    throw new Error('selectedConnections array is required')
  }

  const created: any[] = []
  for (const conn of selectedConnections) {
    const { targetTopicId, relevanceScore } = conn

    // Verify target topic
    const targetTopic = (db as any).select().from(topics).where(
      and(eq(topics.id, targetTopicId), eq(topics.userId, LOCAL_USER_ID))
    ).get()
    if (!targetTopic) continue

    // Check for existing connection
    const existing = (db as any).select().from(topicConnections).where(
      or(
        and(eq(topicConnections.sourceTopicId, session.topicId), eq(topicConnections.targetTopicId, targetTopicId)),
        and(eq(topicConnections.sourceTopicId, targetTopicId), eq(topicConnections.targetTopicId, session.topicId))
      )
    ).get()
    if (existing) continue

    const connectionId = crypto.randomUUID()
    const saved = (db as any).insert(topicConnections).values({
      id: connectionId,
      sourceTopicId: session.topicId,
      targetTopicId,
      connectionType: 'multi_bucket',
      relevanceScore: Math.min(Math.max(relevanceScore || 0, 0), 100),
    }).returning().get()

    created.push({ ...saved, targetTopicTitle: targetTopic.title })
  }

  scheduleSave()

  return { connections: created, count: created.length }
}
