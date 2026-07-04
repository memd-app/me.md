import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { compareAssessments, getAssessmentHistory, generateChangeInsights } from '@/services/assessment';

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

interface ComparisonDomain {
  domain: string;
  label: string;
  scoreA: number;
  scoreB: number;
  diff: number;
  percentChange: number;
  isSignificant: boolean;
  facets: Array<{
    facet: number;
    scoreA: number | null;
    scoreB: number | null;
    diff: number;
    isSignificant: boolean;
  }>;
}

interface ChangeInsight {
  insights: string[];
  significantShifts: Array<{
    domain: string;
    label: string;
    from: number;
    to: number;
    interpretation: string;
  }>;
  generated: boolean;
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

const FACET_LABELS: Record<string, string[]> = {
  N: ['Anxiety', 'Anger', 'Depression', 'Self-Consciousness', 'Immoderation', 'Vulnerability'],
  E: ['Friendliness', 'Gregariousness', 'Assertiveness', 'Activity Level', 'Excitement-Seeking', 'Cheerfulness'],
  O: ['Imagination', 'Artistic Interests', 'Emotionality', 'Adventurousness', 'Intellect', 'Liberalism'],
  A: ['Trust', 'Morality', 'Altruism', 'Cooperation', 'Modesty', 'Sympathy'],
  C: ['Self-Efficacy', 'Orderliness', 'Dutifulness', 'Achievement-Striving', 'Self-Discipline', 'Cautiousness'],
};

// ============================================
// D3 Line Chart Component (SVG-based, no D3 dep)
// ============================================

function TrendsChart({
  attempts,
  highlightDomains,
}: {
  attempts: HistoryAttempt[];
  highlightDomains: Set<string>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltipData, setTooltipData] = useState<{
    x: number;
    y: number;
    domain: string;
    score: number;
    date: string;
  } | null>(null);

  // Only completed attempts, sorted oldest to newest
  const completedAttempts = attempts
    .filter(a => a.status === 'completed' && a.domainScores.length > 0)
    .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime());

  if (completedAttempts.length < 2) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        <p>Complete at least 2 assessments to see trends over time.</p>
      </div>
    );
  }

  const width = 700;
  const height = 350;
  const padding = { top: 30, right: 30, bottom: 60, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const minDate = new Date(completedAttempts[0].completedAt!).getTime();
  const maxDate = new Date(completedAttempts[completedAttempts.length - 1].completedAt!).getTime();
  const dateRange = maxDate - minDate || 1;

  const xScale = (dateMs: number) => padding.left + ((dateMs - minDate) / dateRange) * chartW;
  const yScale = (score: number) => padding.top + chartH - ((score - 1) / 4) * chartH; // 1-5 scale

  // Grid lines
  const gridLines = [1, 2, 3, 4, 5].map(score => ({
    y: yScale(score),
    label: score.toString(),
  }));

  return (
    <div className="relative overflow-x-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-w-[700px] mx-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid */}
        {gridLines.map(g => (
          <g key={g.label}>
            <line
              x1={padding.left}
              y1={g.y}
              x2={width - padding.right}
              y2={g.y}
              stroke="currentColor"
              className="text-gray-200 dark:text-gray-700"
              strokeWidth={1}
              strokeDasharray={g.label === '3' ? '' : '4,4'}
            />
            <text
              x={padding.left - 8}
              y={g.y + 4}
              textAnchor="end"
              className="text-gray-500 dark:text-gray-400 text-[11px]"
              fill="currentColor"
              fontSize={11}
            >
              {g.label}
            </text>
          </g>
        ))}

        {/* X-axis date labels */}
        {completedAttempts.map((attempt, idx) => {
          const x = xScale(new Date(attempt.completedAt!).getTime());
          const dateLabel = new Date(attempt.completedAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
          return (
            <g key={attempt.attemptId}>
              <line
                x1={x}
                y1={padding.top}
                x2={x}
                y2={height - padding.bottom}
                stroke="currentColor"
                className="text-gray-100 dark:text-gray-800"
                strokeWidth={1}
              />
              <text
                x={x}
                y={height - padding.bottom + 20}
                textAnchor="middle"
                className="text-gray-500 dark:text-gray-400 text-[10px]"
                fill="currentColor"
                fontSize={10}
              >
                {dateLabel}
              </text>
              <text
                x={x}
                y={height - padding.bottom + 35}
                textAnchor="middle"
                className="text-gray-400 dark:text-gray-500 text-[9px]"
                fill="currentColor"
                fontSize={9}
              >
                #{idx + 1}
              </text>
            </g>
          );
        })}

        {/* Lines and dots per domain */}
        {DOMAIN_ORDER.map(domain => {
          const color = DOMAIN_COLORS[domain];
          const isHighlighted = highlightDomains.size === 0 || highlightDomains.has(domain);
          const opacity = isHighlighted ? 1 : 0.15;

          const points = completedAttempts
            .map(attempt => {
              const ds = attempt.domainScores.find(d => d.domain === domain);
              if (!ds) return null;
              return {
                x: xScale(new Date(attempt.completedAt!).getTime()),
                y: yScale(ds.score),
                score: ds.score,
                date: attempt.completedAt!,
              };
            })
            .filter(Boolean) as Array<{ x: number; y: number; score: number; date: string }>;

          if (points.length < 2) return null;

          const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

          return (
            <g key={domain} opacity={opacity}>
              <path
                d={pathD}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {points.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={5}
                  fill={color}
                  stroke="white"
                  strokeWidth={2}
                  className="cursor-pointer"
                  onMouseEnter={() => setTooltipData({ ...p, domain })}
                  onMouseLeave={() => setTooltipData(null)}
                />
              ))}
            </g>
          );
        })}

        {/* Tooltip */}
        {tooltipData && (
          <g>
            <rect
              x={tooltipData.x - 55}
              y={tooltipData.y - 40}
              width={110}
              height={30}
              rx={6}
              fill="rgba(0,0,0,0.85)"
            />
            <text
              x={tooltipData.x}
              y={tooltipData.y - 21}
              textAnchor="middle"
              fill="white"
              fontSize={11}
              fontWeight="bold"
            >
              {DOMAIN_LABELS[tooltipData.domain]}: {tooltipData.score.toFixed(2)}
            </text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-3 mt-3">
        {DOMAIN_ORDER.map(domain => (
          <div key={domain} className="flex items-center gap-1.5 text-xs">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: DOMAIN_COLORS[domain] }}
            />
            <span className="text-gray-700 dark:text-gray-300">
              {DOMAIN_LABELS[domain]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export default function AssessmentHistoryPage() {
  const { user } = useUser();
  const db = useDatabase();
  const [history, setHistory] = useState<HistoryAttempt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Comparison state
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ComparisonDomain[] | null>(null);
  const [isComparing, setIsComparing] = useState(false);

  // Change insights state
  const [changeInsights, setChangeInsights] = useState<ChangeInsight | null>(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);

  // Highlight domains in chart
  const [highlightDomains, setHighlightDomains] = useState<Set<string>>(new Set());

  // Active tab
  const [activeTab, setActiveTab] = useState<'timeline' | 'trends' | 'compare'>('timeline');

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

  // Fetch comparison
  const fetchComparison = useCallback(async () => {
    if (!user || !compareA || !compareB) return;
    setIsComparing(true);
    setComparison(null);
    setChangeInsights(null);
    try {
      const data = compareAssessments(db, compareA!, compareB!);
      setComparison(data.comparison || []);
    } catch (err) {
      console.error('Comparison error:', err);
    } finally {
      setIsComparing(false);
    }
  }, [user, compareA, compareB]);

  useEffect(() => {
    if (compareA && compareB && compareA !== compareB) {
      fetchComparison();
    }
  }, [compareA, compareB, fetchComparison]);

  // Generate change insights
  const handleGenerateChangeInsights = async () => {
    if (!user || !compareA || !compareB) return;
    setIsLoadingInsights(true);
    try {
      const data = await generateChangeInsights(db, compareA!, compareB!);
      setChangeInsights(data);
    } catch (err) {
      console.error('Change insight error:', err);
    } finally {
      setIsLoadingInsights(false);
    }
  };

  // Auto-select newest two completed attempts for comparison on first load
  useEffect(() => {
    if (history.length >= 2 && !compareA && !compareB) {
      const completed = history.filter(h => h.status === 'completed');
      if (completed.length >= 2) {
        // History is sorted newest first, so [0] is latest, [1] is second-latest
        setCompareA(completed[1].attemptId);
        setCompareB(completed[0].attemptId);
      }
    }
  }, [history, compareA, compareB]);

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

  const getAttemptLabel = (attemptId: string) => {
    const idx = completedAttempts.findIndex(a => a.attemptId === attemptId);
    if (idx === -1) return 'Unknown';
    return `#${completedAttempts.length - idx} — ${formatDate(completedAttempts[idx].completedAt)}`;
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
          to="/app/assessment"
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
          <Link to="/app/assessment" className="btn-primary">
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
                        ? 'You can retake the assessment!'
                        : `Recommended wait: ${MIN_RETEST_DAYS - daysSinceLast} more days`}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Last completed {daysSinceLast} days ago ({formatDate(completedAttempts[0].completedAt)}).
                      {!canRetest && ' We recommend waiting at least 3 months between retests for meaningful results.'}
                    </p>
                  </div>
                  {canRetest && (
                    <Link to="/app/assessment" className="btn-primary text-xs whitespace-nowrap">
                      Retake Now
                    </Link>
                  )}
                </div>
              );
            })()
          )}

          {/* Tab navigation */}
          <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            {[
              { key: 'timeline' as const, label: 'Timeline', icon: '📅' },
              { key: 'trends' as const, label: 'Score Trends', icon: '📈' },
              { key: 'compare' as const, label: 'Compare', icon: '⚖️' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Timeline Tab */}
          {activeTab === 'timeline' && (
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
                                to={`/app/assessment/${attempt.attemptId}/results`}
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
          )}

          {/* Trends Tab */}
          {activeTab === 'trends' && (
            <div className="card p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Score Trends Over Time
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Track how your domain scores evolve across assessments
              </p>

              {/* Domain filter toggles */}
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => setHighlightDomains(new Set())}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    highlightDomains.size === 0
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 border-transparent'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  All Domains
                </button>
                {DOMAIN_ORDER.map(domain => {
                  const isActive = highlightDomains.has(domain);
                  return (
                    <button
                      key={domain}
                      onClick={() => {
                        const newSet = new Set(highlightDomains);
                        if (isActive) {
                          newSet.delete(domain);
                        } else {
                          newSet.add(domain);
                        }
                        setHighlightDomains(newSet);
                      }}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
                        isActive
                          ? 'text-white border-transparent'
                          : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                      style={isActive ? { backgroundColor: DOMAIN_COLORS[domain] } : {}}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: DOMAIN_COLORS[domain] }}
                      />
                      {DOMAIN_LABELS[domain]}
                    </button>
                  );
                })}
              </div>

              <TrendsChart
                attempts={history}
                highlightDomains={highlightDomains}
              />

              {/* Significant changes summary */}
              {completedAttempts.length >= 2 && (
                <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                    Notable Changes (Latest vs Previous)
                  </h3>
                  {(() => {
                    const latest = completedAttempts[0];
                    const previous = completedAttempts[1];
                    const changes = DOMAIN_ORDER.map(d => {
                      const latestScore = latest.domainScores.find(s => s.domain === d)?.score ?? 0;
                      const prevScore = previous.domainScores.find(s => s.domain === d)?.score ?? 0;
                      const diff = latestScore - prevScore;
                      const pctChange = prevScore > 0 ? (diff / prevScore) * 100 : 0;
                      return { domain: d, diff, pctChange, latestScore, prevScore };
                    }).filter(c => Math.abs(c.pctChange) >= 10);

                    if (changes.length === 0) {
                      return (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          No significant changes (&gt;10%) between your last two assessments.
                          Your personality profile appears stable.
                        </p>
                      );
                    }

                    return (
                      <div className="space-y-2">
                        {changes.map(c => (
                          <div
                            key={c.domain}
                            className={`flex items-center gap-3 p-3 rounded-lg ${
                              c.diff > 0
                                ? 'bg-green-50 dark:bg-green-900/20'
                                : 'bg-red-50 dark:bg-red-900/20'
                            }`}
                          >
                            <span className="text-lg">{c.diff > 0 ? '📈' : '📉'}</span>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-900 dark:text-white">
                                {DOMAIN_LABELS[c.domain]}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {c.prevScore.toFixed(1)} → {c.latestScore.toFixed(1)}
                                ({c.diff > 0 ? '+' : ''}{c.pctChange.toFixed(0)}%)
                              </p>
                            </div>
                            <span
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: DOMAIN_COLORS[c.domain] }}
                            />
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Compare Tab */}
          {activeTab === 'compare' && (
            <div className="space-y-6">
              {/* Attempt selector */}
              <div className="card p-4 sm:p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Side-by-Side Comparison
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Select two assessments to compare their scores
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Earlier Assessment (A)
                    </label>
                    <select
                      value={compareA || ''}
                      onChange={(e) => setCompareA(e.target.value || null)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white"
                    >
                      <option value="">Select assessment...</option>
                      {completedAttempts.map((a, idx) => (
                        <option key={a.attemptId} value={a.attemptId}>
                          #{completedAttempts.length - idx} — {formatDate(a.completedAt)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Later Assessment (B)
                    </label>
                    <select
                      value={compareB || ''}
                      onChange={(e) => setCompareB(e.target.value || null)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white"
                    >
                      <option value="">Select assessment...</option>
                      {completedAttempts.map((a, idx) => (
                        <option key={a.attemptId} value={a.attemptId}>
                          #{completedAttempts.length - idx} — {formatDate(a.completedAt)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {compareA && compareB && compareA === compareB && (
                  <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                    Please select two different assessments to compare.
                  </p>
                )}
              </div>

              {/* Comparison results */}
              {isComparing && (
                <div className="card p-6 text-center">
                  <div className="animate-spin w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full mx-auto mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">Comparing assessments...</p>
                </div>
              )}

              {comparison && !isComparing && (
                <div className="card p-4 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                      Score Comparison
                    </h3>
                    <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                        A: {compareA ? getAttemptLabel(compareA) : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-primary-500" />
                        B: {compareB ? getAttemptLabel(compareB) : ''}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {comparison.map(c => (
                      <div
                        key={c.domain}
                        className={`p-4 rounded-lg border ${
                          c.isSignificant
                            ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/10'
                            : 'border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: DOMAIN_COLORS[c.domain] }}
                            />
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                              {c.label}
                            </span>
                            {c.isSignificant && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
                                Significant Change
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-gray-500 dark:text-gray-400">
                              {c.scoreA.toFixed(2)}
                            </span>
                            <span className={`font-bold ${
                              c.diff > 0 ? 'text-green-600 dark:text-green-400' :
                              c.diff < 0 ? 'text-red-600 dark:text-red-400' :
                              'text-gray-400'
                            }`}>
                              → {c.scoreB.toFixed(2)}
                            </span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              c.diff > 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                              c.diff < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                              'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                            }`}>
                              {c.diff > 0 ? '+' : ''}{c.percentChange.toFixed(1)}%
                            </span>
                          </div>
                        </div>

                        {/* Domain score bars */}
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 w-4">A</span>
                            <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gray-400 transition-all"
                                style={{ width: `${(c.scoreA / 5) * 100}%` }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 w-4">B</span>
                            <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${(c.scoreB / 5) * 100}%`,
                                  backgroundColor: DOMAIN_COLORS[c.domain],
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Facet breakdown for significant changes */}
                        {c.isSignificant && c.facets.some(f => f.isSignificant) && (
                          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                              Facet Changes:
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {c.facets
                                .filter(f => f.isSignificant)
                                .map(f => {
                                  const facetLabel = FACET_LABELS[c.domain]?.[f.facet - 1] || `Facet ${f.facet}`;
                                  return (
                                    <div key={f.facet} className="text-xs">
                                      <span className="text-gray-600 dark:text-gray-400">{facetLabel}: </span>
                                      <span className={`font-semibold ${
                                        f.diff > 0 ? 'text-green-600 dark:text-green-400' :
                                        'text-red-600 dark:text-red-400'
                                      }`}>
                                        {f.diff > 0 ? '+' : ''}{f.diff.toFixed(2)}
                                      </span>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* AI Change Insights */}
                  <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                        AI Change Insights
                      </h3>
                      {!changeInsights && (
                        <button
                          onClick={handleGenerateChangeInsights}
                          disabled={isLoadingInsights}
                          className="btn-primary text-xs flex items-center gap-1.5"
                        >
                          {isLoadingInsights ? (
                            <>
                              <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              Generate Insights
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {changeInsights ? (
                      <div className="space-y-3">
                        {changeInsights.insights.map((insight, idx) => (
                          <div key={idx} className="flex gap-3 p-3 rounded-lg bg-primary-50 dark:bg-primary-900/20">
                            <span className="text-base flex-shrink-0">💡</span>
                            <p className="text-sm text-gray-800 dark:text-gray-200">{insight}</p>
                          </div>
                        ))}

                        {changeInsights.significantShifts.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                              Key Shifts:
                            </p>
                            {changeInsights.significantShifts.map((shift, idx) => (
                              <div key={idx} className="flex items-start gap-2 p-2 rounded bg-amber-50 dark:bg-amber-900/15 mb-1">
                                <span
                                  className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0"
                                  style={{ backgroundColor: DOMAIN_COLORS[shift.domain] || '#999' }}
                                />
                                <p className="text-xs text-gray-700 dark:text-gray-300">
                                  <strong>{shift.label}</strong>: {shift.interpretation}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        {!changeInsights.generated && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                            Rule-based analysis (AI unavailable). Enable Anthropic API for richer insights.
                          </p>
                        )}
                      </div>
                    ) : !isLoadingInsights ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Click "Generate Insights" to get AI-powered analysis of how your scores changed.
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
