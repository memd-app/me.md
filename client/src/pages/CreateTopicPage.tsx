import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

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
  const [error, setError] = useState<string | null>(null);

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
        const data = await res.json();
        throw new Error(data.error || 'Failed to create topic');
      }

      navigate('/app/topics');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create topic');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create New Topic</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Define a knowledge area you want to explore through interviews.
        </p>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
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
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Press Enter or comma to add a tag
            </p>
          </div>

          {/* Intent */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Intent
            </label>
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
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
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
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              What made you think about exploring this area?
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="btn-primary flex-1"
            >
              {isSubmitting ? 'Creating...' : 'Create Topic'}
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
