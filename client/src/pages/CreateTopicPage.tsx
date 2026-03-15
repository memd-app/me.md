import { useState, useMemo, useEffect, useRef, useCallback, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useToast } from '@/contexts/ToastContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { checkTopicTitle } from '@/services/topics';

const INTENT_OPTIONS = [
  { value: 'articulate', label: 'Articulate', description: 'Express something you already know' },
  { value: 'explore', label: 'Explore', description: 'Discover something new about yourself' },
  { value: 'decide', label: 'Decide', description: 'Work through a decision or choice' },
  { value: 'document', label: 'Document', description: 'Record knowledge for future reference' },
];

const TITLE_MAX_LENGTH = 200;
const TAG_MAX_LENGTH = 50;
const MAX_TAGS = 20;

export default function CreateTopicPage() {
  const { user } = useUser();
  const db = useDatabase();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [intent, setIntent] = useState('');
  const [trigger, setTrigger] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);

  // Field-level validation state
  const [titleTouched, setTitleTouched] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [tagDuplicateHint, setTagDuplicateHint] = useState<string | null>(null);

  // Duplicate title detection state
  const [duplicateTitleWarning, setDuplicateTitleWarning] = useState<string | null>(null);
  const [duplicateExistingTopics, setDuplicateExistingTopics] = useState<Array<{ id: string; title: string; status: string; createdAt: string }>>([]);
  const duplicateCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track whether any form field has been modified from defaults
  const isDirty = useMemo(() => {
    return (
      title.trim() !== '' ||
      description.trim() !== '' ||
      tags.length > 0 ||
      intent !== '' ||
      trigger.trim() !== ''
    );
  }, [title, description, tags, intent, trigger]);

  // Warn user about unsaved changes on page refresh/close (but not after successful submit)
  useUnsavedChangesWarning(isDirty && !hasSubmitted);

  // Debounced duplicate title check
  const checkDuplicateTitle = useCallback(async (titleValue: string) => {
    const trimmed = titleValue.trim();
    if (!trimmed || !user) {
      setDuplicateTitleWarning(null);
      setDuplicateExistingTopics([]);
      return;
    }
    try {
        const data = checkTopicTitle(db, trimmed);
        if (data.exists && data.count > 0) {
          setDuplicateTitleWarning(
            `You already have ${data.count} topic${data.count > 1 ? 's' : ''} with this title. You can still create another — they will be distinguishable by their dates and descriptions.`
          );
          setDuplicateExistingTopics(data.existingTopics || []);
        } else {
          setDuplicateTitleWarning(null);
          setDuplicateExistingTopics([]);
        }
    } catch {
      // Silently ignore check errors - this is a non-critical warning
    }
  }, [user]);

  // Validate title and set field-level error
  const validateTitle = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'Title is required. Please enter a descriptive name for your topic.';
    }
    if (trimmed.length > TITLE_MAX_LENGTH) {
      return `Title is too long (${trimmed.length}/${TITLE_MAX_LENGTH} characters). Please keep it under ${TITLE_MAX_LENGTH} characters.`;
    }
    return null;
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    // Clear inline error once user starts typing valid content
    if (titleTouched) {
      const err = validateTitle(value);
      setTitleError(err);
    }
    // Debounced duplicate title check (500ms after user stops typing)
    if (duplicateCheckTimerRef.current) {
      clearTimeout(duplicateCheckTimerRef.current);
    }
    duplicateCheckTimerRef.current = setTimeout(() => {
      checkDuplicateTitle(value);
    }, 500);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (duplicateCheckTimerRef.current) {
        clearTimeout(duplicateCheckTimerRef.current);
      }
    };
  }, []);

  const handleTitleBlur = () => {
    setTitleTouched(true);
    const err = validateTitle(title);
    setTitleError(err);
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (!trimmed) return;
    // Check max tag count
    if (tags.length >= MAX_TAGS) {
      setTagDuplicateHint(`Maximum of ${MAX_TAGS} tags reached. Remove a tag before adding more.`);
      setTagInput('');
      setTimeout(() => setTagDuplicateHint(null), 3000);
      return;
    }
    // Truncate long tags to TAG_MAX_LENGTH
    const finalTag = trimmed.length > TAG_MAX_LENGTH ? trimmed.slice(0, TAG_MAX_LENGTH) : trimmed;
    if (tags.includes(finalTag)) {
      setTagDuplicateHint(`Tag "${finalTag}" already exists.`);
      setTagInput('');
      // Auto-clear the duplicate hint after 3 seconds
      setTimeout(() => setTagDuplicateHint(null), 3000);
      return;
    }
    setTagDuplicateHint(null);
    if (trimmed.length > TAG_MAX_LENGTH) {
      setTagDuplicateHint(`Tag was truncated to ${TAG_MAX_LENGTH} characters.`);
      setTimeout(() => setTagDuplicateHint(null), 3000);
    }
    setTags([...tags, finalTag]);
    setTagInput('');
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === ',' || e.key === 'Tab') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsNetworkError(false);

    // Prevent duplicate submissions (e.g., browser back + resubmit)
    if (hasSubmitted || isSubmitting) {
      return;
    }

    // Run field-level validation and show inline errors
    setTitleTouched(true);
    const titleValidationError = validateTitle(title);
    setTitleError(titleValidationError);

    if (titleValidationError) {
      // Also set form-level error for accessibility
      setError(titleValidationError);
      return;
    }

    if (!user) {
      setError('You must be logged in to create a topic. Please sign in and try again.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/topics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          tags: tags.length > 0 ? tags : null,
          intent: intent || null,
          trigger: trigger.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Server error' }));
        throw new Error(data.error || 'Failed to create topic');
      }

      const data = await res.json();

      // Mark as submitted to prevent back-button resubmission
      setHasSubmitted(true);

      // Show appropriate toast based on whether duplicates existed
      if (data.warning) {
        addToast('Topic created! Note: a topic with this title already existed.', 'success', 5000);
      } else {
        addToast('Topic created successfully!', 'success', 4000);
      }

      // Use replace to remove the form page from history, preventing back+resubmit
      navigate('/app/topics', { replace: true });
    } catch (err) {
      // Detect network errors (fetch throws TypeError on network failure)
      const isNetwork = err instanceof TypeError ||
        (err instanceof Error && (
          err.message === 'Failed to fetch' ||
          err.message === 'NetworkError when attempting to fetch resource.' ||
          err.message === 'Network request failed' ||
          err.message.includes('network') ||
          err.message.includes('ERR_NETWORK') ||
          err.message.includes('ERR_CONNECTION')
        ));

      if (isNetwork) {
        setIsNetworkError(true);
        setError('Unable to connect to the server. Please check your internet connection and try again. Your form data has been preserved.');
      } else {
        setIsNetworkError(false);
        setError(err instanceof Error ? err.message : 'Failed to create topic. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-300 mb-6">
        <Link to="/app/topics" className="hover:text-primary-600 dark:hover:text-primary-400">
          Topics
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-white">New Topic</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create New Topic</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          Define a knowledge area you want to explore through interviews.
        </p>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <ApiErrorAlert
              message={error}
              onRetry={isNetworkError ? () => { setError(null); setIsNetworkError(false); } : undefined}
              onDismiss={() => { setError(null); setIsNetworkError(false); }}
            />
          )}

          {/* Title */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="title"
              type="text"
              required
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              onBlur={handleTitleBlur}
              className={`input-field ${titleTouched && titleError ? 'border-red-500 dark:border-red-400 focus:ring-red-500 focus:border-red-500' : ''}`}
              placeholder="e.g., My Leadership Style"
              maxLength={500}
              aria-invalid={titleTouched && !!titleError}
              aria-describedby={titleTouched && titleError ? 'title-error' : 'title-hint'}
            />
            <div className="flex justify-between items-start mt-1">
              {titleTouched && titleError ? (
                <p id="title-error" className="text-xs text-red-600 dark:text-red-400" role="alert">
                  {titleError}
                </p>
              ) : (
                <p id="title-hint" className="text-xs text-gray-500 dark:text-gray-300">
                  A short, descriptive name for your topic
                </p>
              )}
              <span
                className={`text-xs whitespace-nowrap ml-2 ${
                  title.trim().length > TITLE_MAX_LENGTH
                    ? 'text-red-600 dark:text-red-400 font-medium'
                    : title.trim().length > TITLE_MAX_LENGTH * 0.8
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                {title.trim().length}/{TITLE_MAX_LENGTH}
              </span>
            </div>
            {/* Duplicate title warning */}
            {duplicateTitleWarning && (
              <div className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800" role="alert">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-amber-500 dark:text-amber-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {duplicateTitleWarning}
                    </p>
                    {duplicateExistingTopics.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {duplicateExistingTopics.map(t => (
                          <li key={t.id} className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 dark:bg-amber-500" />
                            <span>&ldquo;{t.title}&rdquo;</span>
                            <span className="text-amber-500 dark:text-amber-500">—</span>
                            <span className="capitalize">{t.status?.replace('_', ' ')}</span>
                            <span className="text-amber-500 dark:text-amber-500">·</span>
                            <span>Created {new Date(t.createdAt).toLocaleDateString()}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-field min-h-[100px] resize-y"
              placeholder="What do you want to explore about this topic?"
              rows={3}
            />
          </div>

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="tags" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Tags <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
              </label>
              {tags.length > 0 && (
                <span className={`text-xs ${tags.length >= MAX_TAGS ? 'text-red-600 dark:text-red-400 font-medium' : tags.length >= MAX_TAGS * 0.8 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                  {tags.length}/{MAX_TAGS}
                </span>
              )}
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 max-w-full"
                  >
                    <span className="truncate">{tag}</span>
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="ml-0.5 text-primary-500 hover:text-primary-700 dark:hover:text-primary-200 flex-shrink-0"
                      aria-label={`Remove tag ${tag}`}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                id="tags"
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                className="input-field flex-1"
                placeholder={tags.length >= MAX_TAGS ? `Maximum of ${MAX_TAGS} tags reached` : 'Type a tag and press Enter'}
                disabled={tags.length >= MAX_TAGS}
                maxLength={TAG_MAX_LENGTH * 2}
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="btn-secondary"
                disabled={!tagInput.trim() || tags.length >= MAX_TAGS}
              >
                Add
              </button>
            </div>
            {tagDuplicateHint ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400" role="status">
                {tagDuplicateHint}
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-300">
                Press Enter or comma to add a tag. Max {TAG_MAX_LENGTH} chars per tag, up to {MAX_TAGS} tags.
              </p>
            )}
          </div>

          {/* Intent */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Intent <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-300 mb-2">
              Select what you want to achieve with this topic (optional)
            </p>
            <div className="grid grid-cols-2 gap-3">
              {INTENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setIntent(intent === option.value ? '' : option.value)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    intent === option.value
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-400'
                      : 'border-gray-200 dark:border-dark-border hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className={`text-sm font-medium ${
                    intent === option.value
                      ? 'text-primary-700 dark:text-primary-300'
                      : 'text-gray-900 dark:text-white'
                  }`}>
                    {option.label}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-300 mt-0.5">
                    {option.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Trigger */}
          <div>
            <label htmlFor="trigger" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Trigger <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
            </label>
            <textarea
              id="trigger"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              className="input-field min-h-[80px] resize-y"
              placeholder="What prompted you to explore this topic? (optional)"
              rows={2}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-300">
              What made you think about exploring this area?
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting || hasSubmitted || !title.trim()}
              className="btn-primary flex-1"
            >
              {hasSubmitted ? 'Topic Created!' : isSubmitting ? 'Creating...' : 'Create Topic'}
            </button>
            <button
              type="button"
              onClick={() => {
                setTitle('');
                setDescription('');
                setTagInput('');
                setTags([]);
                setIntent('');
                setTrigger('');
                setError(null);
                setIsNetworkError(false);
                setTitleTouched(false);
                setTitleError(null);
                setTagDuplicateHint(null);
              }}
              className="btn-secondary"
              disabled={isSubmitting}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => navigate('/app/topics')}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
