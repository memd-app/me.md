import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getTopics, getTopicSuggestions, acceptTopicSuggestion } from '@/services/topics';
import { formatShortDate } from '@/utils/dateFormat';
import { PageHeader, SectionHeading, EmptyState } from '@/components/ui';

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
  in_progress: 'In Progress',
  extracted: 'Extracted',
  refined: 'Refined',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
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

  // Compact toolbar dropdown: quiet small-caps label + borderless native select,
  // amber-tinted when a non-default value is active. Render layer only.
  const FilterSelect = ({
    label,
    value,
    onChange,
    options,
    active = false,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    active?: boolean;
  }) => (
    <label className="relative inline-flex items-center gap-1.5 cursor-pointer shrink-0">
      <span className="text-[10px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-400 dark:text-gray-600">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none bg-transparent border-0 pl-0 pr-5 py-1 text-sm font-medium cursor-pointer focus:outline-none focus:ring-0 ${
          active
            ? 'text-primary-700 dark:text-primary-400'
            : 'text-gray-700 dark:text-gray-300'
        }`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 dark:text-gray-600"
        fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </label>
  );

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Topics"
        subtitle={
          <>
            Manage your interview topics and knowledge areas
            {!isLoading && topics.length > 0 && ` — ${topics.length} total`}
          </>
        }
        actions={
          <>
            <Link
              to="/app/import"
              className="text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              Import
            </Link>
            <Link
              to="/app/templates"
              className="text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              Templates
            </Link>
            <Link to="/app/topics/new" className="btn-primary">
              + New Topic
            </Link>
          </>
        }
      />

      {/* Explore category banner (from knowledge graph gap click) */}
      {exploreCategory && EXPLORE_CATEGORY_LABELS[exploreCategory] && (
        <div className="mb-8 border border-rule dark:border-dark-border bg-panel dark:bg-dark-card rounded-lg px-6 py-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] tracking-[0.14em] uppercase font-sans font-bold text-primary-600 dark:text-primary-400 mb-1.5">
              Start exploring
            </p>
            <h3 className="font-serif italic text-xl text-gray-900 dark:text-white mb-1.5">
              {EXPLORE_CATEGORY_LABELS[exploreCategory]}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 max-w-xl mb-3">
              {EXPLORE_CATEGORY_DESCRIPTIONS[exploreCategory]}
            </p>
            <Link
              to="/app/topics/new"
              className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.08em] uppercase font-sans font-bold text-primary-600 dark:text-primary-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Create a {EXPLORE_CATEGORY_LABELS[exploreCategory]} topic
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
          <button
            onClick={() => {
              const newParams = new URLSearchParams(searchParams);
              newParams.delete('explore');
              setSearchParams(newParams);
            }}
            className="text-gray-400 hover:text-primary-600 dark:text-gray-600 dark:hover:text-primary-400 shrink-0 transition-colors"
            title="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Filter toolbar — single line: search grows, quiet dropdowns right */}
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule dark:border-dark-border pb-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <svg
              className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-600"
              fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search topics…"
              aria-label="Search topics by name, description, or tags"
              className="w-full bg-transparent border-0 pl-7 pr-8 py-1.5 text-sm text-ink dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-0"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary-600 dark:text-gray-600 dark:hover:text-primary-400"
                title="Clear search"
                aria-label="Clear search"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <span className="hidden sm:block w-px h-5 bg-rule dark:bg-dark-border" aria-hidden="true" />

          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            active={statusFilter !== 'all'}
            options={[
              { value: 'all', label: `All (${topics.length})` },
              ...['backlog', 'in_progress', 'extracted', 'refined'].map((status) => ({
                value: status,
                label: `${STATUS_LABELS[status] || status}${statusCounts[status] ? ` (${statusCounts[status]})` : ''}`,
              })),
            ]}
          />

          <FilterSelect
            label="Priority"
            value={priorityFilter}
            onChange={setPriorityFilter}
            active={priorityFilter !== 'all'}
            options={[
              { value: 'all', label: 'All' },
              ...['high', 'medium', 'low'].map((priority) => ({
                value: priority,
                label: `${PRIORITY_LABELS[priority]}${priorityCounts[priority] ? ` (${priorityCounts[priority]})` : ''}`,
              })),
            ]}
          />

          <span className="hidden sm:block w-px h-5 bg-rule dark:bg-dark-border" aria-hidden="true" />

          <FilterSelect
            label="Sort"
            value={sortBy}
            onChange={(v) => setSortBy(v as SortOption)}
            options={(Object.entries(SORT_LABELS) as [SortOption, string][]).map(([value, label]) => ({ value, label }))}
          />

          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="text-[10px] tracking-[0.08em] uppercase font-sans font-semibold text-gray-400 dark:text-gray-600 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Active filter summary */}
        {hasActiveFilters && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Showing {filteredAndSortedTopics.length} of {topics.length} topics
            {searchQuery.trim() && <> &middot; &ldquo;{searchQuery.trim()}&rdquo;</>}
            {statusFilter !== 'all' && <> &middot; {STATUS_LABELS[statusFilter]}</>}
            {priorityFilter !== 'all' && <> &middot; {PRIORITY_LABELS[priorityFilter]} priority</>}
          </p>
        )}
      </div>

      {/* AI-Powered Topic Suggestions */}
      {!isLoading && visibleSuggestions.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => setShowSuggestions(!showSuggestions)}
              className="group flex items-center gap-2 shrink-0"
            >
              <svg
                className={`w-3 h-3 text-gray-400 dark:text-gray-600 transition-transform ${showSuggestions ? '' : '-rotate-90'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
              <span className="text-[11px] tracking-[0.1em] uppercase font-sans font-bold text-gray-700 dark:text-gray-300 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors whitespace-nowrap">
                {suggestionsSource === 'ai' ? 'AI-Suggested Topics' : 'Suggested Topics'}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-600 font-normal normal-case tracking-normal">
                ({visibleSuggestions.length})
              </span>
            </button>
            <span className="flex-1 border-t border-rule dark:border-dark-border" aria-hidden="true" />
            {suggestionsSource === 'ai' && (
              <span className="shrink-0 text-[10.5px] tracking-[0.08em] uppercase font-sans font-semibold text-primary-600 dark:text-primary-400">
                Personalized
              </span>
            )}
            <button
              onClick={fetchSuggestions}
              disabled={isSuggestionsLoading}
              className="shrink-0 text-[11px] tracking-[0.06em] uppercase font-sans font-semibold text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-1"
              title="Refresh suggestions"
            >
              <svg
                className={`w-3 h-3 ${isSuggestionsLoading ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>

          {showSuggestions && (
            <div>
              {suggestionsMessage && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{suggestionsMessage}</p>
              )}
              {suggestionsError && (
                <div className="text-sm text-gray-700 dark:text-gray-300 bg-panel dark:bg-dark-card border border-rule dark:border-dark-border rounded-md px-3 py-2 mb-3">
                  {suggestionsError}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleSuggestions.map((suggestion, idx) => (
                  <div
                    key={`${suggestion.title}-${idx}`}
                    className="relative border border-rule dark:border-dark-border bg-white dark:bg-dark-card rounded-lg p-4 flex flex-col"
                  >
                    {/* Dismiss button */}
                    <button
                      onClick={() => handleDismissSuggestion(suggestion.title)}
                      className="absolute top-3 right-3 text-gray-400 hover:text-primary-600 dark:text-gray-600 dark:hover:text-primary-400 transition-colors"
                      title="Dismiss suggestion"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>

                    <div className="pr-6 flex-1 flex flex-col">
                      <h4 className="font-serif text-base text-gray-900 dark:text-white line-clamp-1 mb-1.5">
                        {suggestion.title}
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mb-3">
                        {suggestion.description}
                      </p>

                      {/* Category + intent, typographic */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] tracking-[0.08em] uppercase font-sans font-semibold mb-2">
                        <span className="text-primary-600 dark:text-primary-400">{suggestion.category}</span>
                        <span className="text-gray-300 dark:text-gray-700 normal-case font-normal" aria-hidden="true">&middot;</span>
                        <span className="text-gray-500 dark:text-gray-400">{suggestion.intent}</span>
                      </div>

                      {/* Tags — quiet lowercase dot-separated text */}
                      {suggestion.tags.length > 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-600 lowercase mb-2">
                          {suggestion.tags.slice(0, 3).join(' · ')}
                        </p>
                      )}

                      {/* Rationale */}
                      {suggestion.rationale && suggestion.source === 'ai' && (
                        <p className="font-serif italic text-[13px] text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">
                          {suggestion.rationale}
                        </p>
                      )}

                      {/* Suggested opening question */}
                      {suggestion.suggestedQuestion && (
                        <p className="font-serif italic text-[13px] text-gray-600 dark:text-gray-300 line-clamp-2 mb-3">
                          <span className="not-italic font-sans text-[10.5px] uppercase tracking-[0.06em] font-semibold text-gray-500 dark:text-gray-400 mr-1">
                            Opening Q:
                          </span>
                          {suggestion.suggestedQuestion}
                        </p>
                      )}

                      {/* Accept button — full-width ghost */}
                      <button
                        onClick={() => handleAcceptSuggestion(suggestion, idx)}
                        disabled={acceptingIndex !== null}
                        className="mt-auto w-full border border-rule dark:border-dark-border rounded-md py-2 text-[11px] tracking-[0.08em] uppercase font-sans font-semibold text-gray-600 dark:text-gray-300 hover:border-primary-500 dark:hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                      >
                        {acceptingIndex === idx ? (
                          <>
                            <div className="animate-spin w-3 h-3 border-2 border-gray-300 dark:border-gray-700 border-t-primary-600 dark:border-t-primary-400 rounded-full" />
                            Adding&hellip;
                          </>
                        ) : (
                          'Add to My Topics'
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
              <div className="animate-spin w-4 h-4 border-2 border-gray-300 dark:border-gray-700 border-t-primary-500 dark:border-t-primary-400 rounded-full" />
              <span>Generating topic suggestions&hellip;</span>
            </div>
          )}
        </div>
      )}

      {/* Suggestions loading state (when no existing suggestions to show) */}
      {!isLoading && isSuggestionsLoading && suggestions.length === 0 && (
        <div className="mb-8 border border-rule dark:border-dark-border rounded-lg py-8 text-center">
          <div className="animate-spin w-5 h-5 border-2 border-gray-300 dark:border-gray-700 border-t-primary-500 dark:border-t-primary-400 rounded-full mx-auto mb-3" />
          <p className="font-serif italic text-gray-600 dark:text-gray-300">
            Analyzing your knowledge profile for personalized topic suggestions&hellip;
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
        <div className="flex items-center gap-2 mb-4 text-sm text-gray-500 dark:text-gray-400">
          <div className="animate-spin w-3 h-3 border-2 border-gray-300 dark:border-gray-700 border-t-primary-500 dark:border-t-primary-400 rounded-full" />
          <span>Refreshing&hellip;</span>
        </div>
      )}

      {/* Topics list - show existing data even during background refreshes */}
      {(!isLoading || topics.length > 0) && paginatedTopics.length > 0 && (
        <div>
          <SectionHeading className="mb-2">Your Topics</SectionHeading>
          <div className="divide-y divide-rule dark:divide-dark-border">
            {paginatedTopics.map((topic) => (
              <Link
                key={topic.id}
                to={`/app/topics/${topic.id}`}
                className="group flex items-start justify-between gap-6 py-5 -mx-2 px-2 rounded-sm hover:bg-panel/60 dark:hover:bg-dark-surface/60 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="font-serif text-lg text-gray-900 dark:text-white truncate mb-1.5 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                    {topic.title}
                  </h3>
                  {topic.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mb-2 max-w-2xl">
                      {topic.description}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tracking-[0.08em] uppercase font-sans font-semibold">
                    <span className={topic.status === 'in_progress' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}>
                      {STATUS_LABELS[topic.status] || topic.status}
                    </span>
                    {topic.priority === 'high' && (
                      <>
                        <span className="text-gray-300 dark:text-gray-700 normal-case font-normal" aria-hidden="true">&middot;</span>
                        <span className="text-primary-600 dark:text-primary-400">High priority</span>
                      </>
                    )}
                    {topic.intent && (
                      <>
                        <span className="text-gray-300 dark:text-gray-700 normal-case font-normal" aria-hidden="true">&middot;</span>
                        <span className="text-gray-500 dark:text-gray-400">{topic.intent}</span>
                      </>
                    )}
                  </div>
                  {parseTags(topic.tags).length > 0 && (
                    <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-600 lowercase">
                      {parseTags(topic.tags).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-[11px] tracking-wide text-gray-400 dark:text-gray-600 whitespace-nowrap pt-1">
                  {formatShortDate(topic.createdAt)}
                </div>
              </Link>
            ))}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div
              className="flex items-center justify-between pt-4 mt-2 border-t border-rule dark:border-dark-border"
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
                  className={`px-2 py-1.5 text-sm font-medium transition-colors ${
                    effectivePage <= 1
                      ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed'
                      : 'text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400'
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
                    <span key={`ellipsis-${idx}`} className="px-2 py-1 text-gray-400 dark:text-gray-600 text-sm">
                      &hellip;
                    </span>
                  ) : (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`min-w-[32px] px-2 py-1.5 text-sm font-medium transition-colors ${
                        pageNum === effectivePage
                          ? 'text-primary-600 dark:text-primary-400 font-bold'
                          : 'text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400'
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
                  className={`px-2 py-1.5 text-sm font-medium transition-colors ${
                    effectivePage >= totalPages
                      ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed'
                      : 'text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400'
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
        <EmptyState
          message={
            hasActiveFilters
              ? 'No topics match the current filters. Try adjusting or clearing your filters.'
              : 'Create your first topic to start exploring your knowledge.'
          }
          kicker={hasActiveFilters ? 'No matching topics' : 'No topics yet'}
          action={
            hasActiveFilters ? (
              <button onClick={clearAllFilters} className="btn-secondary">
                Clear All Filters
              </button>
            ) : (
              <Link to="/app/topics/new" className="btn-primary inline-block">
                Create Your First Topic
              </Link>
            )
          }
        />
      )}
    </div>
  );
}
