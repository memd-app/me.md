import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import { formatActivityDate } from '@/utils/dateFormat';

interface CategoryCompleteness {
  category: string;
  label: string;
  totalTopics: number;
  exploredTopics: number;
  totalInsights: number;
  verifiedInsights: number;
  completeness: number;
}

interface TopicInsightBreakdown {
  topicId: string;
  topicTitle: string;
  category: string;
  totalInsights: number;
  verified: number;
  rejected: number;
  unverified: number;
}

interface DashboardStats {
  topics: number;
  topicsExplored: number;
  sessions: number;
  completedSessions: number;
  insights: number;
  verifiedInsights: number;
  rejectedInsights: number;
  verificationRate: number;
  notes: number;
  categoryCompleteness: CategoryCompleteness[];
  topicInsightBreakdown: TopicInsightBreakdown[];
}

interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string;
  status?: string;
  date: string;
}

interface AssessmentStatus {
  hasTaken: boolean;
  lastCompletedAt: string | null;
  attemptId: string | null;
  domainScores: Array<{ domain: string; score: number }> | null;
}

const CATEGORY_COLORS: Record<string, { bg: string; fill: string; text: string }> = {
  identity: { bg: 'bg-blue-100 dark:bg-blue-900/30', fill: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-300' },
  skills: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', fill: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
  experiences: { bg: 'bg-amber-100 dark:bg-amber-900/30', fill: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  perspectives: { bg: 'bg-purple-100 dark:bg-purple-900/30', fill: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-300' },
  goals: { bg: 'bg-rose-100 dark:bg-rose-900/30', fill: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300' },
};

const CATEGORY_ICONS: Record<string, string> = {
  identity: '🪪',
  skills: '🛠️',
  experiences: '🌍',
  perspectives: '💡',
  goals: '🎯',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchVersion, setFetchVersion] = useState(0);
  const [assessmentStatus, setAssessmentStatus] = useState<AssessmentStatus>({
    hasTaken: false,
    lastCompletedAt: null,
    attemptId: null,
    domainScores: null,
  });

  const fetchDashboard = useCallback(async (signal?: AbortSignal) => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const [statsRes, activityRes, assessmentRes] = await Promise.all([
        fetch('/api/dashboard/stats', { headers: { 'x-user-id': user.id }, signal }),
        fetch('/api/dashboard/activity', { headers: { 'x-user-id': user.id }, signal }),
        fetch('/api/assessment/latest', { headers: { 'x-user-id': user.id }, signal }).catch(() => null),
      ]);

      if (!statsRes.ok || !activityRes.ok) {
        throw new Error('The server encountered an unexpected error. Please try again in a moment. If the problem persists, contact support.');
      }

      const statsData = await statsRes.json();
      setStats(statsData);

      const activityData = await activityRes.json();
      setActivity(activityData.activity || []);

      // Assessment data (optional - 404 means not taken)
      if (assessmentRes && assessmentRes.ok) {
        const aData = await assessmentRes.json();
        setAssessmentStatus({
          hasTaken: true,
          lastCompletedAt: aData.completedAt,
          attemptId: aData.attemptId,
          domainScores: aData.domainScores?.map((d: { domain: string; domainScore: number }) => ({
            domain: d.domain,
            score: d.domainScore,
          })) || null,
        });
      } else {
        setAssessmentStatus({ hasTaken: false, lastCompletedAt: null, attemptId: null, domainScores: null });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Failed to load dashboard data. Please try again.';
      setError(message);
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDashboard(controller.signal);
    return () => controller.abort();
  }, [fetchDashboard, fetchVersion]);

  const statCards = [
    {
      label: 'Topics Explored',
      value: `${stats?.topicsExplored ?? 0} / ${stats?.topics ?? 0}`,
      icon: '📋',
      sublabel: stats?.topics ? `${Math.round(((stats?.topicsExplored ?? 0) / stats.topics) * 100)}% explored` : 'No topics yet',
    },
    {
      label: 'Verified Insights',
      value: stats?.verifiedInsights ?? 0,
      icon: '✅',
      sublabel: `of ${stats?.insights ?? 0} total`,
    },
    {
      label: 'Sessions Completed',
      value: stats?.completedSessions ?? 0,
      icon: '💬',
      sublabel: `of ${stats?.sessions ?? 0} total`,
    },
    {
      label: 'Verification Rate',
      value: `${stats?.verificationRate ?? 0}%`,
      icon: '📊',
      sublabel: stats && (stats.verifiedInsights + stats.rejectedInsights) > 0
        ? `${stats.verifiedInsights} approved, ${stats.rejectedInsights} rejected`
        : 'No reviews yet',
    },
  ];

  // Activity type styling configuration
  const ACTIVITY_CONFIG: Record<string, { icon: string; dotColor: string; badgeClass: string; badgeLabel: string }> = {
    topic_created: {
      icon: '📋',
      dotColor: 'bg-indigo-500',
      badgeClass: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
      badgeLabel: 'Topic Created',
    },
    session_started: {
      icon: '💬',
      dotColor: 'bg-blue-500',
      badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      badgeLabel: 'Session Started',
    },
    session_completed: {
      icon: '✅',
      dotColor: 'bg-green-500',
      badgeClass: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
      badgeLabel: 'Session Completed',
    },
    session_paused: {
      icon: '⏸️',
      dotColor: 'bg-amber-500',
      badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
      badgeLabel: 'Session Paused',
    },
    insight_verified: {
      icon: '🛡️',
      dotColor: 'bg-emerald-500',
      badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
      badgeLabel: 'Insight Verified',
    },
    insight_rejected: {
      icon: '❌',
      dotColor: 'bg-red-500',
      badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
      badgeLabel: 'Insight Rejected',
    },
    insight_edited: {
      icon: '✏️',
      dotColor: 'bg-purple-500',
      badgeClass: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
      badgeLabel: 'Insight Edited',
    },
    insight_action: {
      icon: '🔍',
      dotColor: 'bg-gray-500',
      badgeClass: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300',
      badgeLabel: 'Insight Action',
    },
    note_created: {
      icon: '📝',
      dotColor: 'bg-cyan-500',
      badgeClass: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
      badgeLabel: 'Note Created',
    },
    bookmark_added: {
      icon: '⭐',
      dotColor: 'bg-yellow-500',
      badgeClass: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
      badgeLabel: 'Bookmark Added',
    },
    export_profile: {
      icon: '📤',
      dotColor: 'bg-teal-500',
      badgeClass: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
      badgeLabel: 'Profile Exported',
    },
  };

  const getActivityConfig = (type: string) => {
    return ACTIVITY_CONFIG[type] || {
      icon: '📌',
      dotColor: 'bg-gray-400',
      badgeClass: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300',
      badgeLabel: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    };
  };

  // Determine if user is brand new (no data at all)
  const isNewUser = !isLoading && stats && stats.topics === 0 && stats.sessions === 0 && stats.insights === 0;

  return (
    <div className="max-w-6xl mx-auto overflow-x-hidden">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
          {isNewUser ? `Welcome, ${user?.name || 'there'}!` : `Welcome back, ${user?.name || 'there'}`}
        </h1>
        <p className="mt-1 text-gray-600 dark:text-gray-300 text-sm sm:text-base">
          {isNewUser
            ? 'Let\u2019s get started building your personal knowledge system'
            : 'Here\u2019s your knowledge overview'}
        </p>
      </div>

      {/* Error state */}
      {error && (
        <ApiErrorAlert
          message={error}
          onRetry={() => { setError(null); setFetchVersion(v => v + 1); }}
          onDismiss={() => setError(null)}
          className="mb-6"
        />
      )}

      {/* New user get-started guidance */}
      {isNewUser && (
        <div className="mb-6 sm:mb-8 p-6 sm:p-8 rounded-2xl bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-indigo-900/20 dark:via-purple-900/20 dark:to-pink-900/20 border border-indigo-100 dark:border-indigo-800">
          <div className="text-center mb-6">
            <span className="text-4xl sm:text-5xl block mb-3">&#x1F680;</span>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-2">
              Get Started with me.md
            </h2>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 max-w-xl mx-auto">
              Build a comprehensive understanding of yourself through AI-guided conversations.
              Here&apos;s how to begin your journey in 3 simple steps:
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            {/* Step 1: Create */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-3">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 text-sm font-bold">
                  1
                </span>
                <h3 className="font-semibold text-gray-900 dark:text-white">Create a Topic</h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                Start by creating a topic you&apos;d like to explore &mdash; your values, skills, goals, or experiences.
              </p>
              <Link
                to="/app/topics/new"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Create Your First Topic
              </Link>
            </div>

            {/* Step 2: Interview */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-3">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 text-sm font-bold">
                  2
                </span>
                <h3 className="font-semibold text-gray-900 dark:text-white">Have an Interview</h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                Start an AI-guided conversation. The interviewer uses proven techniques to help you articulate your thoughts.
              </p>
              <Link
                to="/app/session/new"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Start Quick Interview
              </Link>
            </div>

            {/* Step 3: Verify */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-3">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-pink-100 dark:bg-pink-900/50 text-pink-600 dark:text-pink-400 text-sm font-bold">
                  3
                </span>
                <h3 className="font-semibold text-gray-900 dark:text-white">Verify Insights</h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                Review AI-extracted insights about you. Approve, edit, or reject each one to build your verified profile.
              </p>
              <Link
                to="/app/verify"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-pink-600 dark:text-pink-400 hover:text-pink-700 dark:hover:text-pink-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Go to Verification
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {statCards.map((stat) => (
          <div key={stat.label} className="card flex items-center gap-3 sm:gap-4 min-h-[80px] sm:min-h-[88px] p-4 sm:p-6">
            <span className="text-xl sm:text-2xl flex-shrink-0">{stat.icon}</span>
            <div className="min-w-0">
              {isLoading ? (
                <div className="h-7 sm:h-8 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              ) : (
                <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate">{stat.value}</p>
              )}
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-300">{stat.label}</p>
              {!isLoading && stat.sublabel && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{stat.sublabel}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Personality Assessment Widget */}
      {!isLoading && (
        <div className="card mb-6 sm:mb-8 p-4 sm:p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">🧠</span>
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                Personality Assessment
              </h2>
            </div>
            {assessmentStatus.hasTaken && assessmentStatus.attemptId && (
              <Link
                to={`/app/assessment/${assessmentStatus.attemptId}/results`}
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                View Details
              </Link>
            )}
          </div>

          {assessmentStatus.hasTaken && assessmentStatus.domainScores ? (
            <>
              <div className="flex items-center gap-2 sm:gap-3 mb-3">
                {assessmentStatus.domainScores.map(ds => {
                  const domainLabels: Record<string, string> = { O: 'Openness', C: 'Conscientiousness', E: 'Extraversion', A: 'Agreeableness', N: 'Neuroticism' };
                  const domainColors: Record<string, string> = { O: 'bg-blue-500', C: 'bg-purple-500', E: 'bg-amber-500', A: 'bg-emerald-500', N: 'bg-rose-500' };
                  const pct = Math.round((ds.score / 5) * 100);
                  return (
                    <div key={ds.domain} className="flex-1 text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 truncate" title={domainLabels[ds.domain] || ds.domain}>
                        {domainLabels[ds.domain] || ds.domain}
                      </p>
                      <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${domainColors[ds.domain] || 'bg-gray-500'} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-1">
                        {ds.score.toFixed(1)}
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Last taken: {assessmentStatus.lastCompletedAt ? formatActivityDate(assessmentStatus.lastCompletedAt) : 'Unknown'}
                </p>
                <Link
                  to="/app/assessment"
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  Take again
                </Link>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">
                  Discover your Big Five personality traits with a scientifically-validated assessment.
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  120 questions &middot; ~15 minutes
                </p>
              </div>
              <Link
                to="/app/assessment"
                className="btn-primary text-sm whitespace-nowrap flex-shrink-0"
              >
                Take Test
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Knowledge Completeness by Category */}
      <div className="card mb-6 sm:mb-8 p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2 sm:mb-4">
          Knowledge Completeness
        </h2>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-300 mb-4 sm:mb-6">
          Track your progress across the 5 knowledge categories
        </p>
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            ))}
          </div>
        ) : stats?.categoryCompleteness && stats.categoryCompleteness.length > 0 ? (
          <div className="space-y-4 sm:space-y-5">
            {stats.categoryCompleteness.map((cat) => {
              const colors = CATEGORY_COLORS[cat.category] || CATEGORY_COLORS.identity;
              const icon = CATEGORY_ICONS[cat.category] || '📂';
              return (
                <div key={cat.category}>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-1.5 gap-0.5 sm:gap-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base flex-shrink-0">{icon}</span>
                      <span className={`text-sm font-medium ${colors.text} truncate`}>
                        {cat.label}
                      </span>
                      {/* Show percentage inline on mobile */}
                      <span className="sm:hidden text-xs font-semibold text-gray-700 dark:text-gray-300 ml-auto">
                        {cat.completeness}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 text-xs text-gray-500 dark:text-gray-300 flex-shrink-0 pl-7 sm:pl-0">
                      <span>{cat.exploredTopics}/{cat.totalTopics} topics</span>
                      <span>{cat.verifiedInsights} verified</span>
                      <span className="hidden sm:inline font-semibold text-gray-700 dark:text-gray-300">
                        {cat.completeness}%
                      </span>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className={`w-full h-2.5 sm:h-3 rounded-full ${colors.bg} overflow-hidden`}>
                    <div
                      className={`h-full rounded-full ${colors.fill} transition-all duration-500 ease-out`}
                      style={{ width: `${cat.completeness}%`, minWidth: cat.completeness > 0 ? '8px' : '0px' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-gray-500 dark:text-gray-300 text-sm">
              No categorized topics yet. Create topics with preset categories to see progress here.
            </p>
            <Link to="/app/topics" className="text-indigo-600 dark:text-indigo-300 text-sm hover:underline mt-2 inline-block min-h-[44px] flex items-center justify-center">
              Browse Topics
            </Link>
          </div>
        )}
      </div>

      {/* Insights per Topic Breakdown */}
      <div className="card mb-6 sm:mb-8 p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2 sm:mb-4">
          Insights per Topic
        </h2>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-300 mb-4 sm:mb-6">
          Breakdown of insights across your topics
        </p>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            ))}
          </div>
        ) : stats?.topicInsightBreakdown && stats.topicInsightBreakdown.length > 0 ? (
          <div className="space-y-3">
            {stats.topicInsightBreakdown.map((topic) => {
              const maxInsights = Math.max(...stats.topicInsightBreakdown.map(t => t.totalInsights), 1);
              const barWidth = Math.round((topic.totalInsights / maxInsights) * 100);
              const categoryIcon = CATEGORY_ICONS[topic.category] || '📂';
              return (
                <div key={topic.topicId} className="group">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-sm flex-shrink-0">{categoryIcon}</span>
                      <Link
                        to={`/app/topics/${topic.topicId}`}
                        className="text-sm font-medium text-gray-900 dark:text-white truncate hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        title={topic.topicTitle}
                      >
                        {topic.topicTitle}
                      </Link>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 text-xs text-gray-500 dark:text-gray-300 flex-shrink-0 ml-2">
                      <span className="font-semibold text-gray-700 dark:text-gray-200">{topic.totalInsights}</span>
                      {topic.verified > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400" title="Verified">{topic.verified} verified</span>
                      )}
                      {topic.unverified > 0 && (
                        <span className="text-amber-600 dark:text-amber-400 hidden sm:inline" title="Pending">{topic.unverified} pending</span>
                      )}
                      {topic.rejected > 0 && (
                        <span className="text-red-600 dark:text-red-400 hidden sm:inline" title="Rejected">{topic.rejected} rejected</span>
                      )}
                    </div>
                  </div>
                  {/* Stacked bar showing verified/unverified/rejected proportions */}
                  <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full flex" style={{ width: `${barWidth}%`, minWidth: barWidth > 0 ? '8px' : '0px' }}>
                      {topic.verified > 0 && (
                        <div
                          className="h-full bg-emerald-500 transition-all duration-500"
                          style={{ width: `${(topic.verified / topic.totalInsights) * 100}%` }}
                        />
                      )}
                      {topic.unverified > 0 && (
                        <div
                          className="h-full bg-amber-400 transition-all duration-500"
                          style={{ width: `${(topic.unverified / topic.totalInsights) * 100}%` }}
                        />
                      )}
                      {topic.rejected > 0 && (
                        <div
                          className="h-full bg-red-400 transition-all duration-500"
                          style={{ width: `${(topic.rejected / topic.totalInsights) * 100}%` }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {/* Legend */}
            <div className="flex items-center gap-4 pt-2 text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span>Verified</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span>Pending</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <span>Rejected</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-gray-500 dark:text-gray-300 text-sm">
              No insights yet. Start an interview session to generate insights from your topics.
            </p>
            <Link to="/app/session/new" className="text-indigo-600 dark:text-indigo-300 text-sm hover:underline mt-2 inline-block min-h-[44px] flex items-center justify-center">
              Start Interview
            </Link>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="card mb-6 sm:mb-8 p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">
          Quick Actions
        </h2>
        <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 mb-4">
          Jump into an interview, create a topic, or explore your knowledge graph.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <Link to="/app/session/new" className="btn-primary text-center min-h-[44px] flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Start Interview
          </Link>
          <Link to="/app/topics/new" className="btn-secondary text-center min-h-[44px] flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Create Topic
          </Link>
          <Link to="/app/graph" className="btn-secondary text-center min-h-[44px] flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Explore Graph
          </Link>
          <Link to="/app/topics" className="btn-secondary text-center min-h-[44px] flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            Browse Topics
          </Link>
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="card p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Recent Activity
        </h2>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-300 mb-3 sm:mb-4">
          Your latest actions across the platform
        </p>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            ))}
          </div>
        ) : activity.length === 0 ? (
          <div className="text-center py-8">
            <span className="text-3xl block mb-2">&#x1F4AD;</span>
            <p className="text-gray-500 dark:text-gray-300 text-sm mb-3">
              No activity yet. Your recent actions will appear here as you use the platform.
            </p>
            <Link
              to="/app/topics/new"
              className="text-indigo-600 dark:text-indigo-400 text-sm font-medium hover:underline"
            >
              Create your first topic to get started &rarr;
            </Link>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[19px] sm:left-[23px] top-4 bottom-4 w-0.5 bg-gray-200 dark:bg-gray-700" />
            <div className="space-y-1">
              {activity.map((item) => {
                const config = getActivityConfig(item.type);
                return (
                  <div
                    key={item.id}
                    className="relative flex items-start gap-3 sm:gap-4 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors min-h-[56px] group"
                  >
                    {/* Timeline dot with icon */}
                    <div className="relative z-10 flex-shrink-0 mt-0.5">
                      <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full ${config.dotColor} ring-2 ring-white dark:ring-gray-900 group-hover:ring-gray-50 dark:group-hover:ring-gray-800 flex items-center justify-center text-sm`}>
                        <span className="text-white text-xs sm:text-sm">{config.icon}</span>
                      </div>
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {item.description}
                        </p>
                        <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${config.badgeClass}`}>
                          {config.badgeLabel}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-300 mt-0.5">
                        {formatActivityDate(item.date)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
