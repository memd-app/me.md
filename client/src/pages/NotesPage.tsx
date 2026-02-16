import { useState, useEffect, useMemo, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import VerifiedBadge from '@/components/VerifiedBadge';
import { formatRelativeTime, formatDateTime } from '@/utils/dateFormat';

type NoteFormat = 'full_analysis' | 'brief_summary' | 'decision_framework' | 'json';

interface NoteListItem {
  id: string;
  sessionId: string;
  topicId: string;
  userId: string;
  title: string | null;
  contentFullAnalysis: string | null;
  contentBriefSummary: string | null;
  contentDecisionFramework: string | null;
  contentJson: string | null;
  selectedFormat: NoteFormat;
  topicTitle: string;
  createdAt: string;
  updatedAt: string;
}

interface Insight {
  id: string;
  content: string;
  confidenceScore: number;
  verificationStatus: string;
}

const FORMAT_LABELS: Record<NoteFormat, string> = {
  full_analysis: 'Full Analysis',
  brief_summary: 'Brief Summary',
  decision_framework: 'Decision Framework',
  json: 'JSON',
};

const FORMAT_ICONS: Record<NoteFormat, string> = {
  full_analysis: '📝',
  brief_summary: '📋',
  decision_framework: '🎯',
  json: '{}',
};

const FORMAT_COLORS: Record<NoteFormat, string> = {
  full_analysis: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  brief_summary: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  decision_framework: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  json: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

// Date formatting now uses shared utils from @/utils/dateFormat
// formatRelativeTime replaces the old formatDate function
// formatDateTime is imported from @/utils/dateFormat

function getContentPreview(note: NoteListItem): string {
  const format = note.selectedFormat || 'full_analysis';
  let content = '';
  switch (format) {
    case 'full_analysis':
      content = note.contentFullAnalysis || '';
      break;
    case 'brief_summary':
      content = note.contentBriefSummary || '';
      break;
    case 'decision_framework':
      content = note.contentDecisionFramework || '';
      break;
    case 'json':
      content = note.contentJson || '';
      break;
    default:
      content = note.contentFullAnalysis || note.contentBriefSummary || '';
  }
  const stripped = content
    .replace(/^#+\s+.*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/>/g, '')
    .replace(/-\s/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  return stripped.length > 150 ? stripped.substring(0, 150) + '...' : stripped;
}

function getNoteContent(note: NoteListItem, format: NoteFormat): string {
  switch (format) {
    case 'full_analysis':
      return note.contentFullAnalysis || 'No full analysis available.';
    case 'brief_summary':
      return note.contentBriefSummary || 'No brief summary available.';
    case 'decision_framework':
      return note.contentDecisionFramework || 'No decision framework available.';
    case 'json':
      return note.contentJson || '{}';
    default:
      return note.contentFullAnalysis || '';
  }
}

function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');

  return (
    <div className="prose dark:prose-invert max-w-none text-sm">
      {lines.map((line, i) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('# ')) {
          return <h1 key={i} className="text-xl font-bold mt-4 mb-2 text-gray-900 dark:text-gray-100">{trimmed.slice(2)}</h1>;
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={i} className="text-lg font-semibold mt-3 mb-1.5 text-gray-800 dark:text-gray-200">{trimmed.slice(3)}</h2>;
        }
        if (trimmed.startsWith('### ')) {
          return <h3 key={i} className="text-base font-semibold mt-2 mb-1 text-gray-800 dark:text-gray-200">{trimmed.slice(4)}</h3>;
        }
        if (trimmed.startsWith('> ')) {
          return (
            <blockquote key={i} className="border-l-4 border-primary-300 dark:border-primary-600 pl-3 py-1 my-1 italic text-gray-600 dark:text-gray-300">
              {renderInlineMarkdown(trimmed.slice(2))}
            </blockquote>
          );
        }
        if (trimmed.startsWith('- ')) {
          return (
            <div key={i} className="flex gap-2 ml-4 my-0.5">
              <span className="text-gray-400 shrink-0">&#8226;</span>
              <span>{renderInlineMarkdown(trimmed.slice(2))}</span>
            </div>
          );
        }
        if (/^\d+\.\s/.test(trimmed)) {
          const match = trimmed.match(/^(\d+)\.\s(.*)$/);
          if (match) {
            return (
              <div key={i} className="flex gap-2 ml-4 my-0.5">
                <span className="text-gray-500 font-medium shrink-0">{match[1]}.</span>
                <span>{renderInlineMarkdown(match[2])}</span>
              </div>
            );
          }
        }
        if (trimmed === '') {
          return <div key={i} className="h-2" />;
        }
        return <p key={i} className="my-0.5 text-gray-700 dark:text-gray-300">{renderInlineMarkdown(trimmed)}</p>;
      })}
    </div>
  );
}

export default function NotesPage() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail view state
  const [selectedNote, setSelectedNote] = useState<NoteListItem | null>(null);
  const [noteInsights, setNoteInsights] = useState<Insight[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<NoteFormat>('full_analysis');
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Filter state
  const [filterFormat, setFilterFormat] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();

    const fetchNotes = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/notes', {
          headers: { 'x-user-id': user.id },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('Failed to load notes');
        const data = await res.json();
        setNotes(data.notes || []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load notes');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    fetchNotes();
    return () => controller.abort();
  }, [user]);

  const fetchNoteDetail = async (noteId: string) => {
    if (!user) return;
    setIsLoadingDetail(true);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        headers: { 'x-user-id': user.id },
      });
      if (!res.ok) throw new Error('Failed to fetch note detail');
      const data = await res.json();
      const note = data.note;
      // Find the enriched note from our list to get topicTitle
      const enrichedNote = notes.find(n => n.id === noteId);
      const fullNote = {
        ...note,
        topicTitle: enrichedNote?.topicTitle || note.topicTitle || 'Unknown Topic',
      };
      setSelectedNote(fullNote);
      setNoteInsights(data.insights || []);
      setSelectedFormat((note.selectedFormat || 'full_analysis') as NoteFormat);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load note detail');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleNoteClick = (note: NoteListItem) => {
    // Use the note from the list directly (already has all content fields)
    setSelectedNote(note);
    setSelectedFormat((note.selectedFormat || 'full_analysis') as NoteFormat);
    // Fetch insights separately via the detail endpoint
    fetchNoteDetail(note.id);
  };

  const handleBackToList = () => {
    setSelectedNote(null);
    setNoteInsights([]);
  };

  // Filtering
  const filteredNotes = useMemo(() => {
    let result = notes;
    if (filterFormat !== 'all') {
      result = result.filter(n => n.selectedFormat === filterFormat);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(n =>
        (n.title || '').toLowerCase().includes(query) ||
        (n.topicTitle || '').toLowerCase().includes(query) ||
        getContentPreview(n).toLowerCase().includes(query)
      );
    }
    return result;
  }, [notes, filterFormat, searchQuery]);

  // =====================
  // DETAIL VIEW
  // =====================
  if (selectedNote) {
    const content = getNoteContent(selectedNote, selectedFormat);
    return (
      <div className="max-w-4xl mx-auto">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-300 mb-4">
          <button
            onClick={handleBackToList}
            className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            Notes
          </button>
          <span>/</span>
          <span className="text-gray-900 dark:text-gray-100 truncate">{selectedNote.title || 'Untitled Note'}</span>
        </nav>

        {/* Note header */}
        <div className="bg-white dark:bg-dark-surface rounded-xl border border-gray-200 dark:border-dark-border p-6 mb-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                {selectedNote.title || 'Untitled Note'}
              </h1>
              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500 dark:text-gray-300">
                <Link
                  to={`/app/topics/${selectedNote.topicId}`}
                  className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  {selectedNote.topicTitle || 'Unknown Topic'}
                </Link>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span>{formatDateTime(selectedNote.createdAt)}</span>
              </div>
            </div>
            <button
              onClick={handleBackToList}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ml-3"
              title="Back to notes list"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Format tabs */}
          <div className="flex flex-wrap gap-2">
            {(['full_analysis', 'brief_summary', 'decision_framework', 'json'] as NoteFormat[]).map(fmt => (
              <button
                key={fmt}
                onClick={() => setSelectedFormat(fmt)}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                  selectedFormat === fmt
                    ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <span className="mr-1.5">{FORMAT_ICONS[fmt]}</span>
                {FORMAT_LABELS[fmt]}
              </button>
            ))}
          </div>
        </div>

        {/* Note content */}
        <div className="bg-white dark:bg-dark-surface rounded-xl border border-gray-200 dark:border-dark-border p-6 mb-4">
          {isLoadingDetail ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner message="Loading note..." />
            </div>
          ) : selectedFormat === 'json' ? (
            <pre className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto text-sm font-mono whitespace-pre-wrap text-gray-800 dark:text-gray-200">
              {content}
            </pre>
          ) : (
            <SimpleMarkdown content={content} />
          )}
        </div>

        {/* Insights section */}
        {noteInsights.length > 0 && (
          <div className="bg-white dark:bg-dark-surface rounded-xl border border-gray-200 dark:border-dark-border p-6 mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
              Extracted Insights ({noteInsights.length})
            </h2>
            <div className="space-y-3">
              {noteInsights.map(insight => (
                <div
                  key={insight.id}
                  className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                >
                  <div className="flex-1">
                    <p className="text-sm text-gray-800 dark:text-gray-200">{insight.content}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-xs text-gray-500 dark:text-gray-300">
                        Confidence: {insight.confidenceScore}%
                      </span>
                      <VerifiedBadge status={insight.verificationStatus} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Link to session */}
        <div className="flex justify-center pb-4">
          <Link
            to={`/app/session/${selectedNote.sessionId}`}
            className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
          >
            View original session &rarr;
          </Link>
        </div>
      </div>
    );
  }

  // =====================
  // LIST VIEW
  // =====================
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
        <p className="text-sm text-gray-500 dark:text-gray-300 mt-1">
          {notes.length} note{notes.length !== 1 ? 's' : ''} from distilled sessions
        </p>
      </div>

      {/* Search & Filter bar */}
      {notes.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search notes by title or topic..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-dark-border rounded-lg bg-white dark:bg-dark-surface text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 dark:text-gray-100"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setFilterFormat('all')}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                filterFormat === 'all'
                  ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              All
            </button>
            {(['full_analysis', 'brief_summary', 'decision_framework', 'json'] as NoteFormat[]).map(fmt => (
              <button
                key={fmt}
                onClick={() => setFilterFormat(fmt)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                  filterFormat === fmt
                    ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {FORMAT_ICONS[fmt]} {FORMAT_LABELS[fmt]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <ApiErrorAlert
          message={error}
          onDismiss={() => setError(null)}
          className="mb-4"
        />
      )}

      {/* Empty state */}
      {notes.length === 0 && !error && (
        <div className="text-center py-16 bg-white dark:bg-dark-surface rounded-lg border border-gray-200 dark:border-dark-border">
          <svg className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">No notes yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-300 mb-4 max-w-md mx-auto">
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

      {/* No results for filter */}
      {notes.length > 0 && filteredNotes.length === 0 && (
        <div className="text-center py-12 bg-white dark:bg-dark-surface rounded-xl border border-gray-200 dark:border-dark-border">
          <div className="text-3xl mb-2">&#128269;</div>
          <p className="text-sm text-gray-500 dark:text-gray-300">
            No notes match your search or filter.
          </p>
          <button
            onClick={() => { setFilterFormat('all'); setSearchQuery(''); }}
            className="mt-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Notes list */}
      {filteredNotes.length > 0 && (
        <div className="space-y-3">
          {/* Results count when filtered */}
          {(filterFormat !== 'all' || searchQuery.trim()) && (
            <p className="text-xs text-gray-500 dark:text-gray-300">
              Showing {filteredNotes.length} of {notes.length} notes
            </p>
          )}

          {filteredNotes.map((note) => (
            <button
              key={note.id}
              onClick={() => handleNoteClick(note)}
              className="w-full text-left p-4 bg-white dark:bg-dark-surface rounded-lg border border-gray-200 dark:border-dark-border hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors truncate">
                    {note.title || 'Untitled Note'}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {/* Format badge */}
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${FORMAT_COLORS[note.selectedFormat] || FORMAT_COLORS.full_analysis}`}>
                      {FORMAT_ICONS[note.selectedFormat] || ''}
                      {FORMAT_LABELS[note.selectedFormat] || 'Full Analysis'}
                    </span>
                    {/* Topic */}
                    <span className="text-xs text-gray-500 dark:text-gray-300 flex items-center gap-1 truncate max-w-[200px]">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      {note.topicTitle}
                    </span>
                    {/* Date */}
                    <span className="text-xs text-gray-500 dark:text-gray-300">
                      {formatRelativeTime(note.createdAt)}
                    </span>
                  </div>
                  {/* Content preview */}
                  <p className="text-sm text-gray-500 dark:text-gray-300 mt-2 line-clamp-2">
                    {getContentPreview(note)}
                  </p>
                </div>
                <svg className="w-4 h-4 text-gray-500 dark:text-gray-300 group-hover:text-primary-500 transition-colors shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
