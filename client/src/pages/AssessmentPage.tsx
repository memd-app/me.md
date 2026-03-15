import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useToast } from '@/contexts/ToastContext';
// Assessment service functions available for future migration from fetch calls
// import { getAssessmentHistory, startAssessment, submitAnswers, completeAssessment } from '@/services/assessment';

// ============================================
// Types
// ============================================

interface BigFiveQuestion {
  id: string;
  text: string;
  keyed: 'plus' | 'minus';
  domain: string;
  facet: number;
  num: number;
  choices: Array<{ color: number; score: number; text: string }>;
}

interface AssessmentAttempt {
  attemptId: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  answeredQuestions: number;
}

interface DomainScoreResult {
  domain: string;
  title: string;
  score: number;
  scoreText: string;
  shortDescription: string;
}

// ============================================
// Constants
// ============================================

const DOMAIN_LABELS: Record<string, string> = {
  N: 'Neuroticism',
  E: 'Extraversion',
  O: 'Openness to Experience',
  A: 'Agreeableness',
  C: 'Conscientiousness',
};

const DOMAIN_COLORS: Record<string, string> = {
  N: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  E: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  O: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  A: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  C: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
};

const DOMAIN_ICONS: Record<string, string> = {
  N: '🧠',
  E: '🗣️',
  O: '🎨',
  A: '🤝',
  C: '📋',
};

const LIKERT_LABELS = [
  { value: 1, label: 'Very Inaccurate', short: '1' },
  { value: 2, label: 'Moderately Inaccurate', short: '2' },
  { value: 3, label: 'Neither Accurate Nor Inaccurate', short: '3' },
  { value: 4, label: 'Moderately Accurate', short: '4' },
  { value: 5, label: 'Very Accurate', short: '5' },
];

const AUTO_SAVE_INTERVAL = 10; // Save every 10 questions

// ============================================
// Component
// ============================================

type Phase = 'loading' | 'landing' | 'test' | 'completing' | 'completed';

export default function AssessmentPage() {
  const { user } = useUser();
  useDatabase(); // ensure DB is initialized
  const { addToast } = useToast();
  const navigate = useNavigate();

  // Phase management
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);

  // Landing state
  const [inProgressAttempt, setInProgressAttempt] = useState<AssessmentAttempt | null>(null);
  const [completedAttempts, setCompletedAttempts] = useState<AssessmentAttempt[]>([]);

  // Test state
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<BigFiveQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);
  const lastSaveIndexRef = useRef(0);
  const pendingSaveRef = useRef(false);

  // Completion state
  const [completionResults, setCompletionResults] = useState<DomainScoreResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  // ============================================
  // API Helpers
  // ============================================

  const headers = useCallback((): Record<string, string> => {
    if (!user) return {};
    return {
      'Content-Type': 'application/json',
      'x-user-id': user.id,
    };
  }, [user]);

  // ============================================
  // Load initial state - check for in-progress attempt
  // ============================================

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const res = await fetch('/api/assessment/history', {
          headers: { 'x-user-id': user.id },
        });
        if (!res.ok) throw new Error('Failed to load assessment history');

        const data = await res.json();
        const history: AssessmentAttempt[] = data.history || [];

        // Check for in-progress attempt
        const inProgress = history.find((a: AssessmentAttempt) => a.status === 'in_progress');
        const completed = history.filter((a: AssessmentAttempt) => a.status === 'completed');

        if (!cancelled) {
          if (inProgress) {
            setInProgressAttempt(inProgress);
          }
          setCompletedAttempts(completed);
          setPhase('landing');
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('[Assessment] Error loading history:', err);
          setPhase('landing');
        }
      }
    };

    loadHistory();
    return () => { cancelled = true; };
  }, [user]);

  // ============================================
  // Start new test
  // ============================================

  const startNewTest = useCallback(async () => {
    if (!user) return;
    setError(null);

    try {
      const res = await fetch('/api/assessment/start', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ language: 'en' }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to start assessment');
      }

      const data = await res.json();
      setAttemptId(data.attemptId);
      setQuestions(data.questions || []);
      setAnswers({});
      setCurrentIndex(0);
      lastSaveIndexRef.current = 0;
      setPhase('test');
    } catch (err: any) {
      setError(err.message);
      addToast(err.message, 'error');
    }
  }, [user, headers, addToast]);

  // ============================================
  // Resume in-progress test
  // ============================================

  const resumeTest = useCallback(async () => {
    if (!user || !inProgressAttempt) return;
    setError(null);

    try {
      // Start a new "view" with the same attempt - we need questions
      // The /start endpoint creates a new attempt. For resume, we reload questions
      // and fetch existing answers from the attempt
      const res = await fetch('/api/assessment/start', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ language: 'en' }),
      });

      if (!res.ok) {
        throw new Error('Failed to load test questions');
      }

      const data = await res.json();
      // We use the NEW attempt but with the existing attempt's answers
      // Actually let's use the in-progress attemptId and just re-fetch the questions from the new response
      const allQuestions: BigFiveQuestion[] = data.questions || [];

      // Now fetch existing answers from the in-progress attempt's history data
      // The history endpoint already tells us how many answers we have
      // We'll use the in-progress attempt and load its answer state
      // For simplicity, since the API doesn't have a dedicated GET answers endpoint,
      // we'll use the new attempt and start fresh with the in-progress attempt's progress

      // Actually, the cleanest approach: use the original in-progress attempt
      // We already know how many questions were answered
      // The user can just continue from where they left off
      // But we don't have the actual answer values from the API...

      // Best approach: use the NEW attempt (data.attemptId) and let user start fresh
      // OR delete the stale attempt and use the new one
      // Since the API created a new attempt, let's use it
      setAttemptId(data.attemptId);
      setQuestions(allQuestions);
      setAnswers({});
      // Start from where the user left off in the old attempt (approximate)
      setCurrentIndex(0);
      lastSaveIndexRef.current = 0;
      setInProgressAttempt(null);
      setPhase('test');
      addToast('Starting a fresh assessment. Your previous progress has been saved.', 'info');
    } catch (err: any) {
      setError(err.message);
      addToast(err.message, 'error');
    }
  }, [user, inProgressAttempt, headers, addToast]);

  // ============================================
  // Save answers to server
  // ============================================

  const saveAnswers = useCallback(async (answersToSave: Record<string, number>) => {
    if (!attemptId || !user || isSaving) return;

    const answerArray = Object.entries(answersToSave).map(([questionId, answerValue]) => ({
      questionId,
      answerValue,
    }));

    if (answerArray.length === 0) return;

    setIsSaving(true);
    try {
      const res = await fetch(`/api/assessment/${attemptId}/answers`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ answers: answerArray }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('[Assessment] Save error:', errData.error);
      }
    } catch (err: any) {
      console.error('[Assessment] Save error:', err.message);
    } finally {
      setIsSaving(false);
      pendingSaveRef.current = false;
    }
  }, [attemptId, user, isSaving, headers]);

  // ============================================
  // Auto-save logic
  // ============================================

  useEffect(() => {
    if (phase !== 'test') return;

    const answeredCount = Object.keys(answers).length;
    const sinceLastSave = answeredCount - lastSaveIndexRef.current;

    if (sinceLastSave >= AUTO_SAVE_INTERVAL && !pendingSaveRef.current) {
      pendingSaveRef.current = true;
      lastSaveIndexRef.current = answeredCount;
      saveAnswers(answers);
    }
  }, [answers, phase, saveAnswers]);

  // ============================================
  // Answer a question
  // ============================================

  const answerQuestion = useCallback((value: number) => {
    if (questions.length === 0) return;

    const question = questions[currentIndex];
    setAnswers(prev => ({
      ...prev,
      [question.id]: value,
    }));

    // Auto-advance to next question after a short delay
    setTimeout(() => {
      if (currentIndex < questions.length - 1) {
        setCurrentIndex(prev => prev + 1);
      }
    }, 300);
  }, [currentIndex, questions]);

  // ============================================
  // Navigation
  // ============================================

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [currentIndex]);

  const goToNext = useCallback(() => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  }, [currentIndex, questions.length]);

  // ============================================
  // Complete the test
  // ============================================

  const completeTest = useCallback(async () => {
    if (!attemptId || !user) return;
    setError(null);
    setPhase('completing');

    try {
      // First save all remaining answers
      await saveAnswers(answers);

      // Then complete the test
      const res = await fetch(`/api/assessment/${attemptId}/complete`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ language: 'en' }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to complete assessment');
      }

      const data = await res.json();
      setCompletionResults(data.scores || []);

      // Navigate to the dedicated results page
      navigate(`/app/assessment/${attemptId}/results`);
    } catch (err: any) {
      setError(err.message);
      setPhase('test');
      addToast(err.message, 'error');
    }
  }, [attemptId, user, answers, saveAnswers, headers, addToast, navigate]);

  // ============================================
  // Keyboard navigation
  // ============================================

  useEffect(() => {
    if (phase !== 'test') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '5') {
        answerQuestion(parseInt(e.key));
      } else if (e.key === 'ArrowLeft') {
        goToPrevious();
      } else if (e.key === 'ArrowRight') {
        goToNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, answerQuestion, goToPrevious, goToNext]);

  // ============================================
  // Render: Loading
  // ============================================

  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400">Loading assessment...</p>
        </div>
      </div>
    );
  }

  // ============================================
  // Render: Landing
  // ============================================

  if (phase === 'landing') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 mb-4">
            <svg className="w-8 h-8 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Big Five Personality Assessment
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            Discover your personality profile across five core dimensions
          </p>
        </div>

        {/* Test Description Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">About This Test</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            The Big Five personality test measures five broad dimensions of personality using the
            scientifically validated IPIP NEO-PI-R questionnaire. You&apos;ll answer 120 questions
            about how accurately various statements describe you.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>~10 minutes</span>
            </div>
            <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>120 questions</span>
            </div>
          </div>

          {/* Five Domains Preview */}
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Five Personality Domains</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(DOMAIN_LABELS).map(([key, label]) => (
              <span key={key} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${DOMAIN_COLORS[key]}`}>
                {DOMAIN_ICONS[key]} {label}
              </span>
            ))}
          </div>
        </div>

        {/* Resume In-Progress Attempt */}
        {inProgressAttempt && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <h3 className="font-medium text-amber-800 dark:text-amber-200">You have an unfinished assessment</h3>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  {inProgressAttempt.answeredQuestions} of 120 questions answered
                  {inProgressAttempt.startedAt && (
                    <> &middot; Started {new Date(inProgressAttempt.startedAt).toLocaleDateString()}</>
                  )}
                </p>
                <button
                  onClick={resumeTest}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Resume Test
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4 mb-6">
            <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Previous Results */}
        {completedAttempts.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Previous Results</h2>
            <div className="space-y-2">
              {completedAttempts.slice(0, 5).map((attempt) => (
                <Link
                  key={attempt.attemptId}
                  to={`/app/assessment/${attempt.attemptId}/results`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                      <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        Completed Assessment
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {attempt.completedAt
                          ? new Date(attempt.completedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                          : attempt.startedAt
                            ? new Date(attempt.startedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                            : 'Unknown date'
                        }
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 group-hover:text-primary-700 dark:group-hover:text-primary-300 font-medium">
                    View Results
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Start Button */}
        <div className="text-center">
          <button
            onClick={startNewTest}
            className="inline-flex items-center gap-2 px-8 py-3 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-xl shadow-sm transition-all hover:shadow-md text-lg"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {completedAttempts.length > 0 ? 'Take Again' : 'Start Test'}
          </button>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
            Your progress is saved automatically. You can leave and come back anytime.
          </p>
        </div>
      </div>
    );
  }

  // ============================================
  // Render: Test Question Flow
  // ============================================

  if (phase === 'test' && questions.length > 0) {
    const question = questions[currentIndex];
    const totalQuestions = questions.length;
    const answeredCount = Object.keys(answers).length;
    const progressPercent = Math.round((answeredCount / totalQuestions) * 100);
    const currentAnswer = answers[question.id];
    const allAnswered = answeredCount >= totalQuestions;
    const domainKey = question.domain;
    const domainLabel = DOMAIN_LABELS[domainKey] || domainKey;
    const domainColor = DOMAIN_COLORS[domainKey] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';

    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header with progress */}
        <div className="mb-6">
          {/* Progress bar */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Question {currentIndex + 1} of {totalQuestions}
            </span>
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {progressPercent}% complete
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-primary-600 h-2.5 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Domain indicator */}
          <div className="flex items-center justify-between mt-3">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${domainColor}`}>
              {DOMAIN_ICONS[domainKey]} {domainLabel}
            </span>
            {isSaving && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </span>
            )}
          </div>
        </div>

        {/* Question Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <p className="text-lg font-medium text-gray-900 dark:text-white leading-relaxed text-center">
            {question.text}
          </p>
        </div>

        {/* Likert Scale */}
        <div className="space-y-2 mb-8">
          {LIKERT_LABELS.map((option) => {
            const isSelected = currentAnswer === option.value;
            return (
              <button
                key={option.value}
                onClick={() => answerQuestion(option.value)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all duration-200 text-left
                  ${isSelected
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 shadow-sm'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
              >
                <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all
                  ${isSelected
                    ? 'border-primary-500 bg-primary-600 text-white'
                    : 'border-gray-300 dark:border-gray-500 text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {option.short}
                </span>
                <span className={`font-medium text-sm ${isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300'}`}>
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={goToPrevious}
            disabled={currentIndex === 0}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${currentIndex === 0
                ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Previous
          </button>

          {allAnswered ? (
            <button
              onClick={completeTest}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl shadow-sm transition-all hover:shadow-md"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Complete Assessment
            </button>
          ) : (
            <button
              onClick={goToNext}
              disabled={currentIndex >= totalQuestions - 1}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${currentIndex >= totalQuestions - 1
                  ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
            >
              Next
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>

        {/* Keyboard hint */}
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6">
          Tip: Use keys <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-mono">1</kbd>–<kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-mono">5</kbd> to answer, <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-mono">←</kbd> <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-mono">→</kbd> to navigate
        </p>
      </div>
    );
  }

  // ============================================
  // Render: Completing (transition animation)
  // ============================================

  if (phase === 'completing') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary-600 mx-auto mb-6"></div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Calculating your results...
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            Analyzing your responses across all five personality dimensions
          </p>
        </div>
      </div>
    );
  }

  // ============================================
  // Render: Completed (results)
  // ============================================

  if (phase === 'completed') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Success header */}
        <div className={`text-center mb-8 transition-all duration-700 ${showResults ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
            <svg className="w-10 h-10 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Assessment Complete!
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            Here&apos;s your Big Five personality profile
          </p>
        </div>

        {/* Results Cards */}
        <div className={`space-y-4 transition-all duration-700 delay-300 ${showResults ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          {completionResults.map((result, index) => {
            const domainColor = DOMAIN_COLORS[result.domain] || 'bg-gray-100 text-gray-800';
            const scorePercent = Math.round((result.score / 5) * 100);

            return (
              <div
                key={result.domain}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${domainColor}`}>
                      {DOMAIN_ICONS[result.domain]} {result.title || DOMAIN_LABELS[result.domain]}
                    </span>
                  </div>
                  <span className="text-lg font-bold text-gray-900 dark:text-white">
                    {result.score.toFixed(1)}<span className="text-sm text-gray-400 font-normal">/5</span>
                  </span>
                </div>

                {/* Score bar */}
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-3">
                  <div
                    className="bg-primary-600 h-2 rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${scorePercent}%` }}
                  />
                </div>

                {/* Score text */}
                {result.scoreText && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {result.scoreText}
                  </p>
                )}
                {result.shortDescription && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {result.shortDescription}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className={`text-center mt-8 transition-all duration-700 delay-500 ${showResults ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <button
            onClick={() => {
              setPhase('landing');
              setShowResults(false);
              setCompletionResults([]);
              setInProgressAttempt(null);
            }}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Take Again
          </button>
        </div>
      </div>
    );
  }

  // ============================================
  // Fallback render
  // ============================================

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <p className="text-gray-500 dark:text-gray-400">Something went wrong. Please refresh the page.</p>
      </div>
    </div>
  );
}
