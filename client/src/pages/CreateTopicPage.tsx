import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';

const INTENT_OPTIONS = [
  { value: 'articulate', label: 'Articulate', description: 'Express something you already know' },
  { value: 'explore', label: 'Explore', description: 'Discover something new about yourself' },
  { value: 'decide', label: 'Decide', description: 'Work through a decision or choice' },
  { value: 'document', label: 'Document', description: 'Record knowledge for future reference' },
];

export default function CreateTopicPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

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

  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
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

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    if (!user) {
      setError('You must be logged in');
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

      // Mark as submitted to prevent back-button resubmission
      setHasSubmitted(true);
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
              onChange={(e) => setTitle(e.target.value)}
              className="input-field"
              placeholder="e.g., My Leadership Style"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
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
            <label htmlFor="tags" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Tags
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
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
                id="tags"
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                className="input-field flex-1"
                placeholder="Type a tag and press Enter"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="btn-secondary"
                disabled={!tagInput.trim()}
              >
                Add
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-300">
              Press Enter or comma to add a tag
            </p>
          </div>

          {/* Intent */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Intent
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
              Trigger
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
