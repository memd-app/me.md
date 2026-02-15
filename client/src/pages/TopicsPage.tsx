import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function TopicsPage() {
  const [filter, setFilter] = useState('all');

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Topics</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Manage your interview topics and knowledge areas
          </p>
        </div>
        <Link to="/app/topics/new" className="btn-primary">
          + New Topic
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {['all', 'backlog', 'in_progress', 'extracted', 'refined'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
            }`}
          >
            {status === 'all' ? 'All' : status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Topics list - empty state */}
      <div className="card text-center py-12">
        <span className="text-4xl block mb-3">📋</span>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          No topics yet
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Create your first topic to start exploring your knowledge.
        </p>
        <Link to="/app/topics/new" className="btn-primary inline-block">
          Create Your First Topic
        </Link>
      </div>
    </div>
  );
}
