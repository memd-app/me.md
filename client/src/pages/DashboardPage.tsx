import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface DashboardStats {
  topics: number;
  sessions: number;
  completedSessions: number;
  insights: number;
  verifiedInsights: number;
  notes: number;
}

interface ActivityItem {
  id: string;
  type: string;
  title: string;
  status: string;
  date: string;
}

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
    { label: 'Topics Explored', value: stats?.topics ?? 0, icon: '📋' },
    { label: 'Verified Insights', value: stats?.verifiedInsights ?? 0, icon: '✅' },
    { label: 'Sessions Completed', value: stats?.completedSessions ?? 0, icon: '💬' },
    { label: 'Total Insights', value: stats?.insights ?? 0, icon: '📊' },
  ];

  const SESSION_STATUS_LABELS: Record<string, string> = {
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
    abandoned: 'Abandoned',
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Welcome back, {user?.name || 'there'}
        </h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Here&apos;s your knowledge overview
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((stat) => (
          <div key={stat.label} className="card flex items-center gap-4">
            <span className="text-2xl">{stat.icon}</span>
            <div>
              {isLoading ? (
                <div className="h-8 w-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              ) : (
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Get Started
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Start your journey by exploring a topic and having your first AI-guided interview.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/app/new-session" className="btn-primary">Start Quick Interview</Link>
          <Link to="/app/topics" className="btn-secondary">Browse Topics</Link>
        </div>
      </div>

      {/* Recent activity */}
      <div className="mt-8 card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Recent Activity
        </h2>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            ))}
          </div>
        ) : activity.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400">
              No activity yet. Start your first interview session to see activity here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activity.map((item) => (
              <Link
                key={item.id}
                to={`/app/session/${item.id}`}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">💬</span>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {item.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {SESSION_STATUS_LABELS[item.status] || item.status}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {new Date(item.date).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
