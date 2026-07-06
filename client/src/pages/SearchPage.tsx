import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useSearchParams, useNavigate } from 'react-router-dom';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { formatShortDate } from '@/utils/dateFormat';
import { searchAll } from '@/services/search';
import { PageHeader, EmptyState, Badge } from '@/components/ui';

interface SearchResult {
  id: string;
  type: 'topic' | 'insight' | 'session' | 'note';
  title: string;
  snippet: string;
  context?: string;
  topicId?: string;
  topicTitle?: string;
  topicCategory?: string;
  sessionId?: string;
  verificationStatus?: string;
  confidenceScore?: number;
  createdAt?: string;
}

type FilterType = 'all' | 'topics' | 'insights' | 'sessions' | 'notes';

const FILTERS: { label: string; value: FilterType }[] = [
  { label: 'All', value: 'all' },
  { label: 'Topics', value: 'topics' },
  { label: 'Insights', value: 'insights' },
  { label: 'Sessions', value: 'sessions' },
  { label: 'Notes', value: 'notes' },
];

// Type shown as a small-caps text label rather than an emoji + colored pill
// (DESIGN.md "Status semantics" / "single amber accent" discipline).
const TYPE_LABELS: Record<string, string> = {
  topic: 'Topic',
  insight: 'Insight',
  session: 'Session',
  note: 'Note',
};

const RESULTS_PER_PAGE = 20;

export default function SearchPage() {
  const { user } = useUser();
  const db = useDatabase();
  const navigate = useNavigate();
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
  const searchAbortRef = useRef<AbortController | null>(null);

  // Perform search API call
  const performSearch = useCallback(
    async (searchQuery: string, filter: FilterType, page: number) => {
      // Abort any in-flight search request
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }

      if (!searchQuery.trim()) {
        setResults([]);
        setTotal(0);
        setTotalPages(0);
        setHasSearched(false);
        return;
      }

      if (!user) return;

      const controller = new AbortController();
      searchAbortRef.current = controller;

      setIsLoading(true);
      setError(null);
      setHasSearched(true);

      try {
        const data = searchAll(db, {
          query: searchQuery.trim(),
          filter,
          page,
          limit: RESULTS_PER_PAGE,
        }) as any;
        if (!controller.signal.aborted) {
          setResults(data.results || []);
          setTotal(data.total || 0);
          setTotalPages(data.totalPages || 0);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Search failed');
          setResults([]);
          setTotal(0);
          setTotalPages(0);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
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

  // Abort in-flight searches when component unmounts
  useEffect(() => {
    return () => {
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
    };
  }, []);

  // Debounced search on query change
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [query, activeFilter, performSearch, updateUrlParams]
  );

  // Clear all filters
  const handleClearFilters = useCallback(() => {
    setActiveFilter('all');
    setCurrentPage(1);
    updateUrlParams(query, 'all', 1);
    performSearch(query, 'all', 1);
  }, [query, performSearch, updateUrlParams]);

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

  // Navigate to source item when clicking a result (Feature #86)
  function handleResultClick(result: SearchResult) {
    switch (result.type) {
      case 'topic':
        navigate(`/app/topics/${result.id}`);
        break;
      case 'session':
        navigate(`/app/sessions/${result.sessionId || result.id}`);
        break;
      case 'insight':
        // Navigate to verification page where insights can be reviewed
        navigate('/app/review');
        break;
      case 'note':
        // Navigate to the notes page with the note selected
        navigate('/app/notes');
        break;
      default:
        break;
    }
  }

  // Highlight matching text in a snippet — amber wash rather than a
  // default-yellow <mark>, to keep the single-accent discipline.
  function highlightMatch(text: string, searchQuery: string): React.ReactNode {
    if (!searchQuery.trim()) return text;

    try {
      const regex = new RegExp(`(${escapeRegex(searchQuery)})`, 'gi');
      const parts = text.split(regex);

      return parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-primary-100 dark:bg-primary-900/40 text-ink dark:text-primary-100 rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          part
        )
      );
    } catch {
      // If regex fails (e.g., with special chars), return text as-is
      return text;
    }
  }

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Map a result's verificationStatus to the shared typographic Badge
  // (DESIGN.md "Status semantics" — no colored pills).
  function verificationBadge(status: string | undefined) {
    if (!status) return null;
    if (status === 'verified') return { variant: 'verified' as const, label: undefined };
    if (status === 'rejected') return { variant: 'rejected' as const, label: undefined };
    if (status === 're_verification_pending') return { variant: 'pending' as const, label: 'Re-verify' };
    return { variant: 'pending' as const, label: 'Unverified' };
  }

  // Date formatting uses shared utility from @/utils/dateFormat

  const hasAnyActiveFilters = activeFilter !== 'all';

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Search"
        subtitle="Search across topics, insights, session transcripts, and notes."
      />

      {/* Search input — large quiet field, not a boxed input */}
      <div className="relative mb-6">
        <svg
          className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-gray-600"
          fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <label htmlFor="global-search" className="sr-only">Search topics, insights, sessions, notes</label>
        <input
          id="global-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-transparent border-0 border-b border-rule dark:border-dark-border focus:border-primary-500 dark:focus:border-primary-400 pl-8 pr-8 py-3 font-serif text-xl md:text-2xl text-ink dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-600 placeholder:not-italic focus:outline-none focus:ring-0 transition-colors"
          placeholder="Search everything…"
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
            className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary-600 dark:text-gray-600 dark:hover:text-primary-400 transition-colors"
            title="Clear search"
            aria-label="Clear search"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Type filter chips — small-caps, amber underline when active */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-rule dark:border-dark-border pb-3 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleFilterChange(f.value)}
            className={`-mb-[13px] pb-3 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold border-b-2 transition-colors ${
              activeFilter === f.value
                ? 'text-primary-600 dark:text-primary-400 border-primary-500 dark:border-primary-400'
                : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-ink dark:hover:text-gray-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Active filters summary */}
      {hasAnyActiveFilters && hasSearched && (
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Filtered by
          <> &middot; type: {activeFilter}</>
          {' · '}
          <button onClick={handleClearFilters} className="text-primary-600 dark:text-primary-400 hover:text-ink dark:hover:text-gray-100 transition-colors">
            Clear all
          </button>
        </p>
      )}

      {/* Loading state */}
      {isLoading && (
        <LoadingSpinner card message="Searching..." />
      )}

      {/* Error state */}
      {error && !isLoading && (
        <ApiErrorAlert
          message={error}
          onDismiss={() => setError(null)}
          className="mb-4"
        />
      )}

      {/* Results count */}
      {hasSearched && !isLoading && !error && (
        <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {total > 0 ? (
            <>
              Found <span className="font-semibold text-ink dark:text-white">{total}</span>{' '}
              result{total !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
              {activeFilter !== 'all' && (
                <> in <span className="font-semibold">{activeFilter}</span></>
              )}
              {totalPages > 1 && (
                <> &middot; Page {currentPage} of {totalPages}</>
              )}
            </>
          ) : (
            <span>
              No results found for &ldquo;{query}&rdquo;
              {activeFilter !== 'all' && (
                <> in <span className="font-semibold">{activeFilter}</span></>
              )}
            </span>
          )}
        </div>
      )}

      {/* Results list — hairline rows */}
      {!isLoading && !error && results.length > 0 && (
        <div className="divide-y divide-rule dark:divide-dark-border">
          {results.map((result) => {
            const badge = verificationBadge(result.verificationStatus);
            return (
              <div
                key={`${result.type}-${result.id}`}
                className="group flex items-start justify-between gap-6 py-5 -mx-2 px-2 rounded-sm hover:bg-panel/60 dark:hover:bg-dark-surface/60 transition-colors cursor-pointer"
                onClick={() => handleResultClick(result)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleResultClick(result);
                  }
                }}
              >
                <div className="min-w-0 flex-1">
                  {/* Meta row: type label + status badge + date */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                    <span>{TYPE_LABELS[result.type] || result.type}</span>
                    {badge && (
                      <>
                        <span aria-hidden="true" className="normal-case font-normal text-gray-300 dark:text-gray-700">&middot;</span>
                        <Badge
                          variant={badge.variant}
                          label={badge.label}
                          confidence={badge.variant === 'verified' ? result.confidenceScore : undefined}
                        />
                      </>
                    )}
                    {result.createdAt && (
                      <span className="ml-auto normal-case font-normal tracking-normal text-gray-400 dark:text-gray-600 shrink-0">
                        {formatShortDate(result.createdAt)}
                      </span>
                    )}
                  </div>

                  {/* Title with highlighting */}
                  <h3 className="font-serif text-lg text-gray-900 dark:text-white mb-1.5 truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                    {highlightMatch(result.title, query)}
                  </h3>

                  {/* Snippet with highlighting */}
                  <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 max-w-2xl">
                    {highlightMatch(result.snippet, query)}
                  </p>

                  {/* Topic context */}
                  {result.topicTitle && result.type !== 'topic' && (
                    <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-600 truncate">
                      {result.topicTitle}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state - before searching (Feature #88) */}
      {!isLoading && !error && !hasSearched && (
        <EmptyState
          kicker="Start searching"
          message="Type in the search bar to find topics, insights, session transcripts, and notes."
        />
      )}

      {/* No results state (Feature #88) */}
      {hasSearched && !isLoading && !error && results.length === 0 && (
        <EmptyState
          kicker="No results found"
          message={
            <>
              No results found for &ldquo;{query}&rdquo;
              {activeFilter !== 'all' && <> in {activeFilter}</>}
              {hasAnyActiveFilters && <> with the active filters</>}. Try checking your spelling, using fewer keywords, or a broader term.
            </>
          }
          action={
            hasAnyActiveFilters ? (
              <button onClick={handleClearFilters} className="btn-secondary">
                Clear all filters
              </button>
            ) : undefined
          }
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && !isLoading && (
        <div className="flex items-center justify-center gap-1 mt-8 pt-4 border-t border-rule dark:border-dark-border flex-wrap">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className={`px-2 py-1.5 text-sm font-medium transition-colors ${
              currentPage <= 1
                ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed'
                : 'text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400'
            }`}
            aria-label="Previous page"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {getPageNumbers(currentPage, totalPages).map((pageNum, idx) =>
            pageNum === -1 ? (
              <span key={`ellipsis-${idx}`} className="px-2 py-1 text-gray-400 dark:text-gray-600 text-sm">
                &hellip;
              </span>
            ) : (
              <button
                key={pageNum}
                onClick={() => handlePageChange(pageNum)}
                className={`min-w-[32px] px-2 py-1.5 text-sm font-medium transition-colors ${
                  pageNum === currentPage
                    ? 'text-primary-600 dark:text-primary-400 font-bold'
                    : 'text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400'
                }`}
                aria-label={`Page ${pageNum}`}
                aria-current={pageNum === currentPage ? 'page' : undefined}
              >
                {pageNum}
              </button>
            )
          )}

          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className={`px-2 py-1.5 text-sm font-medium transition-colors ${
              currentPage >= totalPages
                ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed'
                : 'text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400'
            }`}
            aria-label="Next page"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
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
