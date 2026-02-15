export default function KnowledgeGraphPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Knowledge Graph</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Visualize connections between your topics and insights
        </p>
      </div>

      {/* Graph container */}
      <div className="card" style={{ minHeight: '500px' }}>
        <div className="flex flex-col items-center justify-center h-96">
          <span className="text-5xl block mb-4">🔗</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Your Knowledge Graph
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-center max-w-md">
            Complete interview sessions and verify insights to see your knowledge graph grow.
            Topics and concepts will appear as connected nodes.
          </p>
        </div>
      </div>
    </div>
  );
}
