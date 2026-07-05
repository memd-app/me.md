import PageTabs from '@/components/ui/PageTabs';
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { getAssessmentHistory } from '@/services/assessment';

// ============================================
// Types
// ============================================

interface DomainScore {
  domain: string;
  score: number;
  facetScores?: {
    facet1: number | null;
    facet2: number | null;
    facet3: number | null;
    facet4: number | null;
    facet5: number | null;
    facet6: number | null;
  };
}

interface HistoryAttempt {
  attemptId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  answeredQuestions: number;
  domainScores: DomainScore[];
}

// ============================================
// Constants
// ============================================

const DOMAIN_LABELS: Record<string, string> = {
  O: 'Openness',
  C: 'Conscientiousness',
  E: 'Extraversion',
  A: 'Agreeableness',
  N: 'Neuroticism',
};

const DOMAIN_COLORS: Record<string, string> = {
  O: '#3B82F6', // blue
  C: '#8B5CF6', // purple
  E: '#F59E0B', // amber
  A: '#10B981', // emerald
  N: '#F43F5E', // rose
};

const DOMAIN_ORDER = ['O', 'C', 'E', 'A', 'N'];

// ============================================
// Main Component
// ============================================

export default function AssessmentHistoryPage() {
  const { user } = useUser();
  const db = useDatabase();
  const [history, setHistory] = useState<HistoryAttempt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = getAssessmentHistory(db);
      setHistory((data.history || []) as any);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const completedAttempts = history.filter(h => h.status === 'completed');
  const MIN_RETEST_DAYS = 90;

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="card p-6 text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button onClick={fetchHistory} className="btn-primary">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageTabs
        tabs={[
          { to: '/app/personality', label: 'Take the test', end: true },
          { to: '/app/personality/history', label: 'History' },
        ]}
      />
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
            Assessment History
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track how your personality scores change over time
          </p>
        </div>
        <Link
          to="/app/personality"
          className="btn-primary text-sm flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Take Assessment
        </Link>
      </div>

      {/* Empty state */}
      {completedAttempts.length === 0 && (
        <div className="card p-8 text-center">
          <span className="text-4xl block mb-3">📊</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No Completed Assessments
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Complete a Big Five personality assessment to start tracking your personality over time.
          </p>
          <Link to="/app/personality" className="btn-primary">
            Take Your First Assessment
          </Link>
        </div>
      )}

      {completedAttempts.length > 0 && (
        <>
          {/* Minimum retest interval suggestion */}
          {completedAttempts.length > 0 && completedAttempts[0].completedAt && (
            (() => {
              const lastDate = new Date(completedAttempts[0].completedAt!);
              const daysSinceLast = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
              const canRetest = daysSinceLast >= MIN_RETEST_DAYS;
              return (
                <div className={`card p-4 mb-6 flex items-center gap-3 ${
                  canRetest
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                }`}>
                  <span className="text-xl">{canRetest ? '✅' : '⏳'}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {canRetest
                        ? 'You can retake the assessment.'
                        : `Recommended wait: ${MIN_RETEST_DAYS - daysSinceLast} more days`}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Last completed {daysSinceLast} days ago ({formatDate(completedAttempts[0].completedAt)}).
                      {!canRetest && ' We recommend waiting at least 3 months between retests for meaningful results.'}
                    </p>
                  </div>
                  {canRetest && (
                    <Link to="/app/personality" className="btn-primary text-xs whitespace-nowrap">
                      Retake Now
                    </Link>
                  )}
                </div>
              );
            })()
          )}

          <div className="card p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Assessment Timeline
              </h2>
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-5 top-4 bottom-4 w-0.5 bg-gray-200 dark:bg-gray-700" />

                <div className="space-y-4">
                  {history.map((attempt, idx) => {
                    const isCompleted = attempt.status === 'completed';
                    const attemptNum = completedAttempts.length - completedAttempts.findIndex(a => a.attemptId === attempt.attemptId);
                    return (
                      <div
                        key={attempt.attemptId}
                        className="relative flex gap-4 pl-2"
                      >
                        {/* Dot */}
                        <div className={`relative z-10 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ring-2 ring-white dark:ring-gray-900 ${
                          isCompleted
                            ? 'bg-primary-500 text-white'
                            : 'bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                        }`}>
                          {isCompleted ? attemptNum : '…'}
                        </div>

                        {/* Content */}
                        <div className={`flex-1 card p-4 ${
                          idx === 0 ? 'border-primary-200 dark:border-primary-800' : ''
                        }`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                isCompleted
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                              }`}>
                                {isCompleted ? 'Completed' : 'In Progress'}
                              </span>
                              {idx === 0 && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 font-medium">
                                  Latest
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {formatDate(attempt.completedAt || attempt.startedAt)}
                            </span>
                          </div>

                          {isCompleted && attempt.domainScores.length > 0 && (
                            <div className="flex items-center gap-2 mt-2">
                              {DOMAIN_ORDER.map(d => {
                                const ds = attempt.domainScores.find(s => s.domain === d);
                                if (!ds) return null;
                                const pct = Math.round((ds.score / 5) * 100);
                                return (
                                  <div key={d} className="flex-1 text-center">
                                    <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                                      {DOMAIN_LABELS[d]}
                                    </p>
                                    <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mt-0.5">
                                      <div
                                        className="h-full rounded-full transition-all duration-500"
                                        style={{ width: `${pct}%`, backgroundColor: DOMAIN_COLORS[d] }}
                                      />
                                    </div>
                                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-0.5">
                                      {ds.score.toFixed(1)}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {isCompleted && (
                            <div className="flex gap-2 mt-3">
                              <Link
                                to={`/app/personality/${attempt.attemptId}/results`}
                                className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                              >
                                View Full Results
                              </Link>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
        </>
      )}
    </div>
  );
}
