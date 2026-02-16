import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { formatTime } from '@/utils/dateFormat';

interface ComparisonResult {
  prompt: string;
  genericOutput: string;
  personalizedOutput: string;
  hasContext: boolean;
  contextSummary: {
    communicationInsights: number;
    toneInsights: number;
    personalTraits: number;
    strengths: number;
    decisionPatterns: number;
  } | null;
  generatedAt: string;
}

interface ContextStatus {
  hasContext: boolean;
  totalCategorizedInsights: number;
  categories: {
    communicationStyle: number;
    toneOfVoice: number;
    personalTraits: number;
    strengths: number;
    decisionPatterns: number;
  } | null;
}

const EXAMPLE_PROMPTS = [
  'Write an email declining a meeting',
  'Write a thank you email to a colleague',
  'Write a self-introduction for a networking event',
  'Give feedback on a project proposal',
  'Explain a complex technical concept to a non-technical audience',
  'Create a strategy for improving team productivity',
];

export default function SandboxPage() {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [contextStatus, setContextStatus] = useState<ContextStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch context status on mount
  useEffect(() => {
    if (!user?.id) return;
    const controller = new AbortController();

    fetch('/api/sandbox/context-status', {
      headers: { 'x-user-id': user.id },
      signal: controller.signal,
    })
      .then(res => res.json())
      .then(data => {
        if (!controller.signal.aborted) {
          setContextStatus(data);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        /* ignore other context status errors */
      });

    return () => controller.abort();
  }, [user?.id]);

  const compareAbortRef = useRef<AbortController | null>(null);

  // Abort any in-flight comparison on unmount
  useEffect(() => {
    return () => {
      if (compareAbortRef.current) {
        compareAbortRef.current.abort();
      }
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || !user?.id) return;

    // Abort previous comparison if still running
    if (compareAbortRef.current) {
      compareAbortRef.current.abort();
    }

    const controller = new AbortController();
    compareAbortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/sandbox/compare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ prompt: prompt.trim() }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error: ${response.status}`);
      }

      const data: ComparisonResult = await response.json();
      if (!controller.signal.aborted) {
        setResult(data);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to generate comparison');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [prompt, user?.id]);

  const handleExampleClick = (example: string) => {
    setPrompt(example);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (prompt.trim() && !isLoading && user?.id) {
        handleSubmit();
      }
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Context Sandbox</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          Test how your personal context improves AI outputs. Enter a prompt and see the difference side by side.
        </p>
      </div>

      {/* Context status banner */}
      {contextStatus && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          contextStatus.hasContext
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
            : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
        }`}>
          {contextStatus.hasContext ? (
            <span>
              <span className="font-medium">Context active:</span>{' '}
              {contextStatus.totalCategorizedInsights} verified insight{contextStatus.totalCategorizedInsights !== 1 ? 's' : ''} found across{' '}
              {contextStatus.categories ? Object.values(contextStatus.categories).filter(v => v > 0).length : 0} categories.
              Personalized outputs will reflect your style.
            </span>
          ) : (
            <span>
              <span className="font-medium">No verified insights yet.</span>{' '}
              Complete interview sessions and verify insights to see personalized outputs.
              The comparison will still work, showing what personalization would look like.
            </span>
          )}
        </div>
      )}

      {/* Prompt input */}
      <div className="card mb-6">
        <label htmlFor="sandbox-prompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Enter a prompt to test
        </label>
        <textarea
          id="sandbox-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          className="input-field"
          rows={3}
          placeholder='e.g., "Write an email declining a meeting politely"'
          disabled={isLoading}
        />

        {/* Example prompts */}
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-300 self-center">Try:</span>
          {EXAMPLE_PROMPTS.map((example, i) => (
            <button
              key={i}
              onClick={() => handleExampleClick(example)}
              className="text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              disabled={isLoading}
            >
              {example}
            </button>
          ))}
        </div>

        <button
          className="btn-primary mt-4"
          disabled={!prompt.trim() || isLoading}
          onClick={handleSubmit}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating comparison...
            </span>
          ) : (
            'Run Comparison'
          )}
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm" role="alert" aria-live="assertive">
          <span className="font-medium">Error:</span> {error}
          <button onClick={() => setError(null)} className="ml-2 underline" aria-label="Dismiss error">Dismiss</button>
        </div>
      )}

      {/* Comparison results */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Generic output */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 inline-block"></span>
            Without your context
          </h2>
          {result ? (
            <div className="prose dark:prose-invert prose-sm max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 leading-relaxed">
                {result.genericOutput}
              </pre>
            </div>
          ) : (
            <div className="text-gray-500 dark:text-gray-300 text-center py-8">
              Run a comparison to see results
            </div>
          )}
        </div>

        {/* Personalized output */}
        <div className="card border-primary-200 dark:border-primary-800">
          <h2 className="text-sm font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary-500 dark:bg-primary-400 inline-block"></span>
            With your me.md context
          </h2>
          {result ? (
            <div>
              <div className="prose dark:prose-invert prose-sm max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 dark:text-gray-300 bg-primary-50 dark:bg-primary-900/20 p-4 rounded-lg border border-primary-200 dark:border-primary-800 leading-relaxed">
                  {result.personalizedOutput}
                </pre>
              </div>
              {result.contextSummary && result.hasContext && (
                <div className="mt-3 text-xs text-gray-500 dark:text-gray-300 flex flex-wrap gap-2">
                  <span className="font-medium">Context used:</span>
                  {result.contextSummary.communicationInsights > 0 && (
                    <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                      Communication ({result.contextSummary.communicationInsights})
                    </span>
                  )}
                  {result.contextSummary.toneInsights > 0 && (
                    <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full">
                      Tone ({result.contextSummary.toneInsights})
                    </span>
                  )}
                  {result.contextSummary.personalTraits > 0 && (
                    <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full">
                      Traits ({result.contextSummary.personalTraits})
                    </span>
                  )}
                  {result.contextSummary.strengths > 0 && (
                    <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full">
                      Strengths ({result.contextSummary.strengths})
                    </span>
                  )}
                  {result.contextSummary.decisionPatterns > 0 && (
                    <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full">
                      Decisions ({result.contextSummary.decisionPatterns})
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-gray-500 dark:text-gray-300 text-center py-8">
              Run a comparison to see results
            </div>
          )}
        </div>
      </div>

      {/* Timestamp */}
      {result && (
        <div className="mt-4 text-xs text-gray-500 dark:text-gray-300 text-center">
          Generated at {formatTime(result.generatedAt)}
        </div>
      )}
    </div>
  );
}
