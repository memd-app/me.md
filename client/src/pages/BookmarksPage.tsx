import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface BookmarkMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface BookmarkSession {
  id: string;
  status: string;
  createdAt: string;
}

interface BookmarkTopic {
  id: string;
  title: string;
}

interface Bookmark {
  id: string;
  userId: string;
  messageId: string;
  sessionId: string;
  createdAt: string;
  message: BookmarkMessage | null;
  session: BookmarkSession | null;
  topic: BookmarkTopic | null;
}

export default function BookmarksPage() {
  const { user } = useAuth();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const fetchBookmarks = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/bookmarks', {
          headers: { 'x-user-id': user.id },
        });

        if (!res.ok) {
          throw new Error('Failed to load bookmarks');
        }

        const data = await res.json();
        setBookmarks(data.bookmarks || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load bookmarks');
      } finally {
        setIsLoading(false);
      }
    };

    fetchBookmarks();
  }, [user]);

  const handleRemoveBookmark = async (bookmark: Bookmark) => {
    if (!user) return;

    // Optimistic removal
    setBookmarks(prev => prev.filter(b => b.id !== bookmark.id));

    try {
      const res = await fetch(`/api/bookmarks/${bookmark.messageId}`, {
        method: 'DELETE',
        headers: { 'x-user-id': user.id },
      });

      if (!res.ok) {
        throw new Error('Failed to remove bookmark');
      }
    } catch {
      // Revert on error
      setBookmarks(prev => [...prev, bookmark].sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ));
    }
  };

  // Truncate long messages for display
  const truncateContent = (content: string, maxLength: number = 300) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength).trim() + '...';
  };

  // Remove markdown bold markers for clean display
  const cleanMarkdown = (text: string) => {
    return text.replace(/\*\*([^*]+)\*\*/g, '$1');
  };

  // Group bookmarks by session
  const groupedBySession = bookmarks.reduce<Record<string, { topic: BookmarkTopic | null; session: BookmarkSession | null; bookmarks: Bookmark[] }>>((acc, bookmark) => {
    const key = bookmark.sessionId;
    if (!acc[key]) {
      acc[key] = {
        topic: bookmark.topic,
        session: bookmark.session,
        bookmarks: [],
      };
    }
    acc[key].bookmarks.push(bookmark);
    return acc;
  }, {});

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Bookmarks</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-300">
            Your saved aha moments from interview sessions
          </p>
        </div>
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Bookmarks</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          Your saved aha moments from interview sessions
          {bookmarks.length > 0 && (
            <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
              {bookmarks.length} bookmark{bookmarks.length !== 1 ? 's' : ''}
            </span>
          )}
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {bookmarks.length === 0 ? (
        <div className="card text-center py-12">
          <span className="text-4xl block mb-3">&#11088;</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No bookmarks yet
          </h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            Star messages during interview sessions to save important moments here.
          </p>
          <Link
            to="/app/topics"
            className="btn-primary inline-block"
          >
            Go to Topics
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedBySession).map(([sessionId, group]) => (
            <div key={sessionId} className="card overflow-hidden">
              {/* Session header */}
              <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <svg className="w-5 h-5 text-primary-500 dark:text-primary-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {group.topic?.title || 'Unknown Topic'}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-300">
                      {group.session?.createdAt
                        ? new Date(group.session.createdAt).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : 'Unknown date'}
                      {' '}&middot;{' '}
                      {group.bookmarks.length} bookmark{group.bookmarks.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <Link
                  to={`/app/sessions/${sessionId}`}
                  className="flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors shrink-0"
                >
                  View Session
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>

              {/* Bookmarked messages */}
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {group.bookmarks.map((bookmark) => (
                  <div
                    key={bookmark.id}
                    className="px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Star icon */}
                      <div className="shrink-0 mt-0.5">
                        <svg className="w-5 h-5 text-yellow-500" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      </div>

                      {/* Message content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            bookmark.message?.role === 'assistant'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                              : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          }`}>
                            {bookmark.message?.role === 'assistant' ? 'AI Interviewer' : 'You'}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-300">
                            {bookmark.message?.createdAt
                              ? new Date(bookmark.message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : ''}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                          {bookmark.message
                            ? cleanMarkdown(truncateContent(bookmark.message.content))
                            : 'Message no longer available'}
                        </p>
                        <div className="mt-2 text-xs text-gray-500 dark:text-gray-300">
                          Bookmarked {bookmark.createdAt
                            ? new Date(bookmark.createdAt).toLocaleDateString(undefined, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : ''}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="shrink-0 flex items-center gap-2">
                        <Link
                          to={`/app/sessions/${bookmark.sessionId}`}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:text-primary-400 dark:hover:bg-primary-900/20 transition-colors"
                          title="Go to session"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </Link>
                        <button
                          onClick={() => handleRemoveBookmark(bookmark)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                          title="Remove bookmark"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
