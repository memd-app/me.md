import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  isPreset: boolean;
  presetCategory: string | null;
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

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const PRIORITY_ICONS: Record<string, string> = {
  low: '🔽',
  medium: '➡️',
  high: '🔼',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  medium: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  high: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
};

type SortOption = 'name_asc' | 'name_desc' | 'date_newest' | 'date_oldest' | 'priority_high' | 'priority_low';

const SORT_LABELS: Record<SortOption, string> = {
  name_asc: 'Name (A-Z)',
  name_desc: 'Name (Z-A)',
  date_newest: 'Newest First',
  date_oldest: 'Oldest First',
  priority_high: 'Priority (High-Low)',
  priority_low: 'Priority (Low-High)',
};

const PRIORITY_ORDER: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const EXPLORE_CATEGORY_LABELS: Record<string, string> = {
  identity: 'Identity',
  skills: 'Skills',
  experiences: 'Experiences',
  perspectives: 'Perspectives',
  goals: 'Goals',
};

const EXPLORE_CATEGORY_DESCRIPTIONS: Record<string, string> = {
  identity: 'Explore your core values, beliefs, personality traits, and what makes you who you are.',
  skills: 'Discover and document your abilities, expertise, and areas of competence.',
  experiences: 'Reflect on significant life events, milestones, and formative experiences.',
  perspectives: 'Examine your worldviews, opinions, and how you see different aspects of life.',
  goals: 'Clarify your aspirations, objectives, and what you want to achieve.',
};

export default function TopicsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sortBy, setSortBy] = useState<SortOption>('date_newest');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const exploreCategory = searchParams.get('explore');

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

  const hasActiveFilters = statusFilter !== 'all' || priorityFilter !== 'all';

  const clearAllFilters = () => {
    setStatusFilter('all');
    setPriorityFilter('all');
    setSortBy('date_newest');
  };

  // Filter and sort topics
  const filteredAndSortedTopics = useMemo(() => {
    let result = [...topics];

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter((t) => t.status === statusFilter);
    }

    // Apply priority filter
    if (priorityFilter !== 'all') {
      result = result.filter((t) => t.priority === priorityFilter);
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'name_asc':
          return a.title.localeCompare(b.title);
        case 'name_desc':
          return b.title.localeCompare(a.title);
        case 'date_newest':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'date_oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'priority_high':
          return (PRIORITY_ORDER[b.priority] || 0) - (PRIORITY_ORDER[a.priority] || 0);
        case 'priority_low':
          return (PRIORITY_ORDER[a.priority] || 0) - (PRIORITY_ORDER[b.priority] || 0);
        default:
          return 0;
      }
    });

    return result;
  }, [topics, statusFilter, priorityFilter, sortBy]);

  const parseTags = (tagsStr: string | null): string[] => {
    if (!tagsStr) return [];
    try {
      return JSON.parse(tagsStr);
    } catch {
      return [];
    }
  };

  // Count topics per status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    topics.forEach((t) => {
      counts[t.status] = (counts[t.status] || 0) + 1;
    });
    return counts;
  }, [topics]);

  // Count topics per priority
  const priorityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    topics.forEach((t) => {
      counts[t.priority] = (counts[t.priority] || 0) + 1;
    });
    return counts;
  }, [topics]);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Topics</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-300">
            Manage your interview topics and knowledge areas
            {!isLoading && topics.length > 0 && (
              <span className="ml-1 text-gray-500 dark:text-gray-400">
                ({topics.length} total)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/app/templates"
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
            Templates
          </Link>
          <Link to="/app/topics/new" className="btn-primary">
            + New Topic
          </Link>
        </div>
      </div>

      {/* Explore category banner (from knowledge graph gap click) */}
      {exploreCategory && EXPLORE_CATEGORY_LABELS[exploreCategory] && (
        <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400 text-lg font-bold shrink-0">
                ?
              </div>
              <div>
                <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Start exploring: {EXPLORE_CATEGORY_LABELS[exploreCategory]}
                </h3>
                <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-300">
                  {EXPLORE_CATEGORY_DESCRIPTIONS[exploreCategory]}
                </p>
                <div className="mt-2 flex gap-2">
                  <Link
                    to="/app/topics/new"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Create a {EXPLORE_CATEGORY_LABELS[exploreCategory]} Topic
                  </Link>
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                const newParams = new URLSearchParams(searchParams);
                newParams.delete('explore');
                setSearchParams(newParams);
              }}
              className="text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200 shrink-0"
              title="Dismiss"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Filters and Sort Controls */}
      <div className="card mb-6 !p-4">
        {/* Status Filter Row */}
        <div className="mb-3">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-1.5 block">
            Status
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === 'all'
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
              }`}
            >
              All
              {topics.length > 0 && (
                <span className="ml-1 text-xs">({topics.length})</span>
              )}
            </button>
            {['backlog', 'scheduled', 'in_progress', 'extracted', 'refined'].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === status
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                }`}
              >
                {STATUS_LABELS[status] || status}
                {(statusCounts[status] || 0) > 0 && (
                  <span className="ml-1 text-xs">({statusCounts[status]})</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Priority Filter and Sort Row */}
        <div className="flex flex-wrap items-end gap-4">
          {/* Priority Filter */}
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-1.5 block">
              Priority
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setPriorityFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  priorityFilter === 'all'
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                }`}
              >
                All
              </button>
              {['high', 'medium', 'low'].map((priority) => (
                <button
                  key={priority}
                  onClick={() => setPriorityFilter(priority)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    priorityFilter === priority
                      ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                  }`}
                >
                  {PRIORITY_ICONS[priority]} {PRIORITY_LABELS[priority]}
                  {(priorityCounts[priority] || 0) > 0 && (
                    <span className="ml-1 text-xs">({priorityCounts[priority]})</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Sort Selector */}
          <div className="min-w-[180px]">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-1.5 block">
              Sort by
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="input-field !py-1.5 text-sm"
            >
              {(Object.entries(SORT_LABELS) as [SortOption, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              Clear Filters
            </button>
          )}
        </div>

        {/* Active filter summary */}
        {hasActiveFilters && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-dark-border">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Showing {filteredAndSortedTopics.length} of {topics.length} topics
              {statusFilter !== 'all' && (
                <span className="ml-1">
                  | Status: <span className="font-medium">{STATUS_LABELS[statusFilter]}</span>
                </span>
              )}
              {priorityFilter !== 'all' && (
                <span className="ml-1">
                  | Priority: <span className="font-medium">{PRIORITY_LABELS[priorityFilter]}</span>
                </span>
              )}
            </p>
          </div>
        )}
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
          <p className="text-gray-600 dark:text-gray-300">Loading topics...</p>
        </div>
      )}

      {/* Topics list */}
      {!isLoading && filteredAndSortedTopics.length > 0 && (
        <div className="space-y-3">
          {filteredAndSortedTopics.map((topic) => (
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
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[topic.priority] || PRIORITY_COLORS.medium}`}
                      title={`Priority: ${PRIORITY_LABELS[topic.priority] || topic.priority}`}
                    >
                      {PRIORITY_ICONS[topic.priority] || ''} {PRIORITY_LABELS[topic.priority] || topic.priority}
                    </span>
                  </div>
                  {topic.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mb-2">
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
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-300 ml-4 shrink-0">
                  {new Date(topic.createdAt).toLocaleDateString()}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredAndSortedTopics.length === 0 && !error && (
        <div className="card text-center py-12">
          <span className="text-4xl block mb-3">📋</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {hasActiveFilters ? 'No matching topics' : 'No topics yet'}
          </h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            {hasActiveFilters
              ? 'No topics match the current filters. Try adjusting or clearing your filters.'
              : 'Create your first topic to start exploring your knowledge.'}
          </p>
          {hasActiveFilters ? (
            <button
              onClick={clearAllFilters}
              className="btn-secondary inline-block"
            >
              Clear All Filters
            </button>
          ) : (
            <Link to="/app/topics/new" className="btn-primary inline-block">
              Create Your First Topic
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
