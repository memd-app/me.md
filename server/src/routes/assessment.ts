import { Router } from 'express';
import { db } from '../config/database.js';
import { assessmentAttempts, assessmentAnswers, assessmentResults, insights, topics, notes } from '../models/schema.js';
import { eq, and, desc, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import bigFiveService from '../services/bigfive.js';
import type { BigFiveAnswer } from '../services/bigfive.js';
import { generatePersonalityInsights, storePersonalityInsights, generateChangeInsights } from '../services/personalityInsights.js';

export const assessmentRouter = Router();

// ============================================
// POST /api/assessment/start
// ============================================
// Creates a new assessment attempt for the authenticated user.
// Returns the attempt_id and the first batch of questions.
assessmentRouter.post('/start', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { language } = req.body || {};
    const lang = language || 'en';

    // Create a new assessment attempt
    const attemptId = uuidv4();
    db.insert(assessmentAttempts).values({
      id: attemptId,
      userId,
      status: 'in_progress',
    }).run();

    // Get the questions for the test
    const questions = bigFiveService.getQuestionsList(lang);
    const testInfo = bigFiveService.getTestInfo();

    res.status(201).json({
      attemptId,
      status: 'in_progress',
      testInfo: {
        name: testInfo.name,
        totalQuestions: testInfo.questions,
        estimatedMinutes: testInfo.time,
      },
      questions,
    });
  } catch (err: any) {
    console.error('[me.md:assessment] Error starting assessment:', err.message);
    res.status(500).json({ error: 'Failed to start assessment' });
  }
});

// ============================================
// POST /api/assessment/:attemptId/answers
// ============================================
// Saves a batch of answers for an in-progress assessment.
// Supports partial saves so progress is not lost.
assessmentRouter.post('/:attemptId/answers', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { attemptId } = req.params;
    const { answers } = req.body;

    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      res.status(400).json({ error: 'Answers must be a non-empty array' });
      return;
    }

    // Verify the attempt belongs to this user and is still in progress
    const attempt = db.select()
      .from(assessmentAttempts)
      .where(and(
        eq(assessmentAttempts.id, attemptId),
        eq(assessmentAttempts.userId, userId),
      ))
      .get();

    if (!attempt) {
      res.status(404).json({ error: 'Assessment attempt not found' });
      return;
    }

    if (attempt.status === 'completed') {
      res.status(400).json({ error: 'Assessment already completed. Cannot submit more answers.' });
      return;
    }

    // Validate and save each answer
    const savedAnswers: Array<{ id: string; questionId: string; answerValue: number }> = [];

    for (const answer of answers) {
      const { questionId, answerValue } = answer;

      if (!questionId || typeof questionId !== 'string') {
        res.status(400).json({ error: 'Each answer must have a valid questionId string' });
        return;
      }

      if (typeof answerValue !== 'number' || answerValue < 1 || answerValue > 5) {
        res.status(400).json({ error: `Invalid answerValue for question ${questionId}. Must be 1-5.` });
        return;
      }

      // Upsert: check if answer already exists for this question in this attempt
      const existing = db.select()
        .from(assessmentAnswers)
        .where(and(
          eq(assessmentAnswers.attemptId, attemptId),
          eq(assessmentAnswers.questionId, questionId),
        ))
        .get();

      if (existing) {
        // Update existing answer
        db.update(assessmentAnswers)
          .set({ answerValue, answeredAt: new Date().toISOString() })
          .where(eq(assessmentAnswers.id, existing.id))
          .run();
        savedAnswers.push({ id: existing.id, questionId, answerValue });
      } else {
        // Insert new answer
        const answerId = uuidv4();
        db.insert(assessmentAnswers).values({
          id: answerId,
          attemptId,
          questionId,
          answerValue,
        }).run();
        savedAnswers.push({ id: answerId, questionId, answerValue });
      }
    }

    // Get total answer count for this attempt
    const totalAnswered = db.select()
      .from(assessmentAnswers)
      .where(eq(assessmentAnswers.attemptId, attemptId))
      .all().length;

    const testInfo = bigFiveService.getTestInfo();

    res.json({
      saved: savedAnswers.length,
      totalAnswered,
      totalQuestions: testInfo.questions,
      progress: Math.round((totalAnswered / testInfo.questions) * 100),
    });
  } catch (err: any) {
    console.error('[me.md:assessment] Error saving answers:', err.message);
    res.status(500).json({ error: 'Failed to save answers' });
  }
});

// ============================================
// POST /api/assessment/:attemptId/complete
// ============================================
// Finalizes the test: validates all questions answered, calculates scores, stores results.
assessmentRouter.post('/:attemptId/complete', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { attemptId } = req.params;
    const { language } = req.body || {};
    const lang = language || 'en';

    // Verify the attempt belongs to this user
    const attempt = db.select()
      .from(assessmentAttempts)
      .where(and(
        eq(assessmentAttempts.id, attemptId),
        eq(assessmentAttempts.userId, userId),
      ))
      .get();

    if (!attempt) {
      res.status(404).json({ error: 'Assessment attempt not found' });
      return;
    }

    if (attempt.status === 'completed') {
      res.status(400).json({ error: 'Assessment already completed' });
      return;
    }

    // Get all answers for this attempt
    const allAnswers = db.select()
      .from(assessmentAnswers)
      .where(eq(assessmentAnswers.attemptId, attemptId))
      .all();

    const testInfo = bigFiveService.getTestInfo();

    if (allAnswers.length < testInfo.questions) {
      res.status(400).json({
        error: `Not all questions answered. Answered: ${allAnswers.length}/${testInfo.questions}`,
        answered: allAnswers.length,
        required: testInfo.questions,
      });
      return;
    }

    // Map stored answers to the format expected by the bigfive service
    // We need to match questionId back to question metadata (domain, facet)
    const questions = bigFiveService.getQuestionsList(lang);
    const questionMap = new Map<string, { domain: string; facet: number }>();
    for (const q of questions) {
      questionMap.set(q.id, { domain: q.domain, facet: q.facet });
    }

    const bigFiveAnswers: BigFiveAnswer[] = [];
    for (const answer of allAnswers) {
      const qMeta = questionMap.get(answer.questionId);
      if (!qMeta) {
        console.warn(`[me.md:assessment] Unknown questionId: ${answer.questionId}`);
        continue;
      }
      bigFiveAnswers.push({
        domain: qMeta.domain,
        facet: String(qMeta.facet),
        score: answer.answerValue,
      });
    }

    // Calculate scores and get descriptive text
    const { scores, results: resultText } = bigFiveService.processTest(bigFiveAnswers, lang);

    // Store results in the database (one row per domain)
    for (const domainResult of resultText) {
      const domainKey = domainResult.domain;
      const domainScoreData = scores[domainKey];

      if (!domainScoreData) continue;

      const facetScores = domainScoreData.facet || {};

      db.insert(assessmentResults).values({
        id: uuidv4(),
        attemptId,
        domain: domainKey,
        domainScore: domainScoreData.score,
        facet1Score: facetScores['1']?.score ?? null,
        facet2Score: facetScores['2']?.score ?? null,
        facet3Score: facetScores['3']?.score ?? null,
        facet4Score: facetScores['4']?.score ?? null,
        facet5Score: facetScores['5']?.score ?? null,
        facet6Score: facetScores['6']?.score ?? null,
      }).run();
    }

    // Mark attempt as completed
    db.update(assessmentAttempts)
      .set({
        status: 'completed',
        completedAt: new Date().toISOString(),
      })
      .where(eq(assessmentAttempts.id, attemptId))
      .run();

    // Build domain scores data for the response and insight generation
    const domainScoresData = resultText.map(d => {
      const domainKey = d.domain;
      const domainScoreData = scores[domainKey];
      const facetScores = domainScoreData?.facet || {};
      return {
        domain: domainKey,
        domainScore: domainScoreData?.score || 0,
        facetScores: {
          facet1: facetScores['1']?.score ?? null,
          facet2: facetScores['2']?.score ?? null,
          facet3: facetScores['3']?.score ?? null,
          facet4: facetScores['4']?.score ?? null,
          facet5: facetScores['5']?.score ?? null,
          facet6: facetScores['6']?.score ?? null,
        },
      };
    });

    // Fire off AI personality insight generation asynchronously (non-blocking)
    generatePersonalityInsights(userId, attemptId, domainScoresData, resultText)
      .then(insightsResult => {
        if (insightsResult.generated && insightsResult.insights.length > 0) {
          const stored = storePersonalityInsights(userId, attemptId, insightsResult);
          console.log(`[me.md:assessment] Personality insights generated and stored: ${stored.insightIds.length} insights, note ${stored.noteId}`);
        } else {
          console.log('[me.md:assessment] No personality insights generated (AI unavailable or empty result)');
        }
      })
      .catch(err => {
        console.error('[me.md:assessment] Error in async personality insight generation:', err.message);
      });

    res.json({
      attemptId,
      status: 'completed',
      completedAt: new Date().toISOString(),
      scores: resultText.map(d => ({
        domain: d.domain,
        title: d.title,
        score: d.score,
        scoreText: d.scoreText,
        shortDescription: d.shortDescription,
      })),
      fullResults: resultText,
    });
  } catch (err: any) {
    console.error('[me.md:assessment] Error completing assessment:', err.message);
    res.status(500).json({ error: 'Failed to complete assessment' });
  }
});

// ============================================
// GET /api/assessment/history
// ============================================
// Returns all past attempts for the user with completion dates and summary scores.
assessmentRouter.get('/history', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Get all attempts for this user, ordered by most recent first
    const attempts = db.select()
      .from(assessmentAttempts)
      .where(eq(assessmentAttempts.userId, userId))
      .orderBy(desc(assessmentAttempts.startedAt))
      .all();

    // For each attempt, get summary scores
    const history = attempts.map(attempt => {
      const results = db.select()
        .from(assessmentResults)
        .where(eq(assessmentResults.attemptId, attempt.id))
        .all();

      const domainScores = results.map(r => ({
        domain: r.domain,
        score: r.domainScore,
        facetScores: {
          facet1: r.facet1Score,
          facet2: r.facet2Score,
          facet3: r.facet3Score,
          facet4: r.facet4Score,
          facet5: r.facet5Score,
          facet6: r.facet6Score,
        },
      }));

      // Get answer count for progress tracking
      const answerCount = db.select()
        .from(assessmentAnswers)
        .where(eq(assessmentAnswers.attemptId, attempt.id))
        .all().length;

      return {
        attemptId: attempt.id,
        status: attempt.status,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
        answeredQuestions: answerCount,
        domainScores,
      };
    });

    res.json({ history });
  } catch (err: any) {
    console.error('[me.md:assessment] Error fetching history:', err.message);
    res.status(500).json({ error: 'Failed to fetch assessment history' });
  }
});

// ============================================
// GET /api/assessment/latest
// ============================================
// Returns the most recent completed assessment results.
assessmentRouter.get('/latest', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { language } = req.query;
    const lang = (language as string) || 'en';

    // Get the most recent completed attempt
    const latestAttempt = db.select()
      .from(assessmentAttempts)
      .where(and(
        eq(assessmentAttempts.userId, userId),
        eq(assessmentAttempts.status, 'completed'),
      ))
      .orderBy(desc(assessmentAttempts.completedAt))
      .limit(1)
      .get();

    if (!latestAttempt) {
      res.status(404).json({ error: 'No completed assessment found' });
      return;
    }

    // Get stored results
    const storedResults = db.select()
      .from(assessmentResults)
      .where(eq(assessmentResults.attemptId, latestAttempt.id))
      .all();

    // Reconstruct scores for result text generation
    const scores: Record<string, any> = {};
    for (const r of storedResults) {
      scores[r.domain] = {
        score: r.domainScore,
        count: 24, // Each domain has 24 questions in the 120-item test
        result: r.domainScore > 3 ? 'high' : r.domainScore < 3 ? 'low' : 'neutral',
        facet: {
          '1': { score: r.facet1Score ?? 0, count: 4, result: (r.facet1Score ?? 0) > 3 ? 'high' : (r.facet1Score ?? 0) < 3 ? 'low' : 'neutral' },
          '2': { score: r.facet2Score ?? 0, count: 4, result: (r.facet2Score ?? 0) > 3 ? 'high' : (r.facet2Score ?? 0) < 3 ? 'low' : 'neutral' },
          '3': { score: r.facet3Score ?? 0, count: 4, result: (r.facet3Score ?? 0) > 3 ? 'high' : (r.facet3Score ?? 0) < 3 ? 'low' : 'neutral' },
          '4': { score: r.facet4Score ?? 0, count: 4, result: (r.facet4Score ?? 0) > 3 ? 'high' : (r.facet4Score ?? 0) < 3 ? 'low' : 'neutral' },
          '5': { score: r.facet5Score ?? 0, count: 4, result: (r.facet5Score ?? 0) > 3 ? 'high' : (r.facet5Score ?? 0) < 3 ? 'low' : 'neutral' },
          '6': { score: r.facet6Score ?? 0, count: 4, result: (r.facet6Score ?? 0) > 3 ? 'high' : (r.facet6Score ?? 0) < 3 ? 'low' : 'neutral' },
        },
      };
    }

    // Generate descriptive text from stored scores
    let resultText: any[] = [];
    try {
      resultText = bigFiveService.getResultText(scores, lang);
    } catch (e: any) {
      console.warn('[me.md:assessment] Could not generate result text:', e.message);
    }

    res.json({
      attemptId: latestAttempt.id,
      status: latestAttempt.status,
      startedAt: latestAttempt.startedAt,
      completedAt: latestAttempt.completedAt,
      domainScores: storedResults.map(r => ({
        domain: r.domain,
        domainScore: r.domainScore,
        facetScores: {
          facet1: r.facet1Score,
          facet2: r.facet2Score,
          facet3: r.facet3Score,
          facet4: r.facet4Score,
          facet5: r.facet5Score,
          facet6: r.facet6Score,
        },
      })),
      results: resultText,
    });
  } catch (err: any) {
    console.error('[me.md:assessment] Error fetching latest results:', err.message);
    res.status(500).json({ error: 'Failed to fetch latest assessment results' });
  }
});

// ============================================
// GET /api/assessment/:attemptId/results
// ============================================
// Returns full results (domain scores, facet scores, result text) for a completed attempt.
assessmentRouter.get('/:attemptId/results', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { attemptId } = req.params;
    const { language } = req.query;
    const lang = (language as string) || 'en';

    // Verify the attempt belongs to this user
    const attempt = db.select()
      .from(assessmentAttempts)
      .where(and(
        eq(assessmentAttempts.id, attemptId),
        eq(assessmentAttempts.userId, userId),
      ))
      .get();

    if (!attempt) {
      res.status(404).json({ error: 'Assessment attempt not found' });
      return;
    }

    if (attempt.status !== 'completed') {
      res.status(400).json({ error: 'Assessment not yet completed' });
      return;
    }

    // Get stored results
    const storedResults = db.select()
      .from(assessmentResults)
      .where(eq(assessmentResults.attemptId, attemptId))
      .all();

    // Reconstruct scores for result text generation
    const scores: Record<string, any> = {};
    for (const r of storedResults) {
      scores[r.domain] = {
        score: r.domainScore,
        count: 24,
        result: r.domainScore > 3 ? 'high' : r.domainScore < 3 ? 'low' : 'neutral',
        facet: {
          '1': { score: r.facet1Score ?? 0, count: 4, result: (r.facet1Score ?? 0) > 3 ? 'high' : (r.facet1Score ?? 0) < 3 ? 'low' : 'neutral' },
          '2': { score: r.facet2Score ?? 0, count: 4, result: (r.facet2Score ?? 0) > 3 ? 'high' : (r.facet2Score ?? 0) < 3 ? 'low' : 'neutral' },
          '3': { score: r.facet3Score ?? 0, count: 4, result: (r.facet3Score ?? 0) > 3 ? 'high' : (r.facet3Score ?? 0) < 3 ? 'low' : 'neutral' },
          '4': { score: r.facet4Score ?? 0, count: 4, result: (r.facet4Score ?? 0) > 3 ? 'high' : (r.facet4Score ?? 0) < 3 ? 'low' : 'neutral' },
          '5': { score: r.facet5Score ?? 0, count: 4, result: (r.facet5Score ?? 0) > 3 ? 'high' : (r.facet5Score ?? 0) < 3 ? 'low' : 'neutral' },
          '6': { score: r.facet6Score ?? 0, count: 4, result: (r.facet6Score ?? 0) > 3 ? 'high' : (r.facet6Score ?? 0) < 3 ? 'low' : 'neutral' },
        },
      };
    }

    // Generate descriptive text from stored scores
    let resultText: any[] = [];
    try {
      resultText = bigFiveService.getResultText(scores, lang);
    } catch (e: any) {
      console.warn('[me.md:assessment] Could not generate result text:', e.message);
    }

    // Fetch AI-generated personality insights for this attempt
    let aiInsights: any[] = [];
    let aiAgreements: string[] = [];
    let aiContradictions: string[] = [];

    try {
      // Look for the assessment topic and note associated with this attempt
      const assessmentTopic = db.select()
        .from(topics)
        .where(
          and(
            eq(topics.userId, userId),
            eq(topics.title, 'Big Five Personality Assessment'),
          )
        )
        .get();

      if (assessmentTopic) {
        // Find the note for this attempt (sessionId stores attemptId)
        const assessmentNote = db.select()
          .from(notes)
          .where(
            and(
              eq(notes.sessionId, attemptId),
              eq(notes.topicId, assessmentTopic.id),
              eq(notes.userId, userId),
            )
          )
          .get();

        if (assessmentNote) {
          // Get insights linked to this note
          const noteInsights = db.select()
            .from(insights)
            .where(
              and(
                eq(insights.noteId, assessmentNote.id),
                eq(insights.userId, userId),
              )
            )
            .all();

          aiInsights = noteInsights.map(i => ({
            id: i.id,
            content: i.content,
            confidenceScore: i.confidenceScore,
            verificationStatus: i.verificationStatus,
            extractionMethod: i.extractionMethod,
          }));

          // Parse agreements/contradictions from the full analysis text
          if (assessmentNote.contentFullAnalysis) {
            const fullAnalysis = assessmentNote.contentFullAnalysis;

            // Extract agreements
            const agreementsMatch = fullAnalysis.match(/## Agreements with Interview Insights\n([\s\S]*?)(?=\n##|$)/);
            if (agreementsMatch) {
              aiAgreements = agreementsMatch[1]
                .split('\n')
                .filter((l: string) => l.startsWith('- '))
                .map((l: string) => l.replace(/^- /, '').trim());
            }

            // Extract contradictions
            const contradictionsMatch = fullAnalysis.match(/## Contradictions with Interview Insights\n([\s\S]*?)(?=\n##|$)/);
            if (contradictionsMatch) {
              aiContradictions = contradictionsMatch[1]
                .split('\n')
                .filter((l: string) => l.startsWith('- '))
                .map((l: string) => l.replace(/^- (⚠️ )?/, '').trim());
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('[me.md:assessment] Could not fetch AI insights:', e.message);
    }

    res.json({
      attemptId: attempt.id,
      status: attempt.status,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      domainScores: storedResults.map(r => ({
        domain: r.domain,
        domainScore: r.domainScore,
        facetScores: {
          facet1: r.facet1Score,
          facet2: r.facet2Score,
          facet3: r.facet3Score,
          facet4: r.facet4Score,
          facet5: r.facet5Score,
          facet6: r.facet6Score,
        },
      })),
      results: resultText,
      aiAnalysis: {
        insights: aiInsights,
        agreements: aiAgreements,
        contradictions: aiContradictions,
        generated: aiInsights.length > 0,
      },
    });
  } catch (err: any) {
    console.error('[me.md:assessment] Error fetching results:', err.message);
    res.status(500).json({ error: 'Failed to fetch assessment results' });
  }
});

// ============================================
// POST /api/assessment/:attemptId/generate-insights
// ============================================
// Manually trigger AI insight generation for a completed attempt.
// Useful if the automatic generation on completion failed or wasn't available.
assessmentRouter.post('/:attemptId/generate-insights', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { attemptId } = req.params;
    const { language } = req.body || {};
    const lang = language || 'en';

    // Verify the attempt belongs to this user and is completed
    const attempt = db.select()
      .from(assessmentAttempts)
      .where(and(
        eq(assessmentAttempts.id, attemptId),
        eq(assessmentAttempts.userId, userId),
      ))
      .get();

    if (!attempt) {
      res.status(404).json({ error: 'Assessment attempt not found' });
      return;
    }

    if (attempt.status !== 'completed') {
      res.status(400).json({ error: 'Assessment not yet completed' });
      return;
    }

    // Get stored results
    const storedResults = db.select()
      .from(assessmentResults)
      .where(eq(assessmentResults.attemptId, attemptId))
      .all();

    if (storedResults.length === 0) {
      res.status(400).json({ error: 'No results found for this attempt' });
      return;
    }

    // Reconstruct domain scores data
    const domainScoresData = storedResults.map(r => ({
      domain: r.domain,
      domainScore: r.domainScore,
      facetScores: {
        facet1: r.facet1Score,
        facet2: r.facet2Score,
        facet3: r.facet3Score,
        facet4: r.facet4Score,
        facet5: r.facet5Score,
        facet6: r.facet6Score,
      },
    }));

    // Reconstruct scores for result text generation
    const scores: Record<string, any> = {};
    for (const r of storedResults) {
      scores[r.domain] = {
        score: r.domainScore,
        count: 24,
        result: r.domainScore > 3 ? 'high' : r.domainScore < 3 ? 'low' : 'neutral',
        facet: {
          '1': { score: r.facet1Score ?? 0, count: 4, result: (r.facet1Score ?? 0) > 3 ? 'high' : (r.facet1Score ?? 0) < 3 ? 'low' : 'neutral' },
          '2': { score: r.facet2Score ?? 0, count: 4, result: (r.facet2Score ?? 0) > 3 ? 'high' : (r.facet2Score ?? 0) < 3 ? 'low' : 'neutral' },
          '3': { score: r.facet3Score ?? 0, count: 4, result: (r.facet3Score ?? 0) > 3 ? 'high' : (r.facet3Score ?? 0) < 3 ? 'low' : 'neutral' },
          '4': { score: r.facet4Score ?? 0, count: 4, result: (r.facet4Score ?? 0) > 3 ? 'high' : (r.facet4Score ?? 0) < 3 ? 'low' : 'neutral' },
          '5': { score: r.facet5Score ?? 0, count: 4, result: (r.facet5Score ?? 0) > 3 ? 'high' : (r.facet5Score ?? 0) < 3 ? 'low' : 'neutral' },
          '6': { score: r.facet6Score ?? 0, count: 4, result: (r.facet6Score ?? 0) > 3 ? 'high' : (r.facet6Score ?? 0) < 3 ? 'low' : 'neutral' },
        },
      };
    }

    let resultText: any[] = [];
    try {
      resultText = bigFiveService.getResultText(scores, lang);
    } catch (e: any) {
      console.warn('[me.md:assessment] Could not generate result text:', e.message);
    }

    // Generate insights
    const insightsResult = await generatePersonalityInsights(userId, attemptId, domainScoresData, resultText);

    if (!insightsResult.generated || insightsResult.insights.length === 0) {
      res.status(503).json({ error: 'AI insight generation unavailable or returned no results' });
      return;
    }

    // Store insights
    const stored = storePersonalityInsights(userId, attemptId, insightsResult);

    res.json({
      message: 'Personality insights generated successfully',
      insightCount: insightsResult.insights.length,
      noteId: stored.noteId,
      insightIds: stored.insightIds,
      agreements: insightsResult.agreements,
      contradictions: insightsResult.contradictions,
    });
  } catch (err: any) {
    console.error('[me.md:assessment] Error generating insights:', err.message);
    res.status(500).json({ error: 'Failed to generate personality insights' });
  }
});

// ============================================
// GET /api/assessment/compare
// ============================================
// Compare two assessment attempts side-by-side.
// Query params: attemptA, attemptB (attempt IDs)
assessmentRouter.get('/compare', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { attemptA, attemptB } = req.query;
    if (!attemptA || !attemptB) {
      res.status(400).json({ error: 'Both attemptA and attemptB query parameters are required' });
      return;
    }

    // Verify both attempts belong to user and are completed
    const getAttemptWithResults = (attemptId: string) => {
      const attempt = db.select()
        .from(assessmentAttempts)
        .where(and(
          eq(assessmentAttempts.id, attemptId),
          eq(assessmentAttempts.userId, userId),
          eq(assessmentAttempts.status, 'completed'),
        ))
        .get();

      if (!attempt) return null;

      const results = db.select()
        .from(assessmentResults)
        .where(eq(assessmentResults.attemptId, attemptId))
        .all();

      return {
        attemptId: attempt.id,
        completedAt: attempt.completedAt,
        domainScores: results.map(r => ({
          domain: r.domain,
          score: r.domainScore,
          facetScores: {
            facet1: r.facet1Score,
            facet2: r.facet2Score,
            facet3: r.facet3Score,
            facet4: r.facet4Score,
            facet5: r.facet5Score,
            facet6: r.facet6Score,
          },
        })),
      };
    };

    const a = getAttemptWithResults(attemptA as string);
    const b = getAttemptWithResults(attemptB as string);

    if (!a || !b) {
      res.status(404).json({ error: 'One or both assessment attempts not found or not completed' });
      return;
    }

    // Calculate differences
    const SIGNIFICANT_THRESHOLD = 0.5; // 10% of 5-point scale
    const domainLabels: Record<string, string> = {
      N: 'Neuroticism', E: 'Extraversion', O: 'Openness', A: 'Agreeableness', C: 'Conscientiousness',
    };

    const comparison = ['O', 'C', 'E', 'A', 'N'].map(domain => {
      const scoreA = a.domainScores.find(d => d.domain === domain);
      const scoreB = b.domainScores.find(d => d.domain === domain);

      const domainScoreA = scoreA?.score ?? 0;
      const domainScoreB = scoreB?.score ?? 0;
      const diff = domainScoreB - domainScoreA;
      const percentChange = domainScoreA > 0 ? (diff / domainScoreA) * 100 : 0;
      const isSignificant = Math.abs(percentChange) >= 10;

      // Facet comparison
      const facetDiffs = [1, 2, 3, 4, 5, 6].map(f => {
        const key = `facet${f}` as string;
        const facetsA = scoreA?.facetScores as Record<string, number | null> | undefined;
        const facetsB = scoreB?.facetScores as Record<string, number | null> | undefined;
        const fA = facetsA?.[key] ?? 0;
        const fB = facetsB?.[key] ?? 0;
        const fDiff = (fB as number) - (fA as number);
        return {
          facet: f,
          scoreA: fA,
          scoreB: fB,
          diff: fDiff,
          isSignificant: Math.abs(fDiff) >= SIGNIFICANT_THRESHOLD,
        };
      });

      return {
        domain,
        label: domainLabels[domain] || domain,
        scoreA: domainScoreA,
        scoreB: domainScoreB,
        diff,
        percentChange: Math.round(percentChange * 10) / 10,
        isSignificant,
        facets: facetDiffs,
      };
    });

    const significantChanges = comparison.filter(c => c.isSignificant);

    res.json({
      attemptA: { attemptId: a.attemptId, completedAt: a.completedAt },
      attemptB: { attemptId: b.attemptId, completedAt: b.completedAt },
      comparison,
      significantChanges: significantChanges.map(c => ({
        domain: c.domain,
        label: c.label,
        from: c.scoreA,
        to: c.scoreB,
        percentChange: c.percentChange,
      })),
    });
  } catch (err: any) {
    console.error('[me.md:assessment] Error comparing attempts:', err.message);
    res.status(500).json({ error: 'Failed to compare assessments' });
  }
});

// ============================================
// POST /api/assessment/change-insights
// ============================================
// Generate AI-powered change insights comparing two attempts.
assessmentRouter.post('/change-insights', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { attemptIdOld, attemptIdNew } = req.body;
    if (!attemptIdOld || !attemptIdNew) {
      res.status(400).json({ error: 'Both attemptIdOld and attemptIdNew are required' });
      return;
    }

    // Verify both belong to user, completed
    const getAttemptScores = (attemptId: string) => {
      const attempt = db.select()
        .from(assessmentAttempts)
        .where(and(
          eq(assessmentAttempts.id, attemptId),
          eq(assessmentAttempts.userId, userId),
          eq(assessmentAttempts.status, 'completed'),
        ))
        .get();
      if (!attempt) return null;

      const results = db.select()
        .from(assessmentResults)
        .where(eq(assessmentResults.attemptId, attemptId))
        .all();

      return {
        attemptId: attempt.id,
        completedAt: attempt.completedAt,
        scores: results.map(r => ({
          domain: r.domain,
          domainScore: r.domainScore,
          facetScores: {
            facet1: r.facet1Score,
            facet2: r.facet2Score,
            facet3: r.facet3Score,
            facet4: r.facet4Score,
            facet5: r.facet5Score,
            facet6: r.facet6Score,
          },
        })),
      };
    };

    const oldAttempt = getAttemptScores(attemptIdOld);
    const newAttempt = getAttemptScores(attemptIdNew);

    if (!oldAttempt || !newAttempt) {
      res.status(404).json({ error: 'One or both attempts not found or not completed' });
      return;
    }

    const changeInsights = await generateChangeInsights(
      userId,
      oldAttempt.scores,
      newAttempt.scores,
      oldAttempt.completedAt || '',
      newAttempt.completedAt || '',
    );

    // Store change insights in the knowledge graph (notes + insights)
    if (changeInsights.insights.length > 0) {
      try {
        // Find or create the Big Five assessment topic
        let assessmentTopic = db.select()
          .from(topics)
          .where(and(
            eq(topics.userId, userId),
            eq(topics.title, 'Big Five Personality Assessment'),
          ))
          .get();

        if (!assessmentTopic) {
          const topicId = uuidv4();
          assessmentTopic = db.insert(topics).values({
            id: topicId,
            userId,
            title: 'Big Five Personality Assessment',
            description: 'Personality insights generated from the Big Five (IPIP NEO-PI-R) assessment.',
            tags: JSON.stringify(['personality', 'big-five', 'assessment', 'self-knowledge']),
            status: 'extracted',
            priority: 'medium',
            intent: 'explore',
            isPreset: false,
            presetCategory: 'identity',
          }).returning().get();
        }

        // Create a change analysis note with temporal context
        const noteId = uuidv4();
        const oldDateStr = oldAttempt.completedAt ? new Date(oldAttempt.completedAt).toLocaleDateString() : 'earlier';
        const newDateStr = newAttempt.completedAt ? new Date(newAttempt.completedAt).toLocaleDateString() : 'recent';
        const insightsList = changeInsights.insights.map((i: string) => `- ${i}`).join('\n');
        const shiftsList = changeInsights.significantShifts.length > 0
          ? `\n\n## Significant Shifts\n${changeInsights.significantShifts.map((s: { label: string; from: number; to: number; interpretation: string }) =>
              `- **${s.label}**: ${s.from.toFixed(2)} → ${s.to.toFixed(2)} — ${s.interpretation}`
            ).join('\n')}`
          : '';

        const fullAnalysis = `# Personality Change Analysis\n\nComparing assessments from ${oldDateStr} to ${newDateStr}.\n\n## Change Insights\n${insightsList}${shiftsList}`;

        db.insert(notes).values({
          id: noteId,
          sessionId: attemptIdNew,
          topicId: assessmentTopic.id,
          userId,
          title: `Personality Changes — ${oldDateStr} to ${newDateStr}`,
          contentFullAnalysis: fullAnalysis,
          contentBriefSummary: `Personality change analysis with ${changeInsights.insights.length} insights.`,
          selectedFormat: 'full_analysis',
        }).run();

        // Store each change insight
        for (const insight of changeInsights.insights) {
          db.insert(insights).values({
            id: uuidv4(),
            noteId,
            topicId: assessmentTopic.id,
            userId,
            content: insight,
            confidenceScore: 75,
            verificationStatus: 'unverified',
            extractionMethod: changeInsights.generated ? 'ai' : 'rule_based',
            sourceSessionId: null,
          }).run();
        }

        console.log(`[me.md:assessment] Stored ${changeInsights.insights.length} change insights in knowledge graph`);
      } catch (storeErr: any) {
        console.warn('[me.md:assessment] Failed to store change insights in knowledge graph:', storeErr.message);
      }
    }

    res.json(changeInsights);
  } catch (err: any) {
    console.error('[me.md:assessment] Error generating change insights:', err.message);
    res.status(500).json({ error: 'Failed to generate change insights' });
  }
});
