import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import { formatTime } from '@/utils/dateFormat';
import { getContextStatus, compareSandboxStream } from '@/services/sandbox';
import { PageHeader } from '@/components/ui';

interface ComparisonResult {
  prompt: string;
  genericOutput: string;
  personalizedOutput: string;
  hasContext: boolean;
  usedAI: boolean;
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
  aiAvailable: boolean;
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

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function SandboxPage() {
  const { user } = useUser();
  const db = useDatabase();
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [contextStatus, setContextStatus] = useState<ContextStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Streaming state
  const [genericStreaming, setGenericStreaming] = useState('');
  const [personalizedStreaming, setPersonalizedStreaming] = useState('');
  const [genericDone, setGenericDone] = useState(false);
  const [personalizedDone, setPersonalizedDone] = useState(false);

  // Fetch context status on mount
  useEffect(() => {
    if (!user?.id) return;
    const controller = new AbortController();

    try {
      const data = getContextStatus(db);
      if (!controller.signal.aborted) {
        setContextStatus(data);
      }
    } catch {
      /* ignore context status errors */
    }

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
    setResult(null);
    setGenericStreaming('');
    setPersonalizedStreaming('');
    setGenericDone(false);
    setPersonalizedDone(false);

    try {
      // Use direct service call with streaming generators
      const streams = compareSandboxStream(db, prompt.trim());
      let genericText = '';
      let personalizedText = '';

      // Stream generic response
      const genericGen = streams.generic();
      for await (const chunk of genericGen) {
        if (controller.signal.aborted) return;
        genericText += chunk;
        setGenericStreaming(genericText);
      }
      setGenericDone(true);

      // Stream personalized response
      const personalizedGen = streams.personalized();
      for await (const chunk of personalizedGen) {
        if (controller.signal.aborted) return;
        personalizedText += chunk;
        setPersonalizedStreaming(personalizedText);
      }
      setPersonalizedDone(true);

      if (!controller.signal.aborted) {
        setResult({
          prompt: prompt.trim(),
          genericOutput: genericText,
          personalizedOutput: personalizedText,
          hasContext: streams.hasContext,
          usedAI: true,
          contextSummary: streams.contextSummary as ComparisonResult["contextSummary"],
          generatedAt: new Date().toISOString(),
        });
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

  // Determine what to show in each column
  const genericContent = result ? result.genericOutput : genericStreaming || null;
  const personalizedContent = result ? result.personalizedOutput : personalizedStreaming || null;
  const isGenericStreaming = isLoading && !genericDone && genericStreaming.length > 0;
  const isPersonalizedStreaming = isLoading && !personalizedDone && personalizedStreaming.length > 0;
  const isWaitingForGeneric = isLoading && !genericDone && genericStreaming.length === 0;
  const isWaitingForPersonalized = isLoading && genericDone && !personalizedDone && personalizedStreaming.length === 0;

  // Typographic "context used" summary — quiet dot-separated list, no colored pills
  const contextSummaryItems: string[] =
    result?.contextSummary && result.hasContext
      ? ([
          result.contextSummary.communicationInsights > 0 && `Communication (${result.contextSummary.communicationInsights})`,
          result.contextSummary.toneInsights > 0 && `Tone (${result.contextSummary.toneInsights})`,
          result.contextSummary.personalTraits > 0 && `Traits (${result.contextSummary.personalTraits})`,
          result.contextSummary.strengths > 0 && `Strengths (${result.contextSummary.strengths})`,
          result.contextSummary.decisionPatterns > 0 && `Decisions (${result.contextSummary.decisionPatterns})`,
        ].filter(Boolean) as string[])
      : [];

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        kicker="Sandbox"
        title="Context Sandbox"
        subtitle="Test how your personal context improves AI outputs. Enter a prompt and see the difference side by side."
      />

      {/* Context status — typographic note, not a colored box */}
      {contextStatus && (
        <div className="mb-6 bg-panel dark:bg-dark-card border border-rule dark:border-dark-border rounded-md px-4 py-3">
          <p
            className={`text-[11px] uppercase tracking-[0.08em] font-sans font-semibold mb-1 ${
              contextStatus.hasContext
                ? 'text-primary-600 dark:text-primary-400'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {contextStatus.hasContext ? 'Context active' : 'No verified insights yet'}
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {contextStatus.hasContext ? (
              <>
                {contextStatus.totalCategorizedInsights} verified insight{contextStatus.totalCategorizedInsights !== 1 ? 's' : ''} found across{' '}
                {contextStatus.categories ? Object.values(contextStatus.categories).filter(v => v > 0).length : 0} categories.
                {contextStatus.aiAvailable
                  ? ' AI-powered comparison is enabled.'
                  : ' Responses use template-based comparison (no API key configured).'}
              </>
            ) : (
              <>
                Complete interview sessions and verify insights to see personalized outputs.
                The comparison will still work, showing what personalization would look like.
              </>
            )}
          </p>
        </div>
      )}

      {/* Prompt input */}
      <div className="card mb-8">
        <label htmlFor="sandbox-prompt" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-2">
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

        {/* Example prompts — hairline chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="text-[11px] uppercase tracking-[0.08em] font-sans font-medium text-gray-400 dark:text-gray-600 self-center">Try:</span>
          {EXAMPLE_PROMPTS.map((example, i) => (
            <button
              key={i}
              onClick={() => handleExampleClick(example)}
              className="text-xs px-2.5 py-1 rounded-full border border-rule dark:border-dark-border text-gray-600 dark:text-gray-300 hover:border-primary-400 dark:hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
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
              <Spinner />
              Generating comparison...
            </span>
          ) : (
            'Run Comparison'
          )}
        </button>
      </div>

      {/* Error display */}
      {error && (
        <ApiErrorAlert
          message={error}
          onDismiss={() => setError(null)}
          className="mb-6"
        />
      )}

      {/* Comparison results — two hairline columns, serif output */}
      <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x md:divide-rule dark:md:divide-dark-border border-t border-rule dark:border-dark-border">
        {/* Without context */}
        <div className="pt-6 pb-2 md:pr-8">
          <h2 className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-4">
            Without
          </h2>
          {genericContent ? (
            <p className="font-serif text-[15px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {genericContent}
              {isGenericStreaming && <span className="inline-block w-1.5 h-4 bg-gray-400 dark:bg-gray-500 animate-pulse ml-0.5 align-text-bottom" />}
            </p>
          ) : isWaitingForGeneric ? (
            <div className="text-gray-500 dark:text-gray-400 text-sm py-8 flex items-center gap-2">
              <Spinner />
              Generating generic response...
            </div>
          ) : (
            <p className="font-serif italic text-gray-500 dark:text-gray-400 py-8">
              Run a comparison to see results
            </p>
          )}
        </div>

        {/* With context */}
        <div className="pt-6 pb-2 md:pl-8">
          <h2 className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400 mb-4">
            With Your Context
          </h2>
          {personalizedContent ? (
            <div>
              <p className="font-serif text-[15px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {personalizedContent}
                {isPersonalizedStreaming && <span className="inline-block w-1.5 h-4 bg-primary-500 dark:bg-primary-400 animate-pulse ml-0.5 align-text-bottom" />}
              </p>
              {contextSummaryItems.length > 0 && (
                <p className="mt-4 text-[10.5px] uppercase tracking-[0.08em] font-sans font-medium text-gray-500 dark:text-gray-400">
                  <span className="text-gray-400 dark:text-gray-600 normal-case font-normal mr-1.5">Context used:</span>
                  {contextSummaryItems.join(' · ')}
                </p>
              )}
            </div>
          ) : isWaitingForPersonalized ? (
            <div className="text-gray-500 dark:text-gray-400 text-sm py-8 flex items-center gap-2">
              <Spinner />
              Generating personalized response...
            </div>
          ) : isLoading ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm py-8">
              Waiting for generic response to finish...
            </p>
          ) : (
            <p className="font-serif italic text-gray-500 dark:text-gray-400 py-8">
              Run a comparison to see results
            </p>
          )}
        </div>
      </div>

      {/* Timestamp and AI indicator */}
      {result && (
        <div className="mt-6 pt-4 border-t border-rule dark:border-dark-border text-[11px] uppercase tracking-[0.08em] font-sans font-medium text-gray-400 dark:text-gray-600 text-center space-y-1">
          <div>Generated at {formatTime(result.generatedAt)}</div>
          {result.usedAI ? (
            <div className="flex items-center justify-center gap-1.5 text-primary-600 dark:text-primary-400">
              <span className="w-1 h-1 rounded-full bg-primary-500 inline-block" />
              <span>Powered by Claude AI</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-600 inline-block" />
              <span>Template-based (no API key configured)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
