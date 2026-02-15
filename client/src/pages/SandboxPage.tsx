import { useState } from 'react';

export default function SandboxPage() {
  const [prompt, setPrompt] = useState('');

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Context Sandbox</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Test how your personal context improves AI outputs
        </p>
      </div>

      {/* Prompt input */}
      <div className="card mb-6">
        <label htmlFor="sandbox-prompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Enter a prompt to test
        </label>
        <textarea
          id="sandbox-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="input-field"
          rows={3}
          placeholder='e.g., "Write an email declining a meeting politely"'
        />
        <button className="btn-primary mt-3" disabled={!prompt.trim()}>
          Run Comparison
        </button>
      </div>

      {/* Comparison results */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Without your context
          </h2>
          <div className="text-gray-400 dark:text-gray-500 text-center py-8">
            Run a comparison to see results
          </div>
        </div>
        <div className="card border-primary-200 dark:border-primary-800">
          <h2 className="text-sm font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wide mb-3">
            With your me.md context
          </h2>
          <div className="text-gray-400 dark:text-gray-500 text-center py-8">
            Run a comparison to see results
          </div>
        </div>
      </div>
    </div>
  );
}
