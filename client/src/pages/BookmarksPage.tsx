export default function BookmarksPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Bookmarks</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Your saved aha moments from interview sessions
        </p>
      </div>

      {/* Empty state */}
      <div className="card text-center py-12">
        <span className="text-4xl block mb-3">⭐</span>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          No bookmarks yet
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Star messages during interview sessions to save important moments here.
        </p>
      </div>
    </div>
  );
}
