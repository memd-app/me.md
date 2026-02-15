export default function ProfilePage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Profile Summary</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Your auto-generated personal profile
          </p>
        </div>
        <button className="btn-secondary">Export as me.md</button>
      </div>

      {/* Profile sections - empty state */}
      <div className="space-y-6">
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            Personal Portrait
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            Complete more interview sessions to generate your personal portrait including values, beliefs, and core traits.
          </p>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            Communication Style
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            Your communication patterns and preferences will appear here after verification.
          </p>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            Decision-Making Patterns
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            Your decision frameworks and patterns will be summarized here.
          </p>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            Strengths &amp; Expertise
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            An overview of your strengths and areas of expertise will appear after insights are verified.
          </p>
        </div>
      </div>
    </div>
  );
}
