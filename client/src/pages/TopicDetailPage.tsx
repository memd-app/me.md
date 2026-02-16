import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import VerifiedBadge from '@/components/VerifiedBadge';

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
  const [topicInsights, setTopicInsights] = useState<Insight[]>([]);
  const [connectedTopics, setConnectedTopics] = useState<ConnectedTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        setTopicInsights(topicData.insights || []);
        setConnectedTopics(topicData.connectedTopics || []);

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

  const handleDeleteTopic = async () => {
    if (!user || !topic) return;

    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/topics/${topic.id}`, {
        method: 'DELETE',
        headers: { 'x-user-id': user.id },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete topic');
      }

      // Navigate back to topics list after successful deletion
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
      const res = await fetch(`/api/topics/${topic.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ referenceUrls: updatedUrls }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add URL');
      }

      const data = await res.json();
      setTopic(data.topic);
      setNewUrl('');
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Failed to add URL');
    } finally {
      setIsAddingUrl(false);
    }
  };

  const handleRemoveUrl = async (urlToRemove: string) => {
    if (!user || !topic) return;

    const currentUrls = parseReferenceUrls(topic.referenceUrls);
    const updatedUrls = currentUrls.filter(url => url !== urlToRemove);

    try {
      const res = await fetch(`/api/topics/${topic.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ referenceUrls: updatedUrls }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove URL');
      }

      const data = await res.json();
      setTopic(data.topic);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove URL');
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
      const res = await fetch(`/api/topics/${topic.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          priority: editPriority,
          intent: editIntent || null,
          tags: editTags.length > 0 ? editTags : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update topic');
      }

      const data = await res.json();
      setTopic(data.topic);
      setIsEditing(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update topic');
    } finally {
      setIsSaving(false);
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
  const referenceUrls = parseReferenceUrls(topic.referenceUrls);
  const activeSessions = sessions.filter(s => s.status === 'active');
  const pausedSessions = sessions.filter(s => s.status === 'paused');
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

      {/* Save success message */}
      {saveSuccess && (
        <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 mb-6 flex items-center gap-2">
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Topic updated successfully
        </div>
      )}

      {/* Topic header */}
      <div className="card mb-6">
        {isEditing ? (
          /* ===== EDIT MODE ===== */
          <div className="space-y-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Edit Topic</h2>
              <button
                onClick={cancelEditing}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Cancel
              </button>
            </div>

            {/* Edit Title */}
            <div>
              <label htmlFor="edit-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-title"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="input-field"
                placeholder="Topic title"
              />
            </div>

            {/* Edit Description */}
            <div>
              <label htmlFor="edit-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
              </label>
              <textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="input-field min-h-[100px] resize-y"
                placeholder="What do you want to explore about this topic?"
                rows={3}
              />
            </div>

            {/* Edit Priority */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Priority
              </label>
              <div className="flex gap-3">
                {PRIORITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setEditPriority(option.value)}
                    className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      editPriority === option.value
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-400 text-primary-700 dark:text-primary-300'
                        : 'border-gray-200 dark:border-dark-border hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Edit Intent */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Intent
              </label>
              <div className="grid grid-cols-2 gap-3">
                {INTENT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setEditIntent(editIntent === option.value ? '' : option.value)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      editIntent === option.value
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-400'
                        : 'border-gray-200 dark:border-dark-border hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className={`text-sm font-medium ${
                      editIntent === option.value
                        ? 'text-primary-700 dark:text-primary-300'
                        : 'text-gray-900 dark:text-white'
                    }`}>
                      {option.label}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {option.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Edit Tags */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Tags
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {editTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleEditRemoveTag(tag)}
                      className="ml-0.5 text-primary-500 hover:text-primary-700 dark:hover:text-primary-200"
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
                <button
                  type="button"
                  onClick={handleEditAddTag}
                  className="btn-secondary"
                  disabled={!editTagInput.trim()}
                >
                  Add
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Press Enter or comma to add a tag
              </p>
            </div>

            {/* Save / Cancel buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSaveEdit}
                disabled={isSaving || !editTitle.trim()}
                className="btn-primary flex items-center gap-2"
              >
                {isSaving ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
              <button
                onClick={cancelEditing}
                disabled={isSaving}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          /* ===== VIEW MODE ===== */
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

            {/* Edit and Delete buttons */}
            <div className="flex items-center gap-2 ml-4 shrink-0">
              <button
                onClick={startEditing}
                className="p-2 text-gray-400 hover:text-primary-500 dark:text-gray-500 dark:hover:text-primary-400 transition-colors"
                title="Edit topic"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-2 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
                title="Delete topic"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-labelledby="delete-topic-dialog-title">
          <div className="bg-white dark:bg-dark-card rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 id="delete-topic-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                Delete Topic
              </h3>
            </div>

            <p className="text-gray-600 dark:text-gray-400 mb-2">
              Are you sure you want to delete <span className="font-semibold text-gray-900 dark:text-white">&quot;{topic.title}&quot;</span>?
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
              This will permanently delete this topic and all associated data including:
            </p>
            <ul className="text-sm text-gray-500 dark:text-gray-500 mb-6 list-disc list-inside space-y-1">
              {sessions.length > 0 && <li>{sessions.length} session{sessions.length !== 1 ? 's' : ''} and their messages</li>}
              <li>All notes and distilled content</li>
              <li>All extracted insights</li>
              <li>Knowledge graph connections</li>
            </ul>

            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
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
            </div>
          </div>
        </div>
      )}

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

      {/* Reference URLs */}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Reference URLs
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Add reference URLs as context for this topic. These will be used by the AI during interview sessions.
        </p>

        {/* Add URL form */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1">
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
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              disabled={isAddingUrl}
            />
            {urlError && (
              <p className="mt-1 text-xs text-red-500 dark:text-red-400">{urlError}</p>
            )}
          </div>
          <button
            onClick={handleAddUrl}
            disabled={isAddingUrl || !newUrl.trim()}
            className="btn-primary flex items-center gap-1.5 shrink-0 text-sm px-4"
          >
            {isAddingUrl ? (
              <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            )}
            Add URL
          </button>
        </div>

        {/* URL list */}
        {referenceUrls.length === 0 ? (
          <div className="text-center py-6 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <svg className="w-8 h-8 mx-auto text-gray-400 dark:text-gray-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No reference URLs added yet. Add URLs to provide context for AI interviews.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {referenceUrls.map((url, index) => (
              <div
                key={`${url}-${index}`}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 group"
              >
                <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-sm text-primary-600 dark:text-primary-400 hover:underline truncate"
                  title={url}
                >
                  {url}
                </a>
                <button
                  onClick={() => handleRemoveUrl(url)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 shrink-0"
                  title="Remove URL"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Session history */}
      <div className="card mb-6">
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

            {pausedSessions.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  Paused Sessions
                </h3>
                {pausedSessions.map((session) => (
                  <Link
                    key={session.id}
                    to={`/app/session/${session.id}`}
                    className="block p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors mb-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        <span className="font-medium text-gray-900 dark:text-white">
                          Paused Session
                        </span>
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          — Click to resume
                        </span>
                      </div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Paused {new Date(session.updatedAt).toLocaleString()}
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

      {/* Related Insights */}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Related Insights
          {topicInsights.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
              ({topicInsights.length})
            </span>
          )}
        </h2>

        {topicInsights.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <svg className="w-8 h-8 mx-auto text-gray-400 dark:text-gray-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No insights extracted yet. Complete a session and distill it to generate insights.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {topicInsights.map((insight) => {
              const isVerified = insight.verificationStatus === 'verified';
              const isRejected = insight.verificationStatus === 'rejected';

              return (
                <div
                  key={insight.id}
                  className={`p-4 rounded-lg border ${
                    isVerified
                      ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10'
                      : isRejected
                      ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 opacity-60'
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className={`text-sm ${isRejected ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-800 dark:text-gray-200'}`}>
                      {insight.content}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Confidence badge */}
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        insight.confidenceScore >= 80
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : insight.confidenceScore >= 50
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      }`}>
                        {insight.confidenceScore}%
                      </span>
                      {/* Status badge */}
                      <VerifiedBadge status={insight.verificationStatus} />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                    {new Date(insight.createdAt).toLocaleDateString()}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Connected Topics */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Connected Topics
          {connectedTopics.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
              ({connectedTopics.length})
            </span>
          )}
        </h2>

        {connectedTopics.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <svg className="w-8 h-8 mx-auto text-gray-400 dark:text-gray-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No connections yet. Connections are created through shared tags and multi-bucket distillation.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {connectedTopics.map((ct) => (
              <Link
                key={ct.id}
                to={`/app/topics/${ct.id}`}
                className="block p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-primary-500 dark:text-primary-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <div>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {ct.title}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ct.status] || STATUS_COLORS.backlog}`}>
                          {STATUS_LABELS[ct.status] || ct.status}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {ct.connectionType === 'multi_bucket' ? 'Multi-bucket link' : ct.connectionType === 'tag_shared' ? 'Shared tags' : ct.connectionType === 'ai_detected' ? 'AI detected' : ct.connectionType}
                        </span>
                        {ct.relevanceScore > 0 && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {ct.relevanceScore}% relevant
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
