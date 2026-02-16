import { Router } from 'express';
import { db } from '../config/database.js';
import { assessmentAttempts, assessmentAnswers, assessmentResults } from '../models/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import bigFiveService from '../services/bigfive.js';
import type { BigFiveAnswer } from '../services/bigfive.js';

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
    });
  } catch (err: any) {
    console.error('[me.md:assessment] Error fetching results:', err.message);
    res.status(500).json({ error: 'Failed to fetch assessment results' });
  }
});
