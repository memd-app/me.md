import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getTopics, getTopicSuggestions, acceptTopicSuggestion } from '@/services/topics';
import { formatShortDate } from '@/utils/dateFormat';

const TOPICS_PER_PAGE = 10;

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

interface AISuggestion {
  title: string;
  description: string;
  category: string;
  intent: string;
  tags: string[];
  suggestedQuestion: string;
  rationale: string;
  source: 'ai' | 'preset';
}

export default function TopicsPage() {
  const { user } = useUser();
  const db = useDatabase();
  const [searchParams, setSearchParams] = useSearchParams();
  const [topics, setTopics] = useState<Topic[]>([]);
  // Initialize filter state from URL params for deep-linking support
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || 'all');
  const [priorityFilter, setPriorityFilter] = useState(() => searchParams.get('priority') || 'all');
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    const sortParam = searchParams.get('sort');
    return (sortParam && sortParam in SORT_LABELS) ? sortParam as SortOption : 'date_newest';
  });
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(() => {
    const pageParam = searchParams.get('page');
    return pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;
  });
  const [fetchVersion, setFetchVersion] = useState(0);
  const exploreCategory = searchParams.get('explore');

  // AI topic suggestions state
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [suggestionsMessage, setSuggestionsMessage] = useState('');
  const [suggestionsSource, setSuggestionsSource] = useState<'ai' | 'preset' | ''>('');
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [acceptingIndex, setAcceptingIndex] = useState<number | null>(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());

  const fetchTopics = useCallback(async (signal?: AbortSignal, isBackground = false) => {
    if (!user) return;
    // For background re-fetches (tab focus, page navigation), don't clear existing data
    if (isBackground) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      const data = getTopics(db);
      setTopics((data || []) as Topic[]);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load topics');
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [user]);

  useEffect(() => {
    const controller = new AbortController();
    // fetchVersion > 0 means this is a background re-fetch (tab focus, page change)
    const isBackground = fetchVersion > 0;
    fetchTopics(controller.signal, isBackground);
    return () => controller.abort();
  }, [fetchTopics, fetchVersion]);

  // Re-fetch topics when the page becomes visible again (e.g., returning from another tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setFetchVersion(v => v + 1);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Also re-fetch when window gets focus (covers tab switching in same browser)
  useEffect(() => {
    const handleFocus = () => {
      setFetchVersion(v => v + 1);
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // Fetch AI topic suggestions
  const fetchSuggestions = useCallback(async () => {
    if (!user) return;
    setIsSuggestionsLoading(true);
    setSuggestionsError(null);
    try {
      const data = await getTopicSuggestions(db);
      setSuggestions(data.suggestions || []);
      setSuggestionsMessage(data.message || '');
      setSuggestionsSource(data.source || 'preset');
    } catch (err) {
      setSuggestionsError(err instanceof Error ? err.message : 'Failed to load suggestions');
    } finally {
      setIsSuggestionsLoading(false);
    }
  }, [user]);

  // Load suggestions on mount (after initial topics load)
  useEffect(() => {
    if (!isLoading && user) {
      fetchSuggestions();
    }
  }, [isLoading, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Accept a suggestion: create it as a real topic
  const handleAcceptSuggestion = async (suggestion: AISuggestion, index: number) => {
    if (!user || acceptingIndex !== null) return;
    setAcceptingIndex(index);
    try {
      acceptTopicSuggestion(db, {
          title: suggestion.title,
          description: suggestion.description,
          category: suggestion.category,
          intent: suggestion.intent,
          tags: suggestion.tags,
          suggestedQuestion: suggestion.suggestedQuestion,
        });
      // Refresh topics list
      setFetchVersion(v => v + 1);
      // Remove the accepted suggestion from the list
      setDismissedSuggestions(prev => new Set(prev).add(suggestion.title));
    } catch (err) {
      setSuggestionsError(err instanceof Error ? err.message : 'Failed to accept suggestion');
    } finally {
      setAcceptingIndex(null);
    }
  };

  // Dismiss a suggestion
  const handleDismissSuggestion = (title: string) => {
    setDismissedSuggestions(prev => new Set(prev).add(title));
  };

  // Filter out dismissed suggestions
  const visibleSuggestions = suggestions.filter(s => !dismissedSuggestions.has(s.title));

  const hasActiveFilters = statusFilter !== 'all' || priorityFilter !== 'all' || searchQuery.trim() !== '';

  const clearAllFilters = () => {
    setStatusFilter('all');
    setPriorityFilter('all');
    setSortBy('date_newest');
    setSearchQuery('');
    setCurrentPage(1);
    // Clear all filter-related URL params immediately
    const newParams = new URLSearchParams();
    // Preserve non-filter params like 'explore'
    const explore = searchParams.get('explore');
    if (explore) newParams.set('explore', explore);
    setSearchParams(newParams, { replace: true });
  };

  // Sync all filter state to URL params for deep linking and filter reset verification
  useEffect(() => {
    const newParams = new URLSearchParams();
    // Preserve non-filter params
    const explore = searchParams.get('explore');
    if (explore) newParams.set('explore', explore);

    // Set filter params (only include non-default values to keep URL clean)
    if (statusFilter !== 'all') newParams.set('status', statusFilter);
    if (priorityFilter !== 'all') newParams.set('priority', priorityFilter);
    if (sortBy !== 'date_newest') newParams.set('sort', sortBy);
    if (searchQuery.trim()) newParams.set('q', searchQuery.trim());
    if (currentPage > 1) newParams.set('page', String(currentPage));

    // Only update if actually different to avoid infinite loops
    const currentStr = searchParams.toString();
    const newStr = newParams.toString();
    if (currentStr !== newStr) {
      setSearchParams(newParams, { replace: true });
    }
  }, [statusFilter, priorityFilter, sortBy, searchQuery, currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter and sort topics - deduplicate by ID for consistency during data updates
  const filteredAndSortedTopics = useMemo(() => {
    // Deduplicate topics by ID to prevent gaps or duplicates during concurrent data changes
    const seen = new Set<string>();
    let result = topics.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    // Apply search query filter (matches title, description, and tags)
    const trimmedSearch = searchQuery.trim().toLowerCase();
    if (trimmedSearch) {
      result = result.filter((t) => {
        const titleMatch = t.title.toLowerCase().includes(trimmedSearch);
        const descMatch = t.description?.toLowerCase().includes(trimmedSearch) || false;
        const tagsMatch = t.tags?.toLowerCase().includes(trimmedSearch) || false;
        const intentMatch = t.intent?.toLowerCase().includes(trimmedSearch) || false;
        return titleMatch || descMatch || tagsMatch || intentMatch;
      });
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter((t) => t.status === statusFilter);
    }

    // Apply priority filter
    if (priorityFilter !== 'all') {
      result = result.filter((t) => t.priority === priorityFilter);
    }

    // Apply sorting with stable tiebreaker by ID to prevent item shifting when data changes
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name_asc':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'name_desc':
          cmp = b.title.localeCompare(a.title);
          break;
        case 'date_newest':
          cmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          break;
        case 'date_oldest':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'priority_high':
          cmp = (PRIORITY_ORDER[b.priority] || 0) - (PRIORITY_ORDER[a.priority] || 0);
          break;
        case 'priority_low':
          cmp = (PRIORITY_ORDER[a.priority] || 0) - (PRIORITY_ORDER[b.priority] || 0);
          break;
        default:
          cmp = 0;
      }
      // Stable tiebreaker: sort by ID when primary sort key is equal
      // This ensures consistent ordering even when data changes between fetches
      if (cmp === 0) {
        cmp = a.id.localeCompare(b.id);
      }
      return cmp;
    });

    return result;
  }, [topics, statusFilter, priorityFilter, sortBy, searchQuery]);

  // Pagination computed values with immediate clamping for consistency during data updates.
  // Instead of clamping in a useEffect (which causes a render with stale page), we compute
  // the effective page inline so the UI never shows an empty/invalid page.
  const totalFilteredTopics = filteredAndSortedTopics.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredTopics / TOPICS_PER_PAGE));

  // effectivePage is clamped immediately — no flash of empty page when items are deleted
  const effectivePage = Math.min(currentPage, totalPages);

  // Sync state if clamped (so URL param and state stay correct)
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedTopics = useMemo(() => {
    const start = (effectivePage - 1) * TOPICS_PER_PAGE;
    return filteredAndSortedTopics.slice(start, start + TOPICS_PER_PAGE);
  }, [filteredAndSortedTopics, effectivePage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, priorityFilter, sortBy, searchQuery]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Re-fetch fresh data when navigating pages to catch any data updates
    setFetchVersion(v => v + 1);
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const getPageNumbers = (): (number | 'ellipsis')[] => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      // Show all pages if 7 or fewer
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Smart ellipsis — use effectivePage for consistent display during data updates
      pages.push(1);
      if (effectivePage > 3) {
        pages.push('ellipsis');
      }
      const start = Math.max(2, effectivePage - 1);
      const end = Math.min(totalPages - 1, effectivePage + 1);
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      if (effectivePage < totalPages - 2) {
        pages.push('ellipsis');
      }
      pages.push(totalPages);
    }
    return pages;
  };

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
        {/* Search Input */}
        <div className="mb-3">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-1.5 block">
            Search
          </label>
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search topics by name, description, or tags..."
              className="input-field !py-2 !pl-10 !pr-10 text-sm w-full"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                title="Clear search"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

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
              {searchQuery.trim() && (
                <span className="ml-1">
                  | Search: <span className="font-medium">&quot;{searchQuery.trim()}&quot;</span>
                </span>
              )}
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

      {/* AI-Powered Topic Suggestions */}
      {!isLoading && visibleSuggestions.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setShowSuggestions(!showSuggestions)}
              className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showSuggestions ? 'rotate-0' : '-rotate-90'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              {suggestionsSource === 'ai' ? (
                <span className="flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white text-xs">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </span>
                  AI-Suggested Topics
                </span>
              ) : (
                <span>Suggested Topics</span>
              )}
              <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">
                ({visibleSuggestions.length})
              </span>
            </button>
            <div className="flex items-center gap-2">
              {suggestionsSource === 'ai' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                  Personalized
                </span>
              )}
              <button
                onClick={fetchSuggestions}
                disabled={isSuggestionsLoading}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-1"
                title="Refresh suggestions"
              >
                <svg
                  className={`w-3.5 h-3.5 ${isSuggestionsLoading ? 'animate-spin' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>
          </div>

          {showSuggestions && (
            <div className="space-y-2">
              {suggestionsMessage && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{suggestionsMessage}</p>
              )}
              {suggestionsError && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 mb-2">
                  {suggestionsError}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleSuggestions.map((suggestion, idx) => (
                  <div
                    key={`${suggestion.title}-${idx}`}
                    className="relative card !p-4 border-l-4 border-l-purple-400 dark:border-l-purple-500 hover:shadow-md transition-shadow"
                  >
                    {/* Dismiss button */}
                    <button
                      onClick={() => handleDismissSuggestion(suggestion.title)}
                      className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                      title="Dismiss suggestion"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>

                    <div className="pr-6">
                      <div className="flex items-center gap-1.5 mb-1">
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white line-clamp-1">
                          {suggestion.title}
                        </h4>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mb-2">
                        {suggestion.description}
                      </p>

                      {/* Tags and category */}
                      <div className="flex flex-wrap items-center gap-1 mb-2">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 capitalize">
                          {suggestion.category}
                        </span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 capitalize">
                          {suggestion.intent}
                        </span>
                        {suggestion.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      {/* Rationale */}
                      {suggestion.rationale && suggestion.source === 'ai' && (
                        <p className="text-[11px] text-purple-600 dark:text-purple-400 mb-2 italic line-clamp-2">
                          {suggestion.rationale}
                        </p>
                      )}

                      {/* Suggested opening question */}
                      {suggestion.suggestedQuestion && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">
                          <span className="font-medium">Opening Q:</span> {suggestion.suggestedQuestion}
                        </p>
                      )}

                      {/* Accept button */}
                      <button
                        onClick={() => handleAcceptSuggestion(suggestion, idx)}
                        disabled={acceptingIndex !== null}
                        className="w-full px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors border border-primary-200 dark:border-primary-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                      >
                        {acceptingIndex === idx ? (
                          <>
                            <div className="animate-spin w-3 h-3 border-2 border-primary-300 border-t-primary-600 rounded-full" />
                            Adding...
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                            Add to My Topics
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isSuggestionsLoading && suggestions.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-4">
              <div className="animate-spin w-4 h-4 border-2 border-gray-300 border-t-primary-500 rounded-full" />
              <span>Generating topic suggestions...</span>
            </div>
          )}
        </div>
      )}

      {/* Suggestions loading state (when no existing suggestions to show) */}
      {!isLoading && isSuggestionsLoading && suggestions.length === 0 && (
        <div className="mb-6 card !p-6 text-center">
          <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-purple-500 rounded-full mx-auto mb-2" />
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Analyzing your knowledge profile for personalized topic suggestions...
          </p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <ApiErrorAlert
          message={error}
          onRetry={() => { setError(null); setFetchVersion(v => v + 1); }}
          onDismiss={() => setError(null)}
          className="mb-6"
        />
      )}

      {/* Loading state - only shown on initial load, not background refreshes */}
      {isLoading && topics.length === 0 && (
        <LoadingSpinner card message="Loading topics..." />
      )}

      {/* Subtle refreshing indicator for background re-fetches */}
      {isRefreshing && topics.length > 0 && (
        <div className="flex items-center gap-2 mb-3 text-sm text-gray-500 dark:text-gray-400">
          <div className="animate-spin w-3 h-3 border-2 border-gray-300 border-t-primary-500 rounded-full" />
          <span>Refreshing...</span>
        </div>
      )}

      {/* Topics list - show existing data even during background refreshes */}
      {(!isLoading || topics.length > 0) && paginatedTopics.length > 0 && (
        <div className="space-y-3">
          {paginatedTopics.map((topic) => (
            <Link
              key={topic.id}
              to={`/app/topics/${topic.id}`}
              className="card block hover:border-primary-300 dark:hover:border-primary-700 transition-colors overflow-hidden"
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
                  {formatShortDate(topic.createdAt)}
                </div>
              </div>
            </Link>
          ))}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div
              className="flex items-center justify-between pt-4 mt-2 border-t border-gray-200 dark:border-dark-border"
              data-testid="topics-pagination"
              data-current-page={effectivePage}
              data-total-pages={totalPages}
              data-total-items={totalFilteredTopics}
            >
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Showing {((effectivePage - 1) * TOPICS_PER_PAGE) + 1}–{Math.min(effectivePage * TOPICS_PER_PAGE, totalFilteredTopics)} of {totalFilteredTopics} topics
              </p>
              <nav className="flex items-center gap-1" aria-label="Topics pagination">
                {/* Previous button */}
                <button
                  onClick={() => handlePageChange(effectivePage - 1)}
                  disabled={effectivePage <= 1}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    effectivePage <= 1
                      ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  aria-label="Previous page"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                {/* Page numbers */}
                {getPageNumbers().map((pageNum, idx) =>
                  pageNum === 'ellipsis' ? (
                    <span key={`ellipsis-${idx}`} className="px-2 py-1 text-gray-400 dark:text-gray-500 text-sm">
                      ...
                    </span>
                  ) : (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`min-w-[36px] px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        pageNum === effectivePage
                          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      aria-label={`Page ${pageNum}`}
                      aria-current={pageNum === effectivePage ? 'page' : undefined}
                    >
                      {pageNum}
                    </button>
                  )
                )}

                {/* Next button */}
                <button
                  onClick={() => handlePageChange(effectivePage + 1)}
                  disabled={effectivePage >= totalPages}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    effectivePage >= totalPages
                      ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  aria-label="Next page"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </nav>
            </div>
          )}
        </div>
      )}

      {/* Empty state - don't show during background refreshes */}
      {!isLoading && !isRefreshing && filteredAndSortedTopics.length === 0 && !error && (
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
