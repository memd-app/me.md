export default function ExportPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Export</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Export your verified profile as me.md or JSON
        </p>
      </div>

      {/* Export options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-start gap-3 mb-4">
            <span className="text-2xl">📝</span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Markdown (me.md)
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Export your verified profile as a portable markdown file
              </p>
            </div>
          </div>
          <button className="btn-primary w-full">Download me.md</button>
        </div>

        <div className="card">
          <div className="flex items-start gap-3 mb-4">
            <span className="text-2xl">📦</span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                JSON Data
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Export structured data for use with AI tools and APIs
              </p>
            </div>
          </div>
          <button className="btn-secondary w-full">Download JSON</button>
        </div>
      </div>

      {/* Copy to clipboard */}
      <div className="card mt-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Copy to Clipboard
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Copy your profile directly to paste into any AI tool
            </p>
          </div>
          <button className="btn-secondary">Copy Profile</button>
        </div>
      </div>

      {/* Privacy note */}
      <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          <strong>Privacy:</strong> Items marked as &quot;never export&quot; in your privacy settings will be automatically excluded from all exports.
        </p>
      </div>
    </div>
  );
}
