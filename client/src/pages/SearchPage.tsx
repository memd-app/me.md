import { useState } from 'react';

export default function SearchPage() {
  const [query, setQuery] = useState('');

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Search</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Search across topics, insights, and session transcripts
        </p>
      </div>

      {/* Search input */}
      <div className="relative mb-6">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input-field pl-10"
          placeholder="Search topics, insights, sessions..."
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <span className="text-sm text-gray-500 dark:text-gray-400 py-1">Filter by:</span>
        {['All', 'Topics', 'Insights', 'Sessions', 'Notes'].map((f) => (
          <button
            key={f}
            className="px-3 py-1 rounded-full text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            {f}
          </button>
        ))}
      </div>

      {/* Empty state */}
      <div className="card text-center py-12">
        <span className="text-4xl block mb-3">🔍</span>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {query ? 'No results found' : 'Start searching'}
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          {query
            ? `No results found for "${query}". Try a different search term.`
            : 'Type in the search bar to find topics, insights, and session content.'}
        </p>
      </div>
    </div>
  );
}
