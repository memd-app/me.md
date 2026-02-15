import { Link } from 'react-router-dom';

export default function NewSessionPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">New Session</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Start a new AI-guided interview session
        </p>
      </div>

      {/* Quick Win Mini Session */}
      <div className="card mb-6 border-primary-200 dark:border-primary-800">
        <div className="flex items-start gap-4">
          <span className="text-3xl">⚡</span>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Quick Win Session
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-3">
              5-minute mini interview with 5-7 high-impact questions to get started quickly.
            </p>
            <button className="btn-primary">Start Quick Session</button>
          </div>
        </div>
      </div>

      {/* Select Topic */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Choose a Topic
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Select an existing topic to start an in-depth interview session.
        </p>

        {/* Empty state */}
        <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
          <span className="text-3xl block mb-2">📋</span>
          <p className="text-gray-500 dark:text-gray-400 mb-3">
            No topics available. Create a topic first.
          </p>
          <Link to="/app/topics" className="btn-secondary inline-block">
            Browse Topics
          </Link>
        </div>
      </div>
    </div>
  );
}
