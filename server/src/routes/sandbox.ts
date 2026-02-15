import { Router } from 'express';
import { db } from '../config/database.js';
import { insights, users, topics } from '../models/schema.js';
import { eq, and, desc } from 'drizzle-orm';

export const sandboxRouter = Router();

interface ProfileContext {
  userName: string;
  occupation: string;
  location: string;
  communicationStyle: string[];
  toneOfVoice: string[];
  personalTraits: string[];
  strengths: string[];
  decisionPatterns: string[];
}

// Keyword sets for categorizing insights (same as profile.ts)
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  communicationStyle: [
    'communicate', 'communication', 'speak', 'talk', 'write', 'writing',
    'email', 'conversation', 'express', 'tone', 'language', 'word',
    'listen', 'feedback', 'direct', 'indirect', 'formal', 'informal',
    'prefer to say', 'way i', 'style', 'approach to', 'respond',
    'message', 'clarity', 'concise', 'verbose', 'articulate',
  ],
  toneOfVoice: [
    'tone', 'voice', 'humor', 'humour', 'sarcasm', 'sarcastic',
    'serious', 'casual', 'formal', 'warm', 'cold', 'empathetic',
    'blunt', 'diplomatic', 'friendly', 'reserved', 'enthusiastic',
    'calm', 'passionate', 'measured', 'emotional', 'detached',
    'witty', 'dry', 'encouraging', 'supportive', 'critical',
  ],
  personalTraits: [
    'value', 'believe', 'belief', 'core', 'trait', 'identity', 'principle',
    'important to me', 'who i am', 'personality', 'character', 'define',
    'fundamental', 'deeply', 'always', 'never', 'matter', 'care about',
    'passionate', 'driven', 'motivated', 'philosophy', 'worldview',
  ],
  strengths: [
    'strength', 'strong', 'expert', 'expertise', 'skill', 'skilled',
    'good at', 'excel', 'talent', 'ability', 'capable', 'competent',
    'proficient', 'experience', 'knowledge', 'know how', 'specialize',
    'professional', 'craft', 'master', 'accomplish', 'achievement',
  ],
  decisionPatterns: [
    'decide', 'decision', 'choose', 'choice', 'evaluate', 'weigh',
    'consider', 'prioritize', 'priority', 'trade-off', 'tradeoff',
    'framework', 'criteria', 'factor', 'process', 'approach',
    'strategy', 'analyze', 'analysis', 'risk', 'opportunity',
    'gut feeling', 'intuition', 'data-driven', 'rational', 'logic',
  ],
};

function categorizeInsight(content: string): string[] {
  const lowerContent = content.toLowerCase();
  const categories: string[] = [];
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const matchCount = keywords.filter(kw => lowerContent.includes(kw)).length;
    if (matchCount >= 1) {
      categories.push(category);
    }
  }
  return categories;
}

function getProfileContext(userId: string): ProfileContext | null {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return null;

  const verifiedInsights = db.select({
    content: insights.content,
    topicTitle: topics.title,
  }).from(insights)
    .leftJoin(topics, eq(insights.topicId, topics.id))
    .where(
      and(
        eq(insights.userId, userId),
        eq(insights.verificationStatus, 'verified')
      )
    )
    .orderBy(desc(insights.confidenceScore))
    .all();

  const categorized: Record<string, string[]> = {
    communicationStyle: [],
    toneOfVoice: [],
    personalTraits: [],
    strengths: [],
    decisionPatterns: [],
  };

  for (const insight of verifiedInsights) {
    const cats = categorizeInsight(insight.content);
    for (const cat of cats) {
      if (categorized[cat] && categorized[cat].length < 5) {
        categorized[cat].push(insight.content);
      }
    }
  }

  return {
    userName: user.name,
    occupation: user.occupation || '',
    location: user.location || '',
    communicationStyle: categorized.communicationStyle,
    toneOfVoice: categorized.toneOfVoice,
    personalTraits: categorized.personalTraits,
    strengths: categorized.strengths,
    decisionPatterns: categorized.decisionPatterns,
  };
}

// Generate a generic response to a prompt (no personal context)
function generateGenericResponse(prompt: string): string {
  const lowerPrompt = prompt.toLowerCase();

  if (lowerPrompt.includes('email') && lowerPrompt.includes('declin')) {
    return `Subject: Regarding the Upcoming Meeting

Dear [Name],

Thank you for the invitation to the meeting. Unfortunately, I will not be able to attend due to a scheduling conflict.

I apologize for any inconvenience this may cause. If there are any materials or notes from the meeting that I should review, please feel free to share them with me afterward.

Please let me know if there's anything else I can help with.

Best regards,
[Your Name]`;
  }

  if (lowerPrompt.includes('email') && (lowerPrompt.includes('thank') || lowerPrompt.includes('appreciation'))) {
    return `Subject: Thank You

Dear [Name],

I wanted to take a moment to express my gratitude for your help with [topic]. Your assistance was greatly appreciated.

Thank you for your time and effort.

Best regards,
[Your Name]`;
  }

  if (lowerPrompt.includes('introduce') || lowerPrompt.includes('introduction')) {
    return `Hello,

My name is [Your Name]. I work as a [Job Title] and I'm interested in [topic]. I have experience in various areas and am always looking to learn more.

I look forward to connecting with you.

Best regards,
[Your Name]`;
  }

  if (lowerPrompt.includes('feedback') || lowerPrompt.includes('review')) {
    return `Thank you for sharing this with me. Here are my thoughts:

Overall, the work is solid. There are a few areas that could be improved:

1. Consider adding more detail to the main sections
2. The structure could be reorganized for better flow
3. Some points could benefit from additional examples

I hope this feedback is helpful. Let me know if you'd like to discuss any of these points further.`;
  }

  if (lowerPrompt.includes('explain') || lowerPrompt.includes('describe')) {
    return `Here's an explanation:

The topic you're asking about involves several key aspects. At its core, it relates to how different components work together to achieve a desired outcome.

The main points to understand are:
1. The foundational concepts that underpin the topic
2. How these concepts are applied in practice
3. The common challenges and how to address them

If you need more specific information about any aspect, please let me know.`;
  }

  if (lowerPrompt.includes('plan') || lowerPrompt.includes('strategy')) {
    return `Here's a suggested plan:

Phase 1: Research and Analysis
- Gather relevant information
- Identify key stakeholders
- Assess current state

Phase 2: Planning
- Define clear objectives
- Set measurable milestones
- Allocate resources

Phase 3: Implementation
- Execute according to plan
- Monitor progress regularly
- Make adjustments as needed

Phase 4: Review
- Evaluate outcomes
- Document lessons learned
- Plan next steps`;
  }

  // Default generic response
  return `Here's my response to your prompt:

I've considered your request carefully. Here are some thoughts:

The key points to address are:
1. Understanding the core requirements
2. Identifying the best approach
3. Executing with attention to detail

This is a straightforward approach that should work for most situations. Let me know if you need anything more specific.

Best regards,
[Your Name]`;
}

// Generate a personalized response incorporating user context
function generatePersonalizedResponse(prompt: string, context: ProfileContext): string {
  const lowerPrompt = prompt.toLowerCase();
  const name = context.userName || 'there';

  // Build style descriptors from verified insights
  const styleHints: string[] = [];
  if (context.communicationStyle.length > 0) {
    styleHints.push(...context.communicationStyle.slice(0, 2));
  }
  if (context.toneOfVoice.length > 0) {
    styleHints.push(...context.toneOfVoice.slice(0, 2));
  }

  // Determine tone from insights
  const allInsights = [
    ...context.communicationStyle,
    ...context.toneOfVoice,
    ...context.personalTraits,
  ].join(' ').toLowerCase();

  const isFormal = allInsights.includes('formal') || allInsights.includes('professional');
  const isDirect = allInsights.includes('direct') || allInsights.includes('concise') || allInsights.includes('blunt');
  const isWarm = allInsights.includes('warm') || allInsights.includes('friendly') || allInsights.includes('empathetic');
  const isAnalytical = allInsights.includes('analytical') || allInsights.includes('data-driven') || allInsights.includes('logical');

  const occupation = context.occupation ? ` (${context.occupation})` : '';
  const location = context.location ? ` based in ${context.location}` : '';

  if (lowerPrompt.includes('email') && lowerPrompt.includes('declin')) {
    if (isDirect) {
      return `Subject: Can't Make the Meeting

Hi [Name],

I need to pass on this meeting - I've got a conflict I can't move.

${context.personalTraits.length > 0 ? `I value being straightforward about scheduling, so I wanted to let you know right away rather than leaving you hanging.` : `I wanted to let you know as soon as possible so you can adjust plans accordingly.`}

Happy to catch up on any key takeaways afterward, or we can find 15 minutes to sync separately if needed.

${isWarm ? `Appreciate you thinking of me for this!` : `Thanks for understanding.`}

${name}${occupation}`;
    }

    if (isWarm) {
      return `Subject: So Sorry - Can't Make It to the Meeting

Hi [Name],

I really appreciate the invite, and I'm genuinely sorry I won't be able to join this time - I have a commitment I can't reschedule.

${context.personalTraits.length > 0 ? `You know how much I value our collaboration, so please know this isn't a reflection of the importance of the discussion.` : `Please know I'm still very interested in the topic and would love to stay in the loop.`}

Would you mind sharing the notes afterward? And if there's anything you'd like my input on beforehand, I'm happy to share my thoughts async.

Looking forward to the next one!

Warmly,
${name}${location ? `\n${location}` : ''}`;
    }

    // Default personalized decline
    return `Subject: Regrets - Unable to Attend

Hi [Name],

Thanks for the meeting invitation. Unfortunately, I have a scheduling conflict and won't be able to make it.

${context.communicationStyle.length > 0
  ? `Based on how I typically like to stay aligned with my team: could you share the key outcomes or action items? I want to make sure I'm up to speed.`
  : `I'd appreciate if you could share any key outcomes or decisions from the meeting so I can stay aligned.`}

${context.strengths.length > 0
  ? `If there's a specific area where my perspective would be particularly valuable, I'm happy to provide written input ahead of time.`
  : `Let me know if there's anything I can contribute asynchronously.`}

Best,
${name}${occupation}`;
  }

  if (lowerPrompt.includes('email') && (lowerPrompt.includes('thank') || lowerPrompt.includes('appreciation'))) {
    return `Subject: Genuinely Grateful

Hi [Name],

I wanted to reach out personally to say thank you for your help with [topic].

${isWarm ? `It really means a lot to me, and I don't want that to get lost in the shuffle of busy days.` : `Your contribution made a real difference.`}

${context.personalTraits.length > 0
  ? `${context.personalTraits[0]} - and your support here aligns perfectly with what I value most in a colleague.`
  : `Your willingness to go above and beyond didn't go unnoticed.`}

${isDirect ? `You made a real impact. Thank you.` : `I truly appreciate your time and effort, and I look forward to returning the favor.`}

${isWarm ? 'Warmly,' : 'Best,'}
${name}${occupation}`;
  }

  if (lowerPrompt.includes('introduce') || lowerPrompt.includes('introduction')) {
    return `Hi there!

I'm ${name}${occupation ? `, a ${context.occupation}` : ''}${location}.

${context.personalTraits.length > 0
  ? `What drives me: ${context.personalTraits[0]}`
  : `I'm passionate about meaningful work and continuous growth.`}

${context.strengths.length > 0
  ? `My sweet spot is ${context.strengths[0].toLowerCase()}.`
  : `I bring a blend of analytical thinking and creative problem-solving.`}

${context.communicationStyle.length > 0
  ? `When it comes to working together, here's what you should know about me: ${context.communicationStyle[0]}`
  : `I believe in clear communication and collaborative problem-solving.`}

${isWarm ? `I\'d love to connect and learn more about what you do!` : `Looking forward to connecting.`}

${name}`;
  }

  if (lowerPrompt.includes('feedback') || lowerPrompt.includes('review')) {
    return `Here are my thoughts:

${isDirect
  ? `I'll cut straight to it - here's what stands out:`
  : isWarm
    ? `I've gone through this carefully, and I want to start by saying there's a lot of good work here.`
    : `I've reviewed this thoroughly. Here's my assessment:`}

${isAnalytical
  ? `**Strengths:**
- [Specific strong points]

**Areas for improvement:**
- [Specific suggestions with rationale]

**Recommendation:** [Clear next step]`
  : `What's working well:
- [Positive aspects]

Where I see opportunity:
- [Constructive suggestions]

${context.decisionPatterns.length > 0
  ? `My recommendation, based on how I typically evaluate these things: ${context.decisionPatterns[0].toLowerCase()}`
  : `My overall take: focus on the highest-impact changes first.`}`}

${isWarm ? `Happy to discuss any of this in more detail - always enjoy a good brainstorm!` : `Let me know if you'd like to dig deeper into any of these points.`}

${name}`;
  }

  // Default personalized response
  return `Here's my take on this:

${context.personalTraits.length > 0
  ? `Coming from my perspective - ${context.personalTraits[0].toLowerCase()} - here's how I see it:`
  : `Based on my experience, here's how I'd approach this:`}

${isDirect
  ? `The key points:
1. [Most important consideration]
2. [Second priority]
3. [Action item]`
  : isAnalytical
    ? `Let me break this down systematically:

**Context:** [Background]
**Analysis:** [Key factors]
**Recommendation:** [Suggested approach]
**Next steps:** [Actionable items]`
    : `I've thought about this from a few angles:

- First, consider [main point]
- Building on that, [secondary point]
- And practically speaking, [action item]`}

${context.strengths.length > 0
  ? `\nDrawing on my experience in ${context.strengths[0].toLowerCase()}, I'd particularly emphasize the importance of [relevant aspect].`
  : ''}

${isWarm
  ? `\nHope this helps! Always happy to chat more about it.`
  : isDirect
    ? `\nLet me know if you need anything else.`
    : `\nFeel free to reach out if you'd like to discuss further.`}

${name}${occupation}`;
}

// POST /api/sandbox/compare - Generate side-by-side comparison
sandboxRouter.post('/compare', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { prompt } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const trimmedPrompt = prompt.trim();

    // Get user's profile context from verified insights
    const context = getProfileContext(userId);

    // Generate generic response (no context)
    const genericOutput = generateGenericResponse(trimmedPrompt);

    // Generate personalized response (with context)
    let personalizedOutput: string;
    if (context && (
      context.communicationStyle.length > 0 ||
      context.toneOfVoice.length > 0 ||
      context.personalTraits.length > 0 ||
      context.strengths.length > 0
    )) {
      personalizedOutput = generatePersonalizedResponse(trimmedPrompt, context);
    } else {
      // If no verified insights yet, explain that context is needed
      personalizedOutput = `*Your me.md profile doesn't have enough verified insights yet to personalize this response.*\n\nTo see the difference context makes:\n1. Complete some interview sessions to generate insights\n2. Verify those insights in the Verification Queue\n3. Come back here to see how your verified context transforms generic outputs\n\nOnce you have verified insights about your communication style, tone, values, and strengths, this side will show a response that truly sounds like you.`;
    }

    res.json({
      prompt: trimmedPrompt,
      genericOutput,
      personalizedOutput,
      hasContext: !!(context && (
        context.communicationStyle.length > 0 ||
        context.toneOfVoice.length > 0 ||
        context.personalTraits.length > 0 ||
        context.strengths.length > 0
      )),
      contextSummary: context ? {
        communicationInsights: context.communicationStyle.length,
        toneInsights: context.toneOfVoice.length,
        personalTraits: context.personalTraits.length,
        strengths: context.strengths.length,
        decisionPatterns: context.decisionPatterns.length,
      } : null,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sandbox compare error:', error);
    res.status(500).json({ error: 'Failed to generate comparison' });
  }
});

// GET /api/sandbox/context-status - Check if user has enough context
sandboxRouter.get('/context-status', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const context = getProfileContext(userId);
    const totalInsights = context ? (
      context.communicationStyle.length +
      context.toneOfVoice.length +
      context.personalTraits.length +
      context.strengths.length +
      context.decisionPatterns.length
    ) : 0;

    res.json({
      hasContext: totalInsights > 0,
      totalCategorizedInsights: totalInsights,
      categories: context ? {
        communicationStyle: context.communicationStyle.length,
        toneOfVoice: context.toneOfVoice.length,
        personalTraits: context.personalTraits.length,
        strengths: context.strengths.length,
        decisionPatterns: context.decisionPatterns.length,
      } : null,
    });
  } catch (error) {
    console.error('Sandbox context status error:', error);
    res.status(500).json({ error: 'Failed to get context status' });
  }
});
