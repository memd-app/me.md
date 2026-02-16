import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSearchParams, useNavigate } from 'react-router-dom';

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
type VerificationFilter = '' | 'verified' | 'unverified' | 'rejected' | 're_verification_pending';

const FILTERS: { label: string; value: FilterType }[] = [
  { label: 'All', value: 'all' },
  { label: 'Topics', value: 'topics' },
  { label: 'Insights', value: 'insights' },
  { label: 'Sessions', value: 'sessions' },
  { label: 'Notes', value: 'notes' },
];

const VERIFICATION_FILTERS: { label: string; value: VerificationFilter }[] = [
  { label: 'Any Status', value: '' },
  { label: 'Verified', value: 'verified' },
  { label: 'Unverified', value: 'unverified' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Re-verify', value: 're_verification_pending' },
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

  // Advanced filters (Feature #87)
  const [verificationStatus, setVerificationStatus] = useState<VerificationFilter>(
    (searchParams.get('verificationStatus') as VerificationFilter) || ''
  );
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') || '');
  const [minConfidence, setMinConfidence] = useState(
    parseInt(searchParams.get('minConfidence') || '0', 10)
  );
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(
    !!(searchParams.get('verificationStatus') || searchParams.get('dateFrom') || searchParams.get('dateTo') || searchParams.get('minConfidence'))
  );

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Perform search API call
  const performSearch = useCallback(
    async (searchQuery: string, filter: FilterType, page: number, vStatus: VerificationFilter, dFrom: string, dTo: string, minConf: number) => {
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

        // Add advanced filter params
        if (vStatus) params.set('verificationStatus', vStatus);
        if (dFrom) params.set('dateFrom', dFrom);
        if (dTo) params.set('dateTo', dTo);
        if (minConf > 0) params.set('minConfidence', String(minConf));

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
    (q: string, filter: FilterType, page: number, vStatus: VerificationFilter, dFrom: string, dTo: string, minConf: number) => {
      const params: Record<string, string> = {};
      if (q.trim()) params.q = q.trim();
      if (filter !== 'all') params.filter = filter;
      if (page > 1) params.page = String(page);
      if (vStatus) params.verificationStatus = vStatus;
      if (dFrom) params.dateFrom = dFrom;
      if (dTo) params.dateTo = dTo;
      if (minConf > 0) params.minConfidence = String(minConf);
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
      setCurrentPage(1);
      updateUrlParams(query, activeFilter, 1, verificationStatus, dateFrom, dateTo, minConfidence);
      performSearch(query, activeFilter, 1, verificationStatus, dateFrom, dateTo, minConfidence);
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
      updateUrlParams(query, filter, 1, verificationStatus, dateFrom, dateTo, minConfidence);
      performSearch(query, filter, 1, verificationStatus, dateFrom, dateTo, minConfidence);
    },
    [query, verificationStatus, dateFrom, dateTo, minConfidence, performSearch, updateUrlParams]
  );

  // Handle advanced filter changes
  const handleAdvancedFilterApply = useCallback(() => {
    setCurrentPage(1);
    updateUrlParams(query, activeFilter, 1, verificationStatus, dateFrom, dateTo, minConfidence);
    performSearch(query, activeFilter, 1, verificationStatus, dateFrom, dateTo, minConfidence);
  }, [query, activeFilter, verificationStatus, dateFrom, dateTo, minConfidence, performSearch, updateUrlParams]);

  // Handle page change
  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);
      updateUrlParams(query, activeFilter, page, verificationStatus, dateFrom, dateTo, minConfidence);
      performSearch(query, activeFilter, page, verificationStatus, dateFrom, dateTo, minConfidence);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [query, activeFilter, verificationStatus, dateFrom, dateTo, minConfidence, performSearch, updateUrlParams]
  );

  // Clear all filters
  const handleClearFilters = useCallback(() => {
    setActiveFilter('all');
    setVerificationStatus('');
    setDateFrom('');
    setDateTo('');
    setMinConfidence(0);
    setCurrentPage(1);
    updateUrlParams(query, 'all', 1, '', '', '', 0);
    performSearch(query, 'all', 1, '', '', '', 0);
  }, [query, performSearch, updateUrlParams]);

  // Initialize search from URL params on mount
  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    const urlFilter = (searchParams.get('filter') as FilterType) || 'all';
    const urlPage = parseInt(searchParams.get('page') || '1', 10);
    const urlVStatus = (searchParams.get('verificationStatus') as VerificationFilter) || '';
    const urlDateFrom = searchParams.get('dateFrom') || '';
    const urlDateTo = searchParams.get('dateTo') || '';
    const urlMinConf = parseInt(searchParams.get('minConfidence') || '0', 10);

    if (urlQuery.trim()) {
      setQuery(urlQuery);
      setActiveFilter(urlFilter);
      setCurrentPage(urlPage);
      setVerificationStatus(urlVStatus);
      setDateFrom(urlDateFrom);
      setDateTo(urlDateTo);
      setMinConfidence(urlMinConf);
      performSearch(urlQuery, urlFilter, urlPage, urlVStatus, urlDateFrom, urlDateTo, urlMinConf);
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
        navigate(`/app/session/${result.sessionId || result.id}`);
        break;
      case 'insight':
        // Navigate to verification page where insights can be reviewed
        navigate('/app/verify');
        break;
      case 'note':
        // Navigate to the notes page with the note selected
        navigate('/app/notes');
        break;
      default:
        break;
    }
  }

  // Highlight matching text in a snippet
  function highlightMatch(text: string, searchQuery: string): React.ReactNode {
    if (!searchQuery.trim()) return text;

    try {
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
    } catch {
      // If regex fails (e.g., with special chars), return text as-is
      return text;
    }
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

  // Check if any advanced filters are active
  const hasActiveAdvancedFilters = !!(verificationStatus || dateFrom || dateTo || minConfidence > 0);
  const hasAnyActiveFilters = activeFilter !== 'all' || hasActiveAdvancedFilters;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Search</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          Search across topics, insights, session transcripts, and notes
        </p>
      </div>

      {/* Search input */}
      <div className="relative mb-6">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        <label htmlFor="global-search" className="sr-only">Search topics, insights, sessions, notes</label>
        <input
          id="global-search"
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

      {/* Type Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="text-sm text-gray-500 dark:text-gray-300 py-1">Type:</span>
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

        {/* Toggle advanced filters */}
        <button
          onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          className={`px-3 py-1 rounded-full text-sm transition-colors ml-auto ${
            hasActiveAdvancedFilters
              ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          {showAdvancedFilters ? '▲ Filters' : '▼ More Filters'}
          {hasActiveAdvancedFilters && ' (active)'}
        </button>
      </div>

      {/* Advanced Filters Panel (Feature #87) */}
      {showAdvancedFilters && (
        <div className="card mb-6 p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Verification Status filter */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-300 mb-1">
                Verification Status
              </label>
              <select
                value={verificationStatus}
                onChange={(e) => setVerificationStatus(e.target.value as VerificationFilter)}
                className="w-full px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                {VERIFICATION_FILTERS.map((vf) => (
                  <option key={vf.value} value={vf.value}>{vf.label}</option>
                ))}
              </select>
            </div>

            {/* Date From */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-300 mb-1">
                Date From
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-300 mb-1">
                Date To
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {/* Confidence Score */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-300 mb-1">
                Min Confidence: {minConfidence}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={minConfidence}
                onChange={(e) => setMinConfidence(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-primary-600"
              />
            </div>
          </div>

          {/* Filter action buttons */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleAdvancedFilterApply}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
            >
              Apply Filters
            </button>
            {hasActiveAdvancedFilters && (
              <button
                onClick={handleClearFilters}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Clear All Filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Active filters summary */}
      {hasAnyActiveFilters && hasSearched && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <span className="text-xs text-gray-500 dark:text-gray-300 py-0.5">Active filters:</span>
          {activeFilter !== 'all' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200">
              Type: {activeFilter}
            </span>
          )}
          {verificationStatus && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
              Status: {verificationStatus.replace('_', ' ')}
            </span>
          )}
          {dateFrom && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              From: {dateFrom}
            </span>
          )}
          {dateTo && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              To: {dateTo}
            </span>
          )}
          {minConfidence > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
              Confidence: {'>='}{minConfidence}%
            </span>
          )}
          <button
            onClick={handleClearFilters}
            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="card text-center py-8">
          <div className="animate-spin inline-block w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full mb-3" />
          <p className="text-gray-600 dark:text-gray-300">Searching...</p>
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="card border-red-200 dark:border-red-800 text-center py-8" role="alert" aria-live="assertive">
          <span className="text-4xl block mb-3" aria-hidden="true">⚠️</span>
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Results count */}
      {hasSearched && !isLoading && !error && (
        <div className="mb-4 text-sm text-gray-500 dark:text-gray-300">
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
              className="card hover:shadow-md transition-shadow cursor-pointer hover:border-primary-300 dark:hover:border-primary-700"
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
                            : result.verificationStatus === 're_verification_pending'
                            ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {result.verificationStatus === 're_verification_pending'
                          ? 're-verify'
                          : result.verificationStatus}
                      </span>
                    )}
                    {result.confidenceScore !== undefined && (
                      <span className="text-xs text-gray-500 dark:text-gray-300">
                        {result.confidenceScore}% confidence
                      </span>
                    )}
                    {result.createdAt && (
                      <span className="text-xs text-gray-500 dark:text-gray-300 ml-auto">
                        {formatDate(result.createdAt)}
                      </span>
                    )}
                  </div>

                  {/* Title with highlighting */}
                  <h3 className="font-medium text-gray-900 dark:text-white text-sm">
                    {highlightMatch(result.title, query)}
                  </h3>

                  {/* Snippet with highlighting */}
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">
                    {highlightMatch(result.snippet, query)}
                  </p>

                  {/* Topic context and navigation hint */}
                  <div className="flex items-center gap-2 mt-1">
                    {result.topicTitle && result.type !== 'topic' && (
                      <p className="text-xs text-gray-500 dark:text-gray-300">
                        📋 {result.topicTitle}
                      </p>
                    )}
                    <span className="text-xs text-primary-500 dark:text-primary-400 ml-auto opacity-0 group-hover:opacity-100">
                      Click to view →
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state - before searching (Feature #88) */}
      {!isLoading && !error && !hasSearched && (
        <div className="card text-center py-12">
          <span className="text-4xl block mb-3">🔍</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Start searching
          </h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            Type in the search bar to find topics, insights, session transcripts, and notes.
          </p>
          <div className="text-sm text-gray-500 dark:text-gray-300 space-y-1">
            <p>💡 <span className="font-medium">Tip:</span> Try searching for a topic name, a keyword from an interview, or an insight.</p>
            <p>🔧 Use the <span className="font-medium">More Filters</span> button for advanced filtering by verification status, date, or confidence.</p>
          </div>
        </div>
      )}

      {/* No results state (Feature #88) */}
      {hasSearched && !isLoading && !error && results.length === 0 && (
        <div className="card text-center py-12">
          <span className="text-4xl block mb-3">🔍</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No results found
          </h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            No results found for &quot;{query}&quot;
            {activeFilter !== 'all' && (
              <> in <span className="font-medium">{activeFilter}</span></>
            )}
            {hasActiveAdvancedFilters && <> with the active filters</>}
            .
          </p>
          <div className="text-sm text-gray-500 dark:text-gray-300 space-y-1">
            <p>Try the following:</p>
            <ul className="list-disc list-inside text-left max-w-sm mx-auto space-y-1">
              <li>Check your spelling</li>
              <li>Try different or fewer keywords</li>
              {activeFilter !== 'all' && <li>Change the type filter to &quot;All&quot;</li>}
              {hasActiveAdvancedFilters && (
                <li>
                  <button onClick={handleClearFilters} className="text-primary-600 dark:text-primary-400 underline">
                    Clear all filters
                  </button>
                </li>
              )}
              <li>Search for a broader term</li>
            </ul>
          </div>
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
