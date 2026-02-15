import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface Topic {
  id: string;
  title: string;
  description: string | null;
  tags: string | null;
  status: string;
  priority: string;
  intent: string | null;
  trigger: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  extracted: 'Extracted',
  refined: 'Refined',
};

const STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  extracted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  refined: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
};

const PRIORITY_ICONS: Record<string, string> = {
  low: '🔽',
  medium: '➡️',
  high: '🔼',
};

export default function TopicsPage() {
  const { user } = useAuth();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [filter, setFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const fetchTopics = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/topics', {
          headers: { 'x-user-id': user.id },
        });
        if (!res.ok) {
          throw new Error('Failed to load topics');
        }
        const data = await res.json();
        setTopics(data.topics || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load topics');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTopics();
  }, [user]);

  const filteredTopics = filter === 'all'
    ? topics
    : topics.filter((t) => t.status === filter);

  const parseTags = (tagsStr: string | null): string[] => {
    if (!tagsStr) return [];
    try {
      return JSON.parse(tagsStr);
    } catch {
      return [];
    }
  };

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
        {['all', 'backlog', 'scheduled', 'in_progress', 'extracted', 'refined'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
            }`}
          >
            {status === 'all' ? 'All' : STATUS_LABELS[status] || status}
            {status === 'all' && topics.length > 0 && (
              <span className="ml-1 text-xs">({topics.length})</span>
            )}
            {status !== 'all' && topics.filter((t) => t.status === status).length > 0 && (
              <span className="ml-1 text-xs">({topics.filter((t) => t.status === status).length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 mb-6">
          {error}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="card text-center py-12">
          <div className="animate-spin inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full mb-3" />
          <p className="text-gray-600 dark:text-gray-400">Loading topics...</p>
        </div>
      )}

      {/* Topics list */}
      {!isLoading && filteredTopics.length > 0 && (
        <div className="space-y-3">
          {filteredTopics.map((topic) => (
            <Link
              key={topic.id}
              to={`/app/topics/${topic.id}`}
              className="card block hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                      {topic.title}
                    </h3>
                    <span className="text-sm" title={`Priority: ${topic.priority}`}>
                      {PRIORITY_ICONS[topic.priority] || ''}
                    </span>
                  </div>
                  {topic.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-2">
                      {topic.description}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[topic.status] || STATUS_COLORS.backlog}`}>
                      {STATUS_LABELS[topic.status] || topic.status}
                    </span>
                    {topic.intent && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                        {topic.intent}
                      </span>
                    )}
                    {parseTags(topic.tags).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 ml-4 shrink-0">
                  {new Date(topic.createdAt).toLocaleDateString()}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredTopics.length === 0 && !error && (
        <div className="card text-center py-12">
          <span className="text-4xl block mb-3">📋</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {filter === 'all' ? 'No topics yet' : `No ${STATUS_LABELS[filter] || filter} topics`}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {filter === 'all'
              ? 'Create your first topic to start exploring your knowledge.'
              : 'No topics match this filter.'}
          </p>
          {filter === 'all' && (
            <Link to="/app/topics/new" className="btn-primary inline-block">
              Create Your First Topic
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
