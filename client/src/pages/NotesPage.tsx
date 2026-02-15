import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

type NoteFormat = 'full_analysis' | 'brief_summary' | 'decision_framework' | 'json';

interface NoteListItem {
  id: string;
  sessionId: string;
  topicId: string;
  userId: string;
  title: string | null;
  selectedFormat: NoteFormat;
  topicTitle: string;
  createdAt: string;
  updatedAt: string;
}

const FORMAT_LABELS: Record<NoteFormat, string> = {
  full_analysis: 'Full Analysis',
  brief_summary: 'Brief Summary',
  decision_framework: 'Decision Framework',
  json: 'JSON',
};

const FORMAT_COLORS: Record<NoteFormat, string> = {
  full_analysis: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  brief_summary: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  decision_framework: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  json: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffHours < 1) {
    const mins = Math.floor(diffMs / (1000 * 60));
    return mins <= 1 ? 'Just now' : `${mins}m ago`;
  }
  if (diffHours < 24) {
    return `${Math.floor(diffHours)}h ago`;
  }
  if (diffDays < 7) {
    return `${Math.floor(diffDays)}d ago`;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

export default function NotesPage() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const fetchNotes = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/notes', {
          headers: { 'x-user-id': user.id },
        });
        if (!res.ok) throw new Error('Failed to load notes');
        const data = await res.json();
        setNotes(data.notes || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load notes');
      } finally {
        setIsLoading(false);
      }
    };

    fetchNotes();
  }, [user]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-4 w-72 bg-gray-100 dark:bg-gray-800 rounded animate-pulse mt-2" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-white dark:bg-dark-surface rounded-lg border border-gray-200 dark:border-dark-border animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <svg className="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Notes
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {notes.length} note{notes.length !== 1 ? 's' : ''} from distilled sessions
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Empty state */}
      {notes.length === 0 && !error && (
        <div className="text-center py-16 bg-white dark:bg-dark-surface rounded-lg border border-gray-200 dark:border-dark-border">
          <svg className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">No notes yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-md mx-auto">
            Notes are created when you finish and distill a session. Start a session to begin building your knowledge base.
          </p>
          <Link
            to="/app/session/new"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
          >
            Start a Session
          </Link>
        </div>
      )}

      {/* Notes list */}
      {notes.length > 0 && (
        <div className="space-y-3">
          {notes.map((note) => (
            <Link
              key={note.id}
              to={`/app/session/${note.sessionId}`}
              className="block p-4 bg-white dark:bg-dark-surface rounded-lg border border-gray-200 dark:border-dark-border hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors truncate">
                    {note.title || 'Untitled Note'}
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    <Link
                      to={`/app/topics/${note.topicId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors truncate max-w-[200px]"
                    >
                      {note.topicTitle}
                    </Link>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {formatDate(note.createdAt)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${FORMAT_COLORS[note.selectedFormat] || FORMAT_COLORS.full_analysis}`}>
                    {FORMAT_LABELS[note.selectedFormat] || 'Full Analysis'}
                  </span>
                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:text-primary-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
