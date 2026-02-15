import { useAuth } from '@/contexts/AuthContext';

export default function DashboardPage() {
  const { user } = useAuth();

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
        {[
          { label: 'Topics Explored', value: '0', icon: '📋' },
          { label: 'Verified Insights', value: '0', icon: '✅' },
          { label: 'Sessions Completed', value: '0', icon: '💬' },
          { label: 'Knowledge Score', value: '—', icon: '📊' },
        ].map((stat) => (
          <div key={stat.label} className="card flex items-center gap-4">
            <span className="text-2xl">{stat.icon}</span>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
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
          <button className="btn-primary">Start Quick Interview</button>
          <button className="btn-secondary">Browse Topics</button>
        </div>
      </div>

      {/* Recent activity - empty state */}
      <div className="mt-8 card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Recent Activity
        </h2>
        <div className="text-center py-8">
          <p className="text-gray-500 dark:text-gray-400">
            No activity yet. Start your first interview session to see activity here.
          </p>
        </div>
      </div>
    </div>
  );
}
