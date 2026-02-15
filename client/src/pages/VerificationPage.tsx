export default function VerificationPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Verification Queue</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Review and verify AI-extracted insights
        </p>
      </div>

      {/* Verification stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">0</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Pending Review</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">0</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Verified</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">0</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Rejected</p>
        </div>
      </div>

      {/* Empty state */}
      <div className="card text-center py-12">
        <span className="text-4xl block mb-3">✅</span>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          No insights to verify
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Complete interview sessions to generate insights for verification.
        </p>
      </div>
    </div>
  );
}
