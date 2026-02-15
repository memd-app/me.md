import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSearchParams } from 'react-router-dom';

interface SearchResult {
  id: string;
  type: 'topic' | 'insight' | 'session' | 'note';
  title: string;
  snippet: string;
  context?: string;
  topicId?: string;
  topicTitle?: string;
  sessionId?: string;
  verificationStatus?: string;
  confidenceScore?: number;
  createdAt?: string;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  query: string;
  filter: string;
}

type FilterType = 'all' | 'topics' | 'insights' | 'sessions' | 'notes';

const FILTERS: { label: string; value: FilterType }[] = [
  { label: 'All', value: 'all' },
  { label: 'Topics', value: 'topics' },
  { label: 'Insights', value: 'insights' },
  { label: 'Sessions', value: 'sessions' },
  { label: 'Notes', value: 'notes' },
];

const TYPE_ICONS: Record<string, string> = {
  topic: '📋',
  insight: '💡',
  session: '💬',
  note: '📝',
};

const TYPE_COLORS: Record<string, string> = {
  topic: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  insight: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  session: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  note: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

const RESULTS_PER_PAGE = 20;

export default function SearchPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize state from URL params to persist across navigation
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [activeFilter, setActiveFilter] = useState<FilterType>(
    (searchParams.get('filter') as FilterType) || 'all'
  );
  const [currentPage, setCurrentPage] = useState(
    parseInt(searchParams.get('page') || '1', 10)
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Perform search API call
  const performSearch = useCallback(
    async (searchQuery: string, filter: FilterType, page: number) => {
      if (!searchQuery.trim()) {
        setResults([]);
        setTotal(0);
        setTotalPages(0);
        setHasSearched(false);
        return;
      }

      if (!user) return;

      setIsLoading(true);
      setError(null);
      setHasSearched(true);

      try {
        const params = new URLSearchParams({
          q: searchQuery.trim(),
          filter,
          page: String(page),
          limit: String(RESULTS_PER_PAGE),
        });

        const res = await fetch(`/api/search?${params}`, {
          headers: { 'x-user-id': user.id },
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Search failed');
        }

        const data: SearchResponse = await res.json();
        setResults(data.results);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
        setTotal(0);
        setTotalPages(0);
      } finally {
        setIsLoading(false);
      }
    },
    [user]
  );

  // Update URL params when search state changes
  const updateUrlParams = useCallback(
    (q: string, filter: FilterType, page: number) => {
      const params: Record<string, string> = {};
      if (q.trim()) params.q = q.trim();
      if (filter !== 'all') params.filter = filter;
      if (page > 1) params.page = String(page);
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  // Debounced search on query change
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      // Reset to page 1 when query changes
      setCurrentPage(1);
      updateUrlParams(query, activeFilter, 1);
      performSearch(query, activeFilter, 1);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Search when filter changes (no debounce needed)
  const handleFilterChange = useCallback(
    (filter: FilterType) => {
      setActiveFilter(filter);
      setCurrentPage(1);
      updateUrlParams(query, filter, 1);
      performSearch(query, filter, 1);
    },
    [query, performSearch, updateUrlParams]
  );

  // Handle page change
  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);
      updateUrlParams(query, activeFilter, page);
      performSearch(query, activeFilter, page);
      // Scroll to top of results
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [query, activeFilter, performSearch, updateUrlParams]
  );

  // Initialize search from URL params on mount
  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    const urlFilter = (searchParams.get('filter') as FilterType) || 'all';
    const urlPage = parseInt(searchParams.get('page') || '1', 10);

    if (urlQuery.trim()) {
      setQuery(urlQuery);
      setActiveFilter(urlFilter);
      setCurrentPage(urlPage);
      performSearch(urlQuery, urlFilter, urlPage);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlight matching text in a snippet
  function highlightMatch(text: string, searchQuery: string): React.ReactNode {
    if (!searchQuery.trim()) return text;

    const regex = new RegExp(`(${escapeRegex(searchQuery)})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark
          key={i}
          className="bg-yellow-200 dark:bg-yellow-800 text-gray-900 dark:text-yellow-100 rounded px-0.5"
        >
          {part}
        </mark>
      ) : (
        part
      )
    );
  }

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function formatDate(dateStr?: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Search</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Search across topics, insights, session transcripts, and notes
        </p>
      </div>

      {/* Search input */}
      <div className="relative mb-6">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input-field pl-10 pr-10"
          placeholder="Search topics, insights, sessions, notes..."
          autoFocus
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              setTotal(0);
              setTotalPages(0);
              setHasSearched(false);
              setCurrentPage(1);
              setSearchParams({}, { replace: true });
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            title="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <span className="text-sm text-gray-500 dark:text-gray-400 py-1">Filter by:</span>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleFilterChange(f.value)}
            className={`px-3 py-1 rounded-full text-sm transition-colors ${
              activeFilter === f.value
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="card text-center py-8">
          <div className="animate-spin inline-block w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full mb-3" />
          <p className="text-gray-600 dark:text-gray-400">Searching...</p>
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="card border-red-200 dark:border-red-800 text-center py-8">
          <span className="text-4xl block mb-3">⚠️</span>
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Results count */}
      {hasSearched && !isLoading && !error && (
        <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {total > 0 ? (
            <>
              Found <span className="font-medium text-gray-900 dark:text-white">{total}</span>{' '}
              result{total !== 1 ? 's' : ''} for &quot;{query}&quot;
              {activeFilter !== 'all' && (
                <> in <span className="font-medium">{activeFilter}</span></>
              )}
              {totalPages > 1 && (
                <> &middot; Page {currentPage} of {totalPages}</>
              )}
            </>
          ) : (
            <span>
              No results found for &quot;{query}&quot;
              {activeFilter !== 'all' && (
                <> in <span className="font-medium">{activeFilter}</span></>
              )}
            </span>
          )}
        </div>
      )}

      {/* Results list */}
      {!isLoading && !error && results.length > 0 && (
        <div className="space-y-3">
          {results.map((result) => (
            <div
              key={`${result.type}-${result.id}`}
              className="card hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-start gap-3">
                {/* Type icon */}
                <span className="text-xl mt-0.5 flex-shrink-0">
                  {TYPE_ICONS[result.type]}
                </span>

                <div className="flex-1 min-w-0">
                  {/* Header row */}
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        TYPE_COLORS[result.type]
                      }`}
                    >
                      {result.type.charAt(0).toUpperCase() + result.type.slice(1)}
                    </span>
                    {result.verificationStatus && (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          result.verificationStatus === 'verified'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : result.verificationStatus === 'rejected'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {result.verificationStatus}
                      </span>
                    )}
                    {result.confidenceScore !== undefined && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {result.confidenceScore}% confidence
                      </span>
                    )}
                    {result.createdAt && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
                        {formatDate(result.createdAt)}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="font-medium text-gray-900 dark:text-white text-sm">
                    {highlightMatch(result.title, query)}
                  </h3>

                  {/* Snippet */}
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                    {highlightMatch(result.snippet, query)}
                  </p>

                  {/* Topic context */}
                  {result.topicTitle && result.type !== 'topic' && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      📋 {result.topicTitle}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && !hasSearched && (
        <div className="card text-center py-12">
          <span className="text-4xl block mb-3">🔍</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Start searching
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Type in the search bar to find topics, insights, session transcripts, and notes.
          </p>
        </div>
      )}

      {/* No results state */}
      {hasSearched && !isLoading && !error && results.length === 0 && (
        <div className="card text-center py-12">
          <span className="text-4xl block mb-3">🔍</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No results found
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            No results found for &quot;{query}&quot;. Try a different search term
            {activeFilter !== 'all' && ' or change the filter'}.
          </p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && !isLoading && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>

          {/* Page numbers */}
          {getPageNumbers(currentPage, totalPages).map((pageNum, idx) =>
            pageNum === -1 ? (
              <span key={`ellipsis-${idx}`} className="px-2 text-gray-400">
                ...
              </span>
            ) : (
              <button
                key={pageNum}
                onClick={() => handlePageChange(pageNum)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  pageNum === currentPage
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {pageNum}
              </button>
            )
          )}

          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Generate page numbers with ellipsis for pagination.
 * Returns array of page numbers, with -1 representing ellipsis.
 */
function getPageNumbers(current: number, total: number): number[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: number[] = [];

  // Always show first page
  pages.push(1);

  if (current > 3) {
    pages.push(-1); // ellipsis
  }

  // Show pages around current
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push(-1); // ellipsis
  }

  // Always show last page
  pages.push(total);

  return pages;
}
