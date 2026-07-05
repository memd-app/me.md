import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import Modal from '@/components/common/Modal';
import { Badge, Button, EmptyState, SectionHeading } from '@/components/ui';
import { formatDateTime, formatShortDate } from '@/utils/dateFormat';
import { getTopic, updateTopic, deleteTopic } from '@/services/topics';
import { createSession, getSessionsByTopic } from '@/services/sessions';

interface Topic {
  id: string;
  title: string;
  description: string | null;
  tags: string | null;
  status: string;
  priority: string;
  intent: string | null;
  trigger: string | null;
  referenceUrls: string | null;
  contextItems: string | null;
  createdAt: string;
  updatedAt: string;
}

const INTENT_OPTIONS = [
  { value: 'articulate', label: 'Articulate', description: 'Express something you already know' },
  { value: 'explore', label: 'Explore', description: 'Discover something new about yourself' },
  { value: 'decide', label: 'Decide', description: 'Work through a decision or choice' },
  { value: 'document', label: 'Document', description: 'Record knowledge for future reference' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

interface Session {
  id: string;
  topicId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface Insight {
  id: string;
  content: string;
  confidenceScore: number;
  verificationStatus: string;
  topicId: string;
  createdAt: string;
}

interface ConnectedTopic {
  id: string;
  title: string;
  status: string;
  connectionType: string;
  relevanceScore: number;
}

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
  const { user } = useUser();
  const db = useDatabase();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [topicInsights, setTopicInsights] = useState<Insight[]>([]);
  const [connectedTopics, setConnectedTopics] = useState<ConnectedTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topicNotFound, setTopicNotFound] = useState(false);
  const [fetchVersion, setFetchVersion] = useState(0);
  const [newUrl, setNewUrl] = useState('');
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState('');
  const [editIntent, setEditIntent] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!user || !id) return;
    const controller = new AbortController();

    const fetchTopic = async () => {
      setIsLoading(true);
      setError(null);
      setTopicNotFound(false);
      try {
        // Fetch topic details
        const topicData = getTopic(db, id!);
        if (!topicData) {
          setTopicNotFound(true);
          setTopic(null);
          throw new Error('This topic has been deleted or does not exist.');
        }
        setTopic(topicData as Topic);
        setTopicInsights((topicData.insights || []) as Insight[]);
        setConnectedTopics((topicData.connectedTopics || []).filter(Boolean) as ConnectedTopic[]);

        // Fetch sessions for this topic
        const sessionsData = getSessionsByTopic(db, id!);
        setSessions(sessionsData || []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load topic');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    fetchTopic();
    return () => controller.abort();
  }, [user, id, fetchVersion]);

  const handleStartSession = async () => {
    if (!user || !topic) return;

    setIsStartingSession(true);
    setError(null);
    try {
      const data = await createSession(db, topic.id);
      navigate(`/app/sessions/${data.session.id}`);
    } catch (err) {
      if (!topicNotFound) {
        setError(err instanceof Error ? err.message : 'Failed to start session');
      }
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleDeleteTopic = async () => {
    if (!user || !topic) return;

    setIsDeleting(true);
    setError(null);
    try {
      deleteTopic(db, topic.id);
      navigate('/app/topics', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete topic');
      setShowDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
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

  const parseReferenceUrls = (urlsStr: string | null): string[] => {
    if (!urlsStr) return [];
    try {
      return JSON.parse(urlsStr);
    } catch {
      return [];
    }
  };

  const isValidUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const handleAddUrl = async () => {
    if (!user || !topic) return;

    const trimmedUrl = newUrl.trim();
    if (!trimmedUrl) {
      setUrlError('Please enter a URL');
      return;
    }

    if (!isValidUrl(trimmedUrl)) {
      setUrlError('Please enter a valid URL (starting with http:// or https://)');
      return;
    }

    const currentUrls = parseReferenceUrls(topic.referenceUrls);
    if (currentUrls.includes(trimmedUrl)) {
      setUrlError('This URL has already been added');
      return;
    }

    setIsAddingUrl(true);
    setUrlError(null);
    try {
      const updatedUrls = [...currentUrls, trimmedUrl];
      const data = updateTopic(db, topic.id, { referenceUrls: updatedUrls });
      setTopic(data as Topic);
      setNewUrl('');
    } catch (err) {
      if (!topicNotFound) {
        setUrlError(err instanceof Error ? err.message : 'Failed to add URL');
      }
    } finally {
      setIsAddingUrl(false);
    }
  };

  const handleRemoveUrl = async (urlToRemove: string) => {
    if (!user || !topic) return;

    const currentUrls = parseReferenceUrls(topic.referenceUrls);
    const updatedUrls = currentUrls.filter(url => url !== urlToRemove);

    try {
      const data = updateTopic(db, topic.id, { referenceUrls: updatedUrls });
      setTopic(data as Topic);
    } catch (err) {
      if (!topicNotFound) {
        setError(err instanceof Error ? err.message : 'Failed to remove URL');
      }
    }
  };

  const startEditing = () => {
    if (!topic) return;
    setEditTitle(topic.title);
    setEditDescription(topic.description || '');
    setEditPriority(topic.priority || 'medium');
    setEditIntent(topic.intent || '');
    setEditTags(parseTags(topic.tags));
    setEditTagInput('');
    setIsEditing(true);
    setSaveSuccess(false);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditTagInput('');
    setSaveSuccess(false);
  };

  const handleEditAddTag = () => {
    const trimmed = editTagInput.trim().toLowerCase();
    if (trimmed && !editTags.includes(trimmed)) {
      setEditTags([...editTags, trimmed]);
      setEditTagInput('');
    }
  };

  const handleEditTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEditAddTag();
    } else if (e.key === ',' || e.key === 'Tab') {
      e.preventDefault();
      handleEditAddTag();
    }
  };

  const handleEditRemoveTag = (tagToRemove: string) => {
    setEditTags(editTags.filter((t) => t !== tagToRemove));
  };

  const handleSaveEdit = async () => {
    if (!user || !topic) return;
    if (!editTitle.trim()) {
      setError('Title is required');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const data = updateTopic(db, topic.id, {
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          priority: editPriority,
          intent: editIntent || null,
          tags: editTags.length > 0 ? editTags : null,
        });
      setTopic(data as Topic);
      setIsEditing(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      if (!topicNotFound) {
        setError(err instanceof Error ? err.message : 'Failed to update topic');
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <LoadingSpinner card message="Loading topic..." />
      </div>
    );
  }

  if (topicNotFound || (error && !topic)) {
    return (
      <div className="max-w-2xl mx-auto pt-12">
        <EmptyState
          kicker="Topic not found"
          message={error || 'This topic has been deleted or does not exist.'}
          action={
            <Link to="/app/topics" className="btn-primary inline-block">
              Back to topics
            </Link>
          }
        />
      </div>
    );
  }

  if (!topic) return null;

  const tags = parseTags(topic.tags);
  const referenceUrls = parseReferenceUrls(topic.referenceUrls);
  const activeSessions = sessions.filter(s => s.status === 'active');
  const pausedSessions = sessions.filter(s => s.status === 'paused');
  const completedSessions = sessions.filter(s => s.status === 'completed');
  // Flattened for the hairline-row list — same grouping precedence as before,
  // just without subheadings (each row carries its own status word instead).
  const orderedSessions = [...activeSessions, ...pausedSessions, ...completedSessions];
  const resumableSession = activeSessions[0] || pausedSessions[0] || null;
  const pendingInsights = topicInsights.filter(
    (i) => i.verificationStatus !== 'verified' && i.verificationStatus !== 'rejected'
  );

  return (
    <div className="max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs tracking-wide text-gray-400 dark:text-gray-600 mb-6 min-w-0">
        <Link to="/app/topics" className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors shrink-0">
          Topics
        </Link>
        <span aria-hidden="true" className="shrink-0">/</span>
        <span className="text-gray-600 dark:text-gray-400 truncate">{topic.title}</span>
      </nav>

      {/* Error banner */}
      {error && (
        <ApiErrorAlert
          message={error}
          onRetry={() => { setError(null); setFetchVersion(v => v + 1); }}
          onDismiss={() => setError(null)}
          className="mb-6"
        />
      )}

      {/* Save success message — quiet typographic confirmation, no colored box */}
      {saveSuccess && (
        <p role="status" className="mb-6 text-sm font-semibold text-primary-600 dark:text-primary-400">
          Topic updated.
        </p>
      )}

      {/* ===== MASTHEAD ===== */}
      <div className="pb-6 mb-8 border-b border-rule dark:border-dark-border">
        {isEditing ? (
          /* ===== EDIT MODE ===== */
          <div className="space-y-5 max-w-2xl">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] tracking-[0.14em] uppercase font-sans font-bold text-gray-500 dark:text-gray-400">
                Edit topic
              </span>
              <button
                onClick={cancelEditing}
                className="text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 transition-colors"
              >
                Cancel
              </button>
            </div>

            {/* Edit Title */}
            <div>
              <label htmlFor="edit-title" className="block text-[11px] tracking-[0.08em] uppercase font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                Title <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <input
                id="edit-title"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="input-field font-serif text-lg"
                placeholder="Topic title"
              />
            </div>

            {/* Edit Description */}
            <div>
              <label htmlFor="edit-description" className="block text-[11px] tracking-[0.08em] uppercase font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                Description
              </label>
              <textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="input-field font-serif min-h-[100px] resize-y"
                placeholder="What do you want to explore about this topic?"
                rows={3}
              />
            </div>

            {/* Edit Priority */}
            <div>
              <span className="block text-[11px] tracking-[0.08em] uppercase font-sans font-semibold text-gray-500 dark:text-gray-400 mb-2">
                Priority
              </span>
              <div className="flex gap-2">
                {PRIORITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setEditPriority(option.value)}
                    className={`px-3.5 py-1.5 rounded-sm border text-xs font-semibold uppercase tracking-wide transition-colors ${
                      editPriority === option.value
                        ? 'border-primary-500 dark:border-primary-400 text-primary-600 dark:text-primary-400'
                        : 'border-rule dark:border-dark-border text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-600'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Edit Intent */}
            <div>
              <span className="block text-[11px] tracking-[0.08em] uppercase font-sans font-semibold text-gray-500 dark:text-gray-400 mb-2">
                Intent
              </span>
              <div className="grid grid-cols-2 gap-2">
                {INTENT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setEditIntent(editIntent === option.value ? '' : option.value)}
                    className={`p-3 rounded-sm border text-left transition-colors ${
                      editIntent === option.value
                        ? 'border-primary-500 dark:border-primary-400'
                        : 'border-rule dark:border-dark-border hover:border-gray-400 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className={`text-xs font-semibold uppercase tracking-wide ${
                      editIntent === option.value
                        ? 'text-primary-600 dark:text-primary-400'
                        : 'text-gray-900 dark:text-white'
                    }`}>
                      {option.label}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {option.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Edit Tags */}
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                Tags
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {editTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold lowercase tracking-wide text-gray-600 dark:text-gray-400 border border-rule dark:border-dark-border rounded-sm px-2.5 py-1"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleEditRemoveTag(tag)}
                      className="text-gray-400 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400"
                      aria-label={`Remove tag ${tag}`}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editTagInput}
                  onChange={(e) => setEditTagInput(e.target.value)}
                  onKeyDown={handleEditTagKeyDown}
                  className="input-field flex-1"
                  placeholder="Type a tag and press Enter"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleEditAddTag}
                  disabled={!editTagInput.trim()}
                >
                  Add
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                Press Enter or comma to add a tag
              </p>
            </div>

            {/* Save / Cancel buttons */}
            <div className="flex gap-3 pt-2">
              <Button onClick={handleSaveEdit} loading={isSaving} disabled={isSaving || !editTitle.trim()}>
                {isSaving ? 'Saving…' : 'Save changes'}
              </Button>
              <Button variant="secondary" onClick={cancelEditing} disabled={isSaving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          /* ===== VIEW MODE ===== */
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 max-w-2xl">
              <h1 className="font-serif italic font-medium text-3xl sm:text-4xl md:text-[42px] leading-[1.08] tracking-tight text-gray-900 dark:text-white mb-3 break-words">
                {topic.title}
              </h1>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tracking-[0.1em] uppercase font-sans font-semibold text-gray-500 dark:text-gray-400 mb-4">
                {topic.intent && (
                  <>
                    <span>{INTENT_LABELS[topic.intent] || topic.intent}</span>
                    <span aria-hidden="true" className="font-normal text-gray-300 dark:text-gray-700">&middot;</span>
                  </>
                )}
                <span className={topic.priority === 'high' ? 'text-primary-600 dark:text-primary-400' : ''}>
                  {(PRIORITY_LABELS[topic.priority] || topic.priority) || 'Medium'} priority
                </span>
                <span aria-hidden="true" className="font-normal text-gray-300 dark:text-gray-700">&middot;</span>
                <span>Created {formatShortDate(topic.createdAt)}</span>
                <span aria-hidden="true" className="font-normal text-gray-300 dark:text-gray-700">&middot;</span>
                <span>{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
                <span aria-hidden="true" className="font-normal text-gray-300 dark:text-gray-700">&middot;</span>
                <span>{topicInsights.length} insight{topicInsights.length === 1 ? '' : 's'}</span>
              </div>

              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[11.5px] font-semibold lowercase tracking-wide text-gray-500 dark:text-gray-400 border border-rule dark:border-dark-border rounded-sm px-2.5 py-1 hover:border-primary-400 hover:text-primary-600 dark:hover:border-primary-500 dark:hover:text-primary-400 transition-colors"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col items-end gap-3 shrink-0">
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={startEditing}>
                  Edit
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleStartSession}
                  loading={isStartingSession}
                >
                  {isStartingSession ? 'Starting…' : resumableSession ? 'Continue interview' : 'Start interview'}
                </Button>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-xs font-medium text-gray-400 hover:text-red-600 dark:text-gray-600 dark:hover:text-red-400 transition-colors"
              >
                Delete topic
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Description */}
      {!isEditing && topic.description && (
        <p className="font-serif text-lg leading-relaxed text-gray-700 dark:text-gray-300 max-w-2xl mb-12 break-words">
          {topic.description}
        </p>
      )}

      {/* Delete Confirmation Dialog */}
      <Modal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete Topic"
        labelledBy="delete-topic-dialog-title"
        icon={
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <button
              onClick={handleDeleteTopic}
              disabled={isDeleting}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2"
            >
              {isDeleting ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                  Deleting...
                </>
              ) : (
                'Delete Topic'
              )}
            </button>
          </>
        }
      >
        <p className="text-gray-600 dark:text-gray-300 mb-2">
          Are you sure you want to delete <span className="font-semibold text-gray-900 dark:text-white">&quot;{topic.title}&quot;</span>?
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          This will permanently delete this topic and all associated data including:
        </p>
        <ul className="text-sm text-gray-500 dark:text-gray-400 mb-2 list-disc list-inside space-y-1">
          {sessions.length > 0 && <li>{sessions.length} session{sessions.length !== 1 ? 's' : ''} and their messages</li>}
          <li>All notes and distilled content</li>
          <li>All extracted insights</li>
          <li>Knowledge graph connections</li>
        </ul>
      </Modal>

      {/* ===== BODY: main column + right rail ===== */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] xl:gap-14 gap-12">
        {/* MAIN COLUMN */}
        <div className="min-w-0 xl:pr-14 xl:border-r xl:border-rule dark:xl:border-dark-border space-y-12">
          {/* SESSIONS */}
          <section aria-label="Sessions">
            <SectionHeading className="mb-2">Sessions</SectionHeading>

            {sessions.length === 0 ? (
              <EmptyState
                message="No sessions yet — start your first interview session."
                action={
                  <Button variant="primary" size="sm" onClick={handleStartSession} loading={isStartingSession}>
                    Start interview
                  </Button>
                }
                className="py-8"
              />
            ) : (
              <div className="divide-y divide-rule dark:divide-dark-border">
                {orderedSessions.map((session) => {
                  const isActive = session.status === 'active';
                  const isPaused = session.status === 'paused';
                  const statusLabel = isActive ? 'Active' : isPaused ? 'Paused' : 'Completed';
                  const metaLine = isActive
                    ? `Started ${formatDateTime(session.createdAt)}`
                    : isPaused
                    ? `Paused ${formatDateTime(session.updatedAt)}`
                    : formatShortDate(session.completedAt || session.updatedAt);
                  const actionLabel = isActive ? 'Continue session' : isPaused ? 'Resume session' : 'View transcript';

                  return (
                    <Link
                      key={session.id}
                      to={`/app/sessions/${session.id}`}
                      className="group flex items-start justify-between gap-4 py-5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className={`text-[11px] font-bold uppercase tracking-[0.12em] mb-1.5 ${
                          isActive || isPaused ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          {statusLabel}
                        </p>
                        <p className="text-[13px] text-gray-500 dark:text-gray-400">{metaLine}</p>
                      </div>
                      <span className={`shrink-0 pt-0.5 text-[11.5px] font-bold uppercase tracking-wide transition-colors ${
                        isActive || isPaused
                          ? 'text-primary-600 dark:text-primary-400'
                          : 'text-gray-500 dark:text-gray-400 group-hover:text-primary-600 dark:group-hover:text-primary-400'
                      }`}>
                        {actionLabel} &rarr;
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* RELATED INSIGHTS */}
          <section aria-label="Related insights">
            <SectionHeading className="mb-2">Related insights</SectionHeading>

            {topicInsights.length === 0 ? (
              <EmptyState message="No insights extracted yet. Complete a session and distill it to generate insights." className="py-8" />
            ) : (
              <div className="divide-y divide-rule dark:divide-dark-border">
                {topicInsights.map((insight, idx) => {
                  const isVerified = insight.verificationStatus === 'verified';
                  const isRejected = insight.verificationStatus === 'rejected';
                  const variant = isVerified ? 'verified' : isRejected ? 'rejected' : 'pending';

                  return (
                    <div key={insight.id} className="grid grid-cols-[2rem_1fr] gap-4 py-6 first:pt-0 last:pb-0">
                      <span className={`text-xs font-semibold pt-1 ${isVerified ? 'text-primary-300 dark:text-primary-700' : 'text-gray-300 dark:text-gray-700'}`}>
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0">
                        <p className={`font-serif text-lg leading-snug mb-2.5 break-words ${
                          isRejected ? 'text-gray-400 dark:text-gray-600 line-through' : 'text-gray-900 dark:text-white'
                        }`}>
                          {insight.content}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Badge variant={variant} confidence={isVerified ? insight.confidenceScore : undefined} />
                          {variant === 'pending' && (
                            <Link
                              to="/app/review"
                              className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 border-b border-gray-400 dark:border-gray-600 hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-600 dark:hover:border-primary-400 transition-colors pb-px"
                            >
                              Review &rarr;
                            </Link>
                          )}
                          <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">&middot;</span>
                          <span className="text-[11px] text-gray-400 dark:text-gray-600">{formatShortDate(insight.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT RAIL */}
        <div className="flex flex-col gap-10">
          {/* In the graph */}
          <section aria-label="In the graph">
            <SectionHeading className="mb-4">In the graph</SectionHeading>
            {connectedTopics.length === 0 ? (
              <EmptyState
                message="No connections yet — shared tags and distilled sessions will surface some."
                className="py-4"
              />
            ) : (
              <nav aria-label="Connected topics" className="flex flex-col divide-y divide-rule dark:divide-dark-border">
                {connectedTopics.map((ct) => (
                  <Link
                    key={ct.id}
                    to={`/app/topics/${ct.id}`}
                    className="group flex items-center justify-between gap-3 py-3 text-[13.5px] font-semibold text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                  >
                    <span className="truncate min-w-0">{ct.title}</span>
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-gray-400 dark:text-gray-600 group-hover:text-primary-600 dark:group-hover:text-primary-400 group-hover:translate-x-0.5 transition-transform"
                    >
                      &rarr;
                    </span>
                  </Link>
                ))}
              </nav>
            )}
          </section>

          {/* Reference URLs */}
          <section aria-label="Reference URLs">
            <SectionHeading className="mb-4">Reference URLs</SectionHeading>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Context the AI can draw on during interview sessions.
            </p>

            <div className="mb-4">
              <input
                type="url"
                value={newUrl}
                onChange={(e) => {
                  setNewUrl(e.target.value);
                  setUrlError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddUrl();
                  }
                }}
                placeholder="https://example.com/article"
                className="input-field text-sm mb-2"
                disabled={isAddingUrl}
              />
              {urlError && (
                <p className="text-xs text-red-500 dark:text-red-400 mb-2">{urlError}</p>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAddUrl}
                loading={isAddingUrl}
                disabled={isAddingUrl || !newUrl.trim()}
                className="w-full"
              >
                Add URL
              </Button>
            </div>

            {referenceUrls.length === 0 ? (
              <EmptyState message="No reference URLs added yet." className="py-4" />
            ) : (
              <ul className="flex flex-col divide-y divide-rule dark:divide-dark-border">
                {referenceUrls.map((url, index) => (
                  <li key={`${url}-${index}`} className="group flex items-center gap-2 py-2.5">
                    <a
                      href={/^https?:\/\//i.test(url) ? url : '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-0 truncate text-sm text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                      title={url}
                    >
                      {url}
                    </a>
                    <button
                      onClick={() => handleRemoveUrl(url)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 shrink-0"
                      title="Remove URL"
                      aria-label={`Remove ${url}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Review queue note */}
          {pendingInsights.length > 0 && (
            <section aria-label="Review queue">
              <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-300 mb-2">
                <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-primary-500 dark:bg-primary-400 mr-2 align-middle" />
                {pendingInsights.length} insight{pendingInsights.length === 1 ? '' : 's'} awaiting review on this topic.
              </p>
              <Link
                to="/app/review"
                className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                Review queue <span aria-hidden="true">&rarr;</span>
              </Link>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
