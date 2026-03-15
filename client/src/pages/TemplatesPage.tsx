import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getTemplates, createTopicFromTemplate } from '@/services/templates';

interface Template {
  id: string;
  title: string;
  description: string | null;
  aiUseCaseTag: string | null;
  interviewPrompts: string | null;
  createdAt: string;
}

const TAG_LABELS: Record<string, string> = {
  email_writing: 'Email Writing',
  management_style: 'Management',
  feedback_style: 'Feedback',
  decision_making: 'Decision Making',
  communication_preferences: 'Communication',
  problem_solving: 'Problem Solving',
  creative_process: 'Creative Process',
  work_priorities: 'Work Priorities',
};

const TAG_COLORS: Record<string, string> = {
  email_writing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  management_style: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  feedback_style: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  decision_making: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  communication_preferences: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  problem_solving: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  creative_process: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  work_priorities: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
};

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const db = useDatabase();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();

    const fetchTemplates = () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = getTemplates(db);
        if (!controller.signal.aborted) {
          setTemplates(data.templates || []);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Failed to load templates');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchTemplates();
    return () => controller.abort();
  }, [user]);

  const parsePrompts = (promptsStr: string | null): string[] => {
    if (!promptsStr) return [];
    try {
      return JSON.parse(promptsStr);
    } catch {
      return [];
    }
  };

  const handleSelectTemplate = (template: Template) => {
    setSelectedTemplate(selectedTemplate?.id === template.id ? null : template);
    setCreateSuccess(null);
  };

  const handleCreateTopic = async (template: Template) => {
    if (!user) return;

    setIsCreating(true);
    setError(null);
    setCreateSuccess(null);
    try {
      const data = createTopicFromTemplate(db, template.id);
      setCreateSuccess(data.topic.id);

      // Navigate to the new topic after a brief delay
      setTimeout(() => {
        navigate(`/app/topics/${data.topic.id}`);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create topic');
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <LoadingSpinner card message="Loading templates..." />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-300 mb-6">
        <Link to="/app/topics" className="hover:text-primary-600 dark:hover:text-primary-400">
          Topics
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-white">Use Case Templates</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Use Case Templates
        </h1>
        <p className="text-gray-600 dark:text-gray-300 max-w-2xl">
          Goal-oriented interview templates for specific AI use cases. Each template includes
          pre-configured prompts designed to extract knowledge that maps to common AI tasks.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <ApiErrorAlert
          message={error}
          onDismiss={() => setError(null)}
          className="mb-6"
        />
      )}

      {/* Success banner */}
      {createSuccess && (
        <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 mb-6 flex items-center gap-2">
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Topic created! Redirecting to topic detail...
        </div>
      )}

      {/* Templates grid */}
      {templates.length === 0 ? (
        <div className="card text-center py-12">
          <span className="text-4xl block mb-3">📝</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No templates available
          </h2>
          <p className="text-gray-600 dark:text-gray-300">
            Use case templates will appear here once they are created.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {templates.map((template) => {
            const prompts = parsePrompts(template.interviewPrompts);
            const isSelected = selectedTemplate?.id === template.id;
            const tag = template.aiUseCaseTag || '';
            const tagLabel = TAG_LABELS[tag] || tag.replace(/_/g, ' ');
            const tagColor = TAG_COLORS[tag] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';

            return (
              <div
                key={template.id}
                className={`card cursor-pointer transition-all duration-200 ${
                  isSelected
                    ? 'ring-2 ring-primary-500 dark:ring-primary-400 border-primary-200 dark:border-primary-700'
                    : 'hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                onClick={() => handleSelectTemplate(template)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 min-w-0">
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                        {template.title}
                      </h2>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${tagColor}`}>
                        {tagLabel}
                      </span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-300 text-sm mb-3 line-clamp-2">
                      {template.description}
                    </p>

                    {/* Interview prompts preview - show when selected */}
                    {isSelected && prompts.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                          <svg className="w-4 h-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Interview Prompts ({prompts.length})
                        </h3>
                        <ul className="space-y-2">
                          {prompts.map((prompt, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300"
                            >
                              <span className="w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 text-xs flex items-center justify-center shrink-0 mt-0.5 font-medium">
                                {idx + 1}
                              </span>
                              <span>{prompt}</span>
                            </li>
                          ))}
                        </ul>

                        {/* Create topic button */}
                        <div className="mt-5 flex items-center gap-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCreateTopic(template);
                            }}
                            disabled={isCreating || !!createSuccess}
                            className="btn-primary flex items-center gap-2"
                          >
                            {isCreating ? (
                              <>
                                <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                                Creating Topic...
                              </>
                            ) : createSuccess ? (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Topic Created!
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Create Topic from Template
                              </>
                            )}
                          </button>
                          <span className="text-xs text-gray-500 dark:text-gray-300">
                            Creates a new topic with template configuration
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Expand indicator */}
                  <div className="shrink-0 mt-1">
                    <svg
                      className={`w-5 h-5 text-gray-500 dark:text-gray-300 transition-transform duration-200 ${
                        isSelected ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info section */}
      <div className="mt-8 p-6 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <svg className="w-4 h-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          How Templates Work
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Each template is designed around a specific AI use case. When you create a topic from a template,
          the interview session will use specialized prompts to extract exactly the knowledge that AI needs
          to replicate your style for that use case. The resulting insights are tagged with the AI use case
          for targeted context delivery.
        </p>
      </div>
    </div>
  );
}
