import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import PageTabs from '@/components/ui/PageTabs';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { Badge, EmptyState, PageHeader, SimpleMarkdown } from '@/components/ui';
import { formatRelativeTime, formatDateTime } from '@/utils/dateFormat';
import { getNotes, getNote } from '@/services/notes';

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

const ACTIVE_FORMAT_OPTIONS: NoteFormat[] = ['full_analysis', 'json'];
const LEGACY_FORMAT_OPTIONS: NoteFormat[] = ['brief_summary', 'decision_framework'];

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
      return note.contentBriefSummary || 'No brief summary was generated for this session (legacy format).';
    case 'decision_framework':
      return note.contentDecisionFramework || 'No decision framework was generated for this session (legacy format).';
    case 'json':
      return note.contentJson || '{}';
    default:
      return note.contentFullAnalysis || '';
  }
}

function hasContentForFormat(note: NoteListItem, format: NoteFormat): boolean {
  switch (format) {
    case 'full_analysis':
      return !!note.contentFullAnalysis?.trim();
    case 'brief_summary':
      return !!note.contentBriefSummary?.trim();
    case 'decision_framework':
      return !!note.contentDecisionFramework?.trim();
    case 'json':
      return !!note.contentJson?.trim();
    default:
      return false;
  }
}

function getAvailableFormats(note: NoteListItem): NoteFormat[] {
  return [
    ...ACTIVE_FORMAT_OPTIONS,
    ...LEGACY_FORMAT_OPTIONS.filter(format => hasContentForFormat(note, format)),
  ];
}

function getInitialFormat(note: NoteListItem): NoteFormat {
  const selected = (note.selectedFormat || 'full_analysis') as NoteFormat;
  return getAvailableFormats(note).includes(selected) ? selected : 'full_analysis';
}

export default function NotesPage() {
  const { user } = useUser();
  const db = useDatabase();
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
        const data = getNotes(db);
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
      const data = getNote(db, noteId);
      const note = data.note;
      // Find the enriched note from our list to get topicTitle
      const enrichedNote = notes.find(n => n.id === noteId);
      const fullNote = {
        ...note,
        topicTitle: enrichedNote?.topicTitle || note.topicTitle || 'Unknown Topic',
      };
      setSelectedNote(fullNote);
      setNoteInsights(data.insights || []);
      setSelectedFormat(getInitialFormat(fullNote));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load note detail');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleNoteClick = (note: NoteListItem) => {
    // Use the note from the list directly (already has all content fields)
    setSelectedNote(note);
    setSelectedFormat(getInitialFormat(note));
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

  const clearFilters = () => {
    setFilterFormat('all');
    setSearchQuery('');
  };

  // =====================
  // DETAIL VIEW
  // =====================
  if (selectedNote) {
    const content = getNoteContent(selectedNote, selectedFormat);
    return (
      <div className="max-w-4xl mx-auto">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs tracking-wide text-gray-400 dark:text-gray-600 mb-6 min-w-0">
          <button
            onClick={handleBackToList}
            className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors shrink-0"
          >
            Notes
          </button>
          <span aria-hidden="true" className="shrink-0">/</span>
          <span className="text-gray-600 dark:text-gray-400 truncate">{selectedNote.title || 'Untitled Note'}</span>
        </nav>

        {/* ===== MASTHEAD ===== */}
        <div className="mb-8">
          <div className="flex flex-wrap items-start justify-between gap-6 pb-6">
            <div className="min-w-0 max-w-2xl">
              <h1 className="font-serif italic font-medium text-3xl sm:text-4xl leading-[1.08] tracking-tight text-gray-900 dark:text-white mb-3 break-words">
                {selectedNote.title || 'Untitled Note'}
              </h1>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tracking-[0.1em] uppercase font-sans font-semibold text-gray-500 dark:text-gray-400">
                <Link
                  to={`/app/topics/${selectedNote.topicId}`}
                  className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                >
                  {selectedNote.topicTitle || 'Unknown Topic'}
                </Link>
                <span aria-hidden="true" className="font-normal normal-case text-gray-300 dark:text-gray-700">&middot;</span>
                <span className="font-normal normal-case tracking-normal">{formatDateTime(selectedNote.createdAt)}</span>
              </div>
            </div>
            <button
              onClick={handleBackToList}
              className="shrink-0 p-1.5 rounded-sm text-gray-400 hover:text-primary-600 dark:text-gray-600 dark:hover:text-primary-400 transition-colors"
              title="Back to notes list"
              aria-label="Back to notes list"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Format tabs — small-caps, amber underline on the active format */}
          <nav className="flex items-center gap-6 border-b border-rule dark:border-dark-border" aria-label="Note format">
            {getAvailableFormats(selectedNote).map(fmt => (
              <button
                key={fmt}
                onClick={() => setSelectedFormat(fmt)}
                className={`-mb-px pb-2 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold border-b-2 transition-colors ${
                  selectedFormat === fmt
                    ? 'text-primary-600 dark:text-primary-400 border-primary-500 dark:border-primary-400'
                    : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-ink dark:hover:text-gray-100'
                }`}
              >
                {FORMAT_LABELS[fmt]}
              </button>
            ))}
          </nav>
        </div>

        {/* Note content — the serif reading surface */}
        <div className="mb-10">
          {isLoadingDetail ? (
            <div className="flex items-center justify-center py-16">
              <LoadingSpinner message="Loading note..." />
            </div>
          ) : selectedFormat === 'json' ? (
            <pre className="font-mono text-[13px] leading-relaxed text-gray-700 dark:text-gray-300 bg-panel dark:bg-dark-card rounded-sm p-4 overflow-x-auto whitespace-pre-wrap">
              {content}
            </pre>
          ) : (
            <SimpleMarkdown content={content} />
          )}
        </div>

        {/* Insights section */}
        {noteInsights.length > 0 && (
          <section aria-label="Extracted insights" className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="uppercase text-[11px] tracking-[0.08em] font-medium font-sans text-gray-500 dark:text-gray-400 whitespace-nowrap">
                Extracted insights ({noteInsights.length})
              </span>
              <span className="flex-1 border-t border-rule dark:border-dark-border" aria-hidden="true" />
            </div>
            <div className="divide-y divide-rule dark:divide-dark-border">
              {noteInsights.map((insight, idx) => {
                const isVerified = insight.verificationStatus === 'verified';
                const isRejected = insight.verificationStatus === 'rejected';
                const variant = isVerified ? 'verified' : isRejected ? 'rejected' : 'pending';
                return (
                  <div key={insight.id} className="grid grid-cols-[2rem_1fr] gap-4 py-5 first:pt-0 last:pb-0">
                    <span className={`text-xs font-semibold pt-1 ${isVerified ? 'text-primary-300 dark:text-primary-700' : 'text-gray-300 dark:text-gray-700'}`}>
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      <p className={`font-serif text-base leading-snug mb-2 break-words ${
                        isRejected ? 'text-gray-400 dark:text-gray-600 line-through' : 'text-gray-900 dark:text-white'
                      }`}>
                        {insight.content}
                      </p>
                      <Badge variant={variant} confidence={isVerified ? insight.confidenceScore : undefined} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Link to session */}
        <div className="flex justify-center pb-4">
          <Link
            to={`/app/sessions/${selectedNote.sessionId}`}
            className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
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
        <div className="mb-8 pb-6 border-b border-rule dark:border-dark-border">
          <div className="h-9 w-40 bg-panel dark:bg-dark-card rounded-sm animate-pulse" />
          <div className="h-4 w-64 bg-panel dark:bg-dark-card rounded-sm animate-pulse mt-3" />
        </div>
        <div className="divide-y divide-rule dark:divide-dark-border">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="py-5">
              <div className="h-5 w-1/3 bg-panel dark:bg-dark-card rounded-sm animate-pulse mb-2.5" />
              <div className="h-3 w-1/2 bg-panel dark:bg-dark-card rounded-sm animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const hasActiveFilters = filterFormat !== 'all' || searchQuery.trim() !== '';

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Notes"
        subtitle={`${notes.length} note${notes.length !== 1 ? 's' : ''} from distilled sessions`}
      />

      <PageTabs
        tabs={[
          { to: '/app/notes', label: 'Notes', end: true },
          { to: '/app/notes/bookmarks', label: 'Bookmarks' },
        ]}
      />

      {/* Search & Filter toolbar */}
      {notes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule dark:border-dark-border pb-3 mb-6">
          <div className="relative flex-1 min-w-[220px]">
            <svg
              className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-600"
              fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search notes by title or topic…"
              aria-label="Search notes by title or topic"
              className="w-full bg-transparent border-0 pl-7 pr-8 py-1.5 text-sm text-ink dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-0"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary-600 dark:text-gray-600 dark:hover:text-primary-400"
                title="Clear search"
                aria-label="Clear search"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <span className="hidden sm:block w-px h-5 bg-rule dark:bg-dark-border" aria-hidden="true" />

          <label className="relative inline-flex items-center gap-1.5 cursor-pointer shrink-0">
            <span className="text-[10px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-400 dark:text-gray-600">
              Format
            </span>
            <select
              value={filterFormat}
              onChange={(e) => setFilterFormat(e.target.value)}
              className={`appearance-none bg-transparent border-0 pl-0 pr-5 py-1 text-sm font-medium cursor-pointer focus:outline-none focus:ring-0 ${
                filterFormat !== 'all' ? 'text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              <option value="all">All</option>
              {ACTIVE_FORMAT_OPTIONS.map(fmt => (
                <option key={fmt} value={fmt}>{FORMAT_LABELS[fmt]}</option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 dark:text-gray-600"
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </label>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-[10px] tracking-[0.08em] uppercase font-sans font-semibold text-gray-400 dark:text-gray-600 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <ApiErrorAlert
          message={error}
          onDismiss={() => setError(null)}
          className="mb-6"
        />
      )}

      {/* Empty state */}
      {notes.length === 0 && !error && (
        <EmptyState
          kicker="No notes yet"
          message="Notes are created when you finish and distill a session. Start a session to begin building your knowledge base."
          action={
            <Link to="/app/topics" className="btn-primary inline-block">
              Start a session
            </Link>
          }
        />
      )}

      {/* No results for filter */}
      {notes.length > 0 && filteredNotes.length === 0 && (
        <EmptyState
          kicker="No matching notes"
          message="No notes match your search or filter."
          action={
            <button onClick={clearFilters} className="btn-secondary">
              Clear filters
            </button>
          }
        />
      )}

      {/* Notes list — hairline rows */}
      {filteredNotes.length > 0 && (
        <div>
          {hasActiveFilters && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Showing {filteredNotes.length} of {notes.length} notes
            </p>
          )}

          <div className="divide-y divide-rule dark:divide-dark-border">
            {filteredNotes.map((note) => (
              <button
                key={note.id}
                onClick={() => handleNoteClick(note)}
                className="group w-full text-left flex items-start justify-between gap-6 py-5 -mx-2 px-2 rounded-sm hover:bg-panel/60 dark:hover:bg-dark-surface/60 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="font-serif text-lg text-gray-900 dark:text-white truncate mb-1.5 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                    {note.title || 'Untitled Note'}
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tracking-[0.08em] uppercase font-sans font-semibold text-gray-500 dark:text-gray-400 mb-2">
                    <span>{FORMAT_LABELS[note.selectedFormat] || 'Full Analysis'}</span>
                    <span aria-hidden="true" className="text-gray-300 dark:text-gray-700 normal-case font-normal">&middot;</span>
                    <span className="normal-case tracking-normal font-normal truncate max-w-[220px]">{note.topicTitle}</span>
                    <span aria-hidden="true" className="text-gray-300 dark:text-gray-700 normal-case font-normal">&middot;</span>
                    <span className="normal-case tracking-normal font-normal">{formatRelativeTime(note.createdAt)}</span>
                  </div>
                  <p className="font-serif text-sm text-gray-600 dark:text-gray-300 line-clamp-2 max-w-2xl">
                    {getContentPreview(note)}
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className="shrink-0 pt-1 text-gray-400 dark:text-gray-600 group-hover:text-primary-600 dark:group-hover:text-primary-400 group-hover:translate-x-0.5 transition-transform"
                >
                  &rarr;
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
