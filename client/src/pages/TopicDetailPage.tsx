import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface Topic {
  id: string;
  title: string;
  description: string | null;
  tags: string | null;
  status: string;
  priority: string;
  intent: string | null;
  trigger: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Session {
  id: string;
  topicId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  extracted: 'Extracted',
  refined: 'Refined',
};

const STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  extracted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  refined: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const INTENT_LABELS: Record<string, string> = {
  articulate: 'Articulate',
  explore: 'Explore',
  decide: 'Decide',
  document: 'Document',
};

export default function TopicDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !id) return;

    const fetchTopic = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Fetch topic details
        const topicRes = await fetch(`/api/topics/${id}`, {
          headers: { 'x-user-id': user.id },
        });
        if (!topicRes.ok) {
          throw new Error('Failed to load topic');
        }
        const topicData = await topicRes.json();
        setTopic(topicData.topic);

        // Fetch sessions for this topic
        const sessionsRes = await fetch(`/api/sessions?topicId=${id}`, {
          headers: { 'x-user-id': user.id },
        });
        if (sessionsRes.ok) {
          const sessionsData = await sessionsRes.json();
          setSessions(sessionsData.sessions || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load topic');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTopic();
  }, [user, id]);

  const handleStartSession = async () => {
    if (!user || !topic) return;

    setIsStartingSession(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ topicId: topic.id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start session');
      }

      const data = await res.json();
      navigate(`/app/session/${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setIsStartingSession(false);
    }
  };

  const parseTags = (tagsStr: string | null): string[] => {
    if (!tagsStr) return [];
    try {
      return JSON.parse(tagsStr);
    } catch {
      return [];
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="card text-center py-12">
          <div className="animate-spin inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full mb-3" />
          <p className="text-gray-600 dark:text-gray-400">Loading topic...</p>
        </div>
      </div>
    );
  }

  if (error && !topic) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="card text-center py-12">
          <span className="text-4xl block mb-3">😕</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Topic not found
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <Link to="/app/topics" className="btn-primary inline-block">
            Back to Topics
          </Link>
        </div>
      </div>
    );
  }

  if (!topic) return null;

  const tags = parseTags(topic.tags);
  const activeSessions = sessions.filter(s => s.status === 'active');
  const completedSessions = sessions.filter(s => s.status === 'completed');

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-6">
        <Link to="/app/topics" className="hover:text-primary-600 dark:hover:text-primary-400">
          Topics
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-white">{topic.title}</span>
      </nav>

      {/* Error banner */}
      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 mb-6">
          {error}
        </div>
      )}

      {/* Topic header */}
      <div className="card mb-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {topic.title}
              </h1>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[topic.status] || STATUS_COLORS.backlog}`}>
                {STATUS_LABELS[topic.status] || topic.status}
              </span>
            </div>

            {topic.description && (
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {topic.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {topic.priority && (
                <span className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                  <span className="font-medium">Priority:</span> {PRIORITY_LABELS[topic.priority] || topic.priority}
                </span>
              )}
              {topic.intent && (
                <span className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                  <span className="font-medium">Intent:</span> {INTENT_LABELS[topic.intent] || topic.intent}
                </span>
              )}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Start Session CTA */}
      <div className="card mb-6 border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Ready to explore this topic?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              Start an AI-guided interview session to build your personal knowledge.
            </p>
          </div>
          <button
            onClick={handleStartSession}
            disabled={isStartingSession}
            className="btn-primary flex items-center gap-2 shrink-0"
          >
            {isStartingSession ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                Starting...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Start Session
              </>
            )}
          </button>
        </div>
      </div>

      {/* Session history */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Session History
        </h2>

        {sessions.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <span className="text-3xl block mb-2">💬</span>
            <p className="text-gray-500 dark:text-gray-400">
              No sessions yet. Start your first interview session above!
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeSessions.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  Active Sessions
                </h3>
                {activeSessions.map((session) => (
                  <Link
                    key={session.id}
                    to={`/app/session/${session.id}`}
                    className="block p-4 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/30 dark:bg-primary-900/10 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors mb-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="font-medium text-gray-900 dark:text-white">
                          Active Session
                        </span>
                      </div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Started {new Date(session.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {completedSessions.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  Completed Sessions
                </h3>
                {completedSessions.map((session) => (
                  <Link
                    key={session.id}
                    to={`/app/session/${session.id}`}
                    className="block p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors mb-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-gray-400" />
                        <span className="font-medium text-gray-900 dark:text-white">
                          Completed Session
                        </span>
                      </div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {session.completedAt
                          ? new Date(session.completedAt).toLocaleString()
                          : new Date(session.updatedAt).toLocaleString()
                        }
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
