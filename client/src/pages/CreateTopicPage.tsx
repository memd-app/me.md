import { useState, useMemo, useEffect, useRef, useCallback, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useToast } from '@/contexts/ToastContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { checkTopicTitle, createTopic } from '@/services/topics';
import { PageHeader, Button } from '@/components/ui';

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
      createTopic(db, {
        title: title.trim(),
        description: description.trim() || null,
        tags: tags.length > 0 ? tags : null,
        intent: intent || null,
        trigger: trigger.trim() || null,
      });

      // Mark as submitted to prevent back-button resubmission
      setHasSubmitted(true);

      // Show success toast (duplicate warning already shown inline during title entry)
      addToast('Topic created successfully!', 'success', 4000);

      // Use replace to remove the form page from history, preventing back+resubmit
      navigate('/app/topics', { replace: true });
    } catch (err) {
      setIsNetworkError(false);
      setError(err instanceof Error ? err.message : 'Failed to create topic. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
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
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs tracking-wide text-gray-400 dark:text-gray-600 mb-6">
        <Link to="/app/topics" className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
          Topics
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-gray-600 dark:text-gray-400">New Topic</span>
      </nav>

      <PageHeader
        title="Create New Topic"
        subtitle="Define a knowledge area you want to explore through interviews."
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <ApiErrorAlert
            message={error}
            onRetry={isNetworkError ? () => { setError(null); setIsNetworkError(false); } : undefined}
            onDismiss={() => { setError(null); setIsNetworkError(false); }}
          />
        )}

        {/* Title */}
        <div>
          <label htmlFor="title" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
            Title <span className="text-red-500 dark:text-red-400">*</span>
          </label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            onBlur={handleTitleBlur}
            className={`input-field font-serif text-lg ${titleTouched && titleError ? 'border-red-500 dark:border-red-400 focus:ring-red-500 focus:border-red-500' : ''}`}
            placeholder="e.g., My Leadership Style"
            maxLength={500}
            aria-invalid={titleTouched && !!titleError}
            aria-describedby={titleTouched && titleError ? 'title-error' : 'title-hint'}
          />
          <div className="flex justify-between items-start mt-1.5">
            {titleTouched && titleError ? (
              <p id="title-error" className="text-xs text-red-600 dark:text-red-400" role="alert">
                {titleError}
              </p>
            ) : (
              <p id="title-hint" className="text-xs text-gray-500 dark:text-gray-400">
                A short, descriptive name for your topic
              </p>
            )}
            <span
              className={`text-xs whitespace-nowrap ml-2 ${
                title.trim().length > TITLE_MAX_LENGTH
                  ? 'text-red-600 dark:text-red-400 font-medium'
                  : title.trim().length > TITLE_MAX_LENGTH * 0.8
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {title.trim().length}/{TITLE_MAX_LENGTH}
            </span>
          </div>
          {/* Duplicate title warning — quiet panel with amber rule, not a colored box */}
          {duplicateTitleWarning && (
            <div className="mt-3 pl-3 border-l-2 border-primary-500 dark:border-primary-400" role="alert">
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {duplicateTitleWarning}
              </p>
              {duplicateExistingTopics.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {duplicateExistingTopics.map(t => (
                    <li key={t.id} className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                      <span className="inline-block w-1 h-1 rounded-full bg-primary-500 dark:bg-primary-400" aria-hidden="true" />
                      <span>&ldquo;{t.title}&rdquo;</span>
                      <span aria-hidden="true">&mdash;</span>
                      <span className="capitalize">{t.status?.replace('_', ' ')}</span>
                      <span aria-hidden="true">&middot;</span>
                      <span>Created {new Date(t.createdAt).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
            Description <span className="text-gray-400 dark:text-gray-500 normal-case font-normal tracking-normal">(optional)</span>
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-field font-serif min-h-[100px] resize-y"
            placeholder="What do you want to explore about this topic?"
            rows={3}
          />
        </div>

        {/* Tags */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="tags" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400">
              Tags <span className="text-gray-400 dark:text-gray-500 normal-case font-normal tracking-normal">(optional)</span>
            </label>
            {tags.length > 0 && (
              <span className={`text-xs ${tags.length >= MAX_TAGS ? 'text-red-600 dark:text-red-400 font-medium' : tags.length >= MAX_TAGS * 0.8 ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {tags.length}/{MAX_TAGS}
              </span>
            )}
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold lowercase tracking-wide text-gray-600 dark:text-gray-400 border border-rule dark:border-dark-border rounded-sm px-2.5 py-1 max-w-full"
                >
                  <span className="truncate">{tag}</span>
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="text-gray-400 hover:text-primary-600 dark:text-gray-600 dark:hover:text-primary-400 shrink-0"
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
            <Button
              type="button"
              variant="secondary"
              onClick={handleAddTag}
              disabled={!tagInput.trim() || tags.length >= MAX_TAGS}
            >
              Add
            </Button>
          </div>
          {tagDuplicateHint ? (
            <p className="mt-1.5 text-xs text-primary-600 dark:text-primary-400" role="status">
              {tagDuplicateHint}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Press Enter or comma to add a tag. Max {TAG_MAX_LENGTH} chars per tag, up to {MAX_TAGS} tags.
            </p>
          )}
        </div>

        {/* Intent */}
        <div>
          <span className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
            Intent <span className="text-gray-400 dark:text-gray-500 normal-case font-normal tracking-normal">(optional)</span>
          </span>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2.5">
            Select what you want to achieve with this topic
          </p>
          <div className="grid grid-cols-2 gap-2">
            {INTENT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setIntent(intent === option.value ? '' : option.value)}
                className={`p-3 rounded-sm border text-left transition-colors ${
                  intent === option.value
                    ? 'border-primary-500 dark:border-primary-400'
                    : 'border-rule dark:border-dark-border hover:border-gray-400 dark:hover:border-gray-600'
                }`}
              >
                <div className={`text-xs font-semibold uppercase tracking-wide ${
                  intent === option.value
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

        {/* Trigger */}
        <div>
          <label htmlFor="trigger" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
            Trigger <span className="text-gray-400 dark:text-gray-500 normal-case font-normal tracking-normal">(optional)</span>
          </label>
          <textarea
            id="trigger"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            className="input-field font-serif min-h-[80px] resize-y"
            placeholder="What prompted you to explore this topic? (optional)"
            rows={2}
          />
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            What made you think about exploring this area?
          </p>
        </div>

        {/* Actions — primary ink action, quiet ghost actions */}
        <div className="flex gap-3 pt-2">
          <Button
            type="submit"
            disabled={isSubmitting || hasSubmitted || !title.trim()}
            loading={isSubmitting}
            className="flex-1"
          >
            {hasSubmitted ? 'Topic created!' : isSubmitting ? 'Creating…' : 'Create topic'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleReset} disabled={isSubmitting}>
            Reset
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate('/app/topics')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
