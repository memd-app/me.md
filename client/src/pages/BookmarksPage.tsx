import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import PageTabs from '@/components/ui/PageTabs';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { EmptyState, PageHeader } from '@/components/ui';
import { formatShortDate, formatTime, formatDateTime } from '@/utils/dateFormat';
import { getBookmarks, deleteBookmark } from '@/services/bookmarks';

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
  const { user } = useUser();
  const db = useDatabase();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();

    const fetchBookmarks = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = getBookmarks(db);
        setBookmarks((data.bookmarks || []) as Bookmark[]);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load bookmarks');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    fetchBookmarks();
    return () => controller.abort();
  }, [user]);

  const handleRemoveBookmark = async (bookmark: Bookmark) => {
    if (!user) return;

    // Optimistic removal
    setBookmarks(prev => prev.filter(b => b.id !== bookmark.id));

    try {
      deleteBookmark(db, bookmark.messageId);
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
        <div className="mb-8 pb-6 border-b border-rule dark:border-dark-border">
          <div className="h-9 w-32 bg-panel dark:bg-dark-card rounded-sm animate-pulse" />
          <div className="h-4 w-72 bg-panel dark:bg-dark-card rounded-sm animate-pulse mt-3" />
        </div>
        <LoadingSpinner message="Loading bookmarks..." className="py-12" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Notes"
        subtitle={
          <>
            Your saved aha moments from interview sessions
            {bookmarks.length > 0 && ` — ${bookmarks.length} bookmark${bookmarks.length !== 1 ? 's' : ''}`}
          </>
        }
      />

      <PageTabs
        tabs={[
          { to: '/app/notes', label: 'Notes', end: true },
          { to: '/app/notes/bookmarks', label: 'Bookmarks' },
        ]}
      />

      {error && (
        <ApiErrorAlert
          message={error}
          onDismiss={() => setError(null)}
          className="mb-6"
        />
      )}

      {bookmarks.length === 0 ? (
        <EmptyState
          kicker="No bookmarks yet"
          message="Star messages during interview sessions to save important moments here."
          action={
            <Link to="/app/topics" className="btn-primary inline-block">
              Go to topics
            </Link>
          }
        />
      ) : (
        <div className="space-y-10">
          {Object.entries(groupedBySession).map(([sessionId, group]) => (
            <section key={sessionId} aria-label={group.topic?.title || 'Session'}>
              {/* Session header — SectionHeading convention: small-caps label + hairline,
                  with meta and a quiet action on the trailing edge */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="uppercase text-[11px] tracking-[0.08em] font-medium font-sans text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {group.topic?.title || 'Unknown Topic'}
                </span>
                <span className="flex-1 border-t border-rule dark:border-dark-border min-w-[24px]" aria-hidden="true" />
                <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-600 whitespace-nowrap">
                  {group.session?.createdAt ? formatShortDate(group.session.createdAt) : 'Unknown date'}
                  {' '}&middot;{' '}
                  {group.bookmarks.length} bookmark{group.bookmarks.length !== 1 ? 's' : ''}
                </span>
                <Link
                  to={`/app/sessions/${sessionId}`}
                  className="shrink-0 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                >
                  View session &rarr;
                </Link>
              </div>

              {/* Bookmarked quotes — serif italic pull-quote on a panel surface, amber left rule */}
              <div className="divide-y divide-rule dark:divide-dark-border">
                {group.bookmarks.map((bookmark) => {
                  const isAssistant = bookmark.message?.role === 'assistant';
                  return (
                    <div key={bookmark.id} className="py-5 first:pt-0 last:pb-0">
                      <div className="border-l-2 border-primary-400 dark:border-primary-500 bg-panel/60 dark:bg-dark-card/60 rounded-r-sm pl-5 pr-4 py-4">
                        <p className="font-serif italic text-[17px] leading-[1.6] text-gray-800 dark:text-gray-200 break-words">
                          &ldquo;{bookmark.message
                            ? cleanMarkdown(truncateContent(bookmark.message.content))
                            : 'Message no longer available'}&rdquo;
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-3 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold">
                          <span className={isAssistant ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}>
                            {isAssistant ? 'AI Interviewer' : 'You'}
                          </span>
                          {bookmark.message?.createdAt && (
                            <>
                              <span aria-hidden="true" className="normal-case font-normal text-gray-300 dark:text-gray-700">&middot;</span>
                              <span className="normal-case tracking-normal font-normal text-gray-500 dark:text-gray-400">
                                {formatTime(bookmark.message.createdAt)}
                              </span>
                            </>
                          )}
                          <span aria-hidden="true" className="normal-case font-normal text-gray-300 dark:text-gray-700">&middot;</span>
                          <span className="normal-case tracking-normal font-normal text-gray-500 dark:text-gray-400">
                            Bookmarked {bookmark.createdAt ? formatDateTime(bookmark.createdAt) : ''}
                          </span>
                        </div>
                      </div>

                      {/* Actions — quiet small-caps links */}
                      <div className="flex items-center gap-5 mt-2.5 pl-5">
                        <Link
                          to={`/app/sessions/${bookmark.sessionId}`}
                          className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                        >
                          Jump to session
                        </Link>
                        <button
                          onClick={() => handleRemoveBookmark(bookmark)}
                          className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
