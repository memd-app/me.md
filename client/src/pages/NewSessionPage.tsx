import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import LoadingSpinner from '@/components/common/LoadingSpinner';

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
  const { user } = useAuth();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [isStartingMini, setIsStartingMini] = useState(false);
  const [isStartingTopic, setIsStartingTopic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoadingTopics, setIsLoadingTopics] = useState(true);
  const [topicLoadError, setTopicLoadError] = useState<string | null>(null);

  // Fetch user topics
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();

    const fetchTopics = async () => {
      setTopicLoadError(null);
      try {
        const res = await fetch('/api/topics', {
          headers: { 'x-user-id': user.id },
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          if (!controller.signal.aborted) {
            setTopics(data.topics || []);
          }
        } else if (!controller.signal.aborted) {
          setTopicLoadError('Failed to load your topics. Please refresh the page to try again.');
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
      const res = await fetch('/api/sessions/mini', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Server error' }));
        throw new Error(data.error || 'Failed to start mini session. Please try again.');
      }

      const data = await res.json();
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

  // Start session from an existing topic
  const handleStartTopicSession = async (topicId: string) => {
    if (!user || isStartingTopic) return;

    setIsStartingTopic(topicId);
    setError(null);

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ topicId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to start session' }));

        // If topic was deleted (404), remove it from the local list and show actionable toast
        if (res.status === 404) {
          setTopics(prev => prev.filter(t => t.id !== topicId));
          addToast('This topic was deleted or no longer exists. The list has been refreshed.', 'error', 5000);
          setIsStartingTopic(null);
          return;
        }

        throw new Error(data.error || 'Failed to start session. Please try again.');
      }

      const data = await res.json();
      navigate(`/app/sessions/${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session. Please check your connection and try again.');
      setIsStartingTopic(null);
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
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Choose a Topic
        </h2>
        <p className="text-gray-600 dark:text-gray-300 mb-4">
          Select an existing topic to start an in-depth interview session.
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

              return (
                <div
                  key={topic.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
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
                  <button
                    onClick={() => handleStartTopicSession(topic.id)}
                    disabled={!!isStartingTopic}
                    className="ml-4 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 hover:bg-primary-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5"
                  >
                    {isStarting ? (
                      <>
                        <div className="animate-spin w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full" />
                        Starting...
                      </>
                    ) : (
                      'Start Session'
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
