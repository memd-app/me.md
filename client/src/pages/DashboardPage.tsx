import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface CategoryCompleteness {
  category: string;
  label: string;
  totalTopics: number;
  exploredTopics: number;
  totalInsights: number;
  verifiedInsights: number;
  completeness: number;
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
}

interface ActivityItem {
  id: string;
  type: string;
  title: string;
  status: string;
  date: string;
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

  useEffect(() => {
    if (!user) return;

    const fetchDashboard = async () => {
      setIsLoading(true);
      try {
        const [statsRes, activityRes] = await Promise.all([
          fetch('/api/dashboard/stats', { headers: { 'x-user-id': user.id } }),
          fetch('/api/dashboard/activity', { headers: { 'x-user-id': user.id } }),
        ]);

        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        }

        if (activityRes.ok) {
          const activityData = await activityRes.json();
          setActivity(activityData.activity || []);
        }
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboard();
  }, [user]);

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

  const SESSION_STATUS_LABELS: Record<string, string> = {
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
    abandoned: 'Abandoned',
  };

  return (
    <div className="max-w-6xl mx-auto overflow-x-hidden">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
          Welcome back, {user?.name || 'there'}
        </h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400 text-sm sm:text-base">
          Here&apos;s your knowledge overview
        </p>
      </div>

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
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{stat.label}</p>
              {!isLoading && stat.sublabel && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{stat.sublabel}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Knowledge Completeness by Category */}
      <div className="card mb-6 sm:mb-8 p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2 sm:mb-4">
          Knowledge Completeness
        </h2>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-4 sm:mb-6">
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
                      <span className={`text-sm font-medium ${colors.text}`}>
                        {cat.label}
                      </span>
                      {/* Show percentage inline on mobile */}
                      <span className="sm:hidden text-xs font-semibold text-gray-700 dark:text-gray-300 ml-auto">
                        {cat.completeness}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 pl-7 sm:pl-0">
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
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              No categorized topics yet. Create topics with preset categories to see progress here.
            </p>
            <Link to="/app/topics" className="text-indigo-600 dark:text-indigo-400 text-sm hover:underline mt-2 inline-block min-h-[44px] flex items-center justify-center">
              Browse Topics
            </Link>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="card mb-6 sm:mb-8 p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">
          Get Started
        </h2>
        <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mb-4">
          Start your journey by exploring a topic and having your first AI-guided interview.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link to="/app/new-session" className="btn-primary text-center min-h-[44px] flex items-center justify-center">
            Start Quick Interview
          </Link>
          <Link to="/app/topics" className="btn-secondary text-center min-h-[44px] flex items-center justify-center">
            Browse Topics
          </Link>
        </div>
      </div>

      {/* Session History Timeline */}
      <div className="card p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Session History
        </h2>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-3 sm:mb-4">
          Your recent interview sessions, most recent first
        </p>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            ))}
          </div>
        ) : activity.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              No sessions yet. Start your first interview to see your session history here.
            </p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[19px] sm:left-[23px] top-4 bottom-4 w-0.5 bg-gray-200 dark:bg-gray-700" />
            <div className="space-y-1">
              {activity.map((item) => {
                const sessionDate = new Date(item.date);
                const statusColor = item.status === 'completed'
                  ? 'bg-green-500'
                  : item.status === 'active'
                    ? 'bg-blue-500'
                    : item.status === 'paused'
                      ? 'bg-amber-500'
                      : 'bg-gray-400';
                return (
                  <Link
                    key={item.id}
                    to={`/app/session/${item.id}`}
                    className="relative flex items-start gap-3 sm:gap-4 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors min-h-[56px] active:bg-gray-100 dark:active:bg-gray-800 group"
                  >
                    {/* Timeline dot */}
                    <div className="relative z-10 flex-shrink-0 mt-1">
                      <div className={`w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full ${statusColor} ring-2 ring-white dark:ring-gray-900 group-hover:ring-gray-50 dark:group-hover:ring-gray-800`} />
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {item.title}
                        </p>
                        <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                          item.status === 'completed'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : item.status === 'active'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                              : item.status === 'paused'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                        }`}>
                          {SESSION_STATUS_LABELS[item.status] || item.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {sessionDate.toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          year: sessionDate.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
                        })}
                        {' at '}
                        {sessionDate.toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    {/* Arrow indicator */}
                    <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
