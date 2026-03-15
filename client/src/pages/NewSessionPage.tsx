import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useToast } from '@/contexts/ToastContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getTopics } from '@/services/topics';
import { createSession, createMiniSession } from '@/services/sessions';

interface Topic {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  intent: string | null;
  tags: string | null;
}

export default function NewSessionPage() {
  const { user } = useUser();
  const db = useDatabase();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [isStartingMini, setIsStartingMini] = useState(false);
  const [isStartingTopic, setIsStartingTopic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoadingTopics, setIsLoadingTopics] = useState(true);
  const [topicLoadError, setTopicLoadError] = useState<string | null>(null);
  const [researchEnabled, setResearchEnabled] = useState<Record<string, boolean>>({});
  const [isResearching, setIsResearching] = useState<string | null>(null);

  // Fetch user topics
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();

    const fetchTopics = async () => {
      setTopicLoadError(null);
      try {
        const data = getTopics(db);
        if (!controller.signal.aborted) {
          setTopics(data || []);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setTopicLoadError('Unable to load topics. Please check your connection and refresh the page.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingTopics(false);
        }
      }
    };

    fetchTopics();
    return () => controller.abort();
  }, [user]);

  // Start quick-win mini session
  const handleStartMiniSession = async () => {
    if (!user || isStartingMini) return;

    setIsStartingMini(true);
    setError(null);

    try {
      const data = await createMiniSession(db);
      navigate(`/app/sessions/${data.session.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start mini session';
      // Improve network error messaging
      if (err instanceof TypeError) {
        setError('Unable to connect to the server. Please check your internet connection and try again.');
      } else {
        setError(msg);
      }
      setIsStartingMini(false);
    }
  };

  // Toggle research mode for a topic
  const handleToggleResearch = (topicId: string) => {
    setResearchEnabled(prev => ({
      ...prev,
      [topicId]: !prev[topicId],
    }));
  };

  // Start session from an existing topic (with optional research)
  const handleStartTopicSession = async (topicId: string) => {
    if (!user || isStartingTopic || isResearching) return;

    const enableResearch = researchEnabled[topicId] || false;

    if (enableResearch) {
      setIsResearching(topicId);
    }
    setIsStartingTopic(topicId);
    setError(null);

    try {
      const data = await createSession(db, topicId, { enableResearch });
      if (enableResearch) {
        addToast('Research-driven session started! The AI has researched your topic for more informed questions.', 'success', 4000);
      }
      navigate(`/app/sessions/${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session. Please check your connection and try again.');
      setIsStartingTopic(null);
      setIsResearching(null);
    }
  };

  // Parse tags JSON
  const parseTags = (tagsStr: string | null): string[] => {
    if (!tagsStr) return [];
    try {
      return JSON.parse(tagsStr);
    } catch {
      return [];
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">New Session</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          Start a new AI-guided interview session
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <ApiErrorAlert
          message={error}
          onDismiss={() => setError(null)}
          className="mb-4"
        />
      )}

      {/* Quick Win Mini Session */}
      <div className="card mb-6 border-2 border-primary-200 dark:border-primary-800 bg-gradient-to-r from-primary-50 to-white dark:from-primary-900/10 dark:to-dark-surface">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shrink-0">
            <span className="text-2xl">&#x26A1;</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Quick Win Session
              </h2>
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                ~5 min
              </span>
            </div>
            <p className="text-gray-600 dark:text-gray-300 mb-3">
              Answer 5-7 high-impact questions to build your starter profile. Perfect for getting started quickly!
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleStartMiniSession}
                disabled={isStartingMini}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isStartingMini ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                    Starting...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Start Quick Session
                  </>
                )}
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-300">
                Creates insights + knowledge graph
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Select Topic */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Choose a Topic
          </h2>
          {user?.sessionLengthDefault && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300" title="Session length from your preferences">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {user.sessionLengthDefault} min
            </span>
          )}
        </div>
        <p className="text-gray-600 dark:text-gray-300 mb-4">
          Select an existing topic to start an in-depth interview session. Enable <strong>Research Mode</strong> for AI-researched, more informed questions.
        </p>

        {isLoadingTopics ? (
          <div className="text-center py-8">
            <LoadingSpinner size="sm" message="Loading topics..." />
          </div>
        ) : topicLoadError ? (
          /* Topic load error state */
          <div className="text-center py-8 border border-dashed border-red-300 dark:border-red-700 rounded-lg bg-red-50 dark:bg-red-900/10">
            <svg className="w-8 h-8 mx-auto text-red-400 dark:text-red-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-red-600 dark:text-red-400 text-sm mb-3">
              {topicLoadError}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn-secondary text-sm"
            >
              Refresh Page
            </button>
          </div>
        ) : topics.length === 0 ? (
          /* Empty state */
          <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <span className="text-3xl block mb-2">&#x1F4CB;</span>
            <p className="text-gray-500 dark:text-gray-300 mb-3">
              No topics available. Create a topic first.
            </p>
            <Link to="/app/topics/new" className="btn-secondary inline-block">
              Create Topic
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {topics.map((topic) => {
              const tags = parseTags(topic.tags);
              const isStarting = isStartingTopic === topic.id;
              const isTopicResearching = isResearching === topic.id;
              const researchOn = researchEnabled[topic.id] || false;

              return (
                <div
                  key={topic.id}
                  className={`p-4 rounded-lg border transition-colors ${
                    researchOn
                      ? 'border-purple-300 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/10'
                      : 'border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {topic.title}
                        </h3>
                        <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                          topic.status === 'backlog' ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' :
                          topic.status === 'in_progress' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                          topic.status === 'extracted' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                          'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          {topic.status}
                        </span>
                        {researchOn && (
                          <span className="px-1.5 py-0.5 text-xs rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                            Research Mode
                          </span>
                        )}
                      </div>
                      {topic.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-300 truncate">
                          {topic.description}
                        </p>
                      )}
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {tags.slice(0, 3).map((tag, i) => (
                            <span key={i} className="px-1.5 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="ml-4 flex items-center gap-2 shrink-0">
                      {/* Research Mode Toggle */}
                      <button
                        onClick={() => handleToggleResearch(topic.id)}
                        disabled={!!isStartingTopic}
                        className={`p-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          researchOn
                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800/40'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                        title={researchOn ? 'Disable research mode' : 'Enable research mode — AI researches the topic first for more informed questions'}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </button>
                      {/* Start Session Button */}
                      <button
                        onClick={() => handleStartTopicSession(topic.id)}
                        disabled={!!isStartingTopic}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 ${
                          researchOn
                            ? 'bg-purple-600 hover:bg-purple-700'
                            : 'bg-primary-600 hover:bg-primary-700'
                        }`}
                      >
                        {isStarting ? (
                          <>
                            <div className="animate-spin w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full" />
                            {isTopicResearching ? 'Researching...' : 'Starting...'}
                          </>
                        ) : researchOn ? (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            Research & Start
                          </>
                        ) : (
                          'Start Session'
                        )}
                      </button>
                    </div>
                  </div>
                  {/* Research mode description */}
                  {researchOn && (
                    <div className="mt-2 pt-2 border-t border-purple-200 dark:border-purple-800">
                      <p className="text-xs text-purple-600 dark:text-purple-400">
                        The AI will research this topic before the interview begins, enabling more specific and knowledgeable questions based on relevant facts, frameworks, and perspectives.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
