import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getTemplates, createTopicFromTemplate } from '@/services/templates';
import { PageHeader, SectionHeading, EmptyState, Button } from '@/components/ui';

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
          setTemplates((data.templates || []) as any);
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
      <div className="max-w-5xl mx-auto">
        <LoadingSpinner card message="Loading templates..." />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs tracking-wide text-gray-400 dark:text-gray-600 mb-6 min-w-0">
        <Link to="/app/topics" className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors shrink-0">
          Topics
        </Link>
        <span aria-hidden="true" className="shrink-0">/</span>
        <span className="text-gray-600 dark:text-gray-400 truncate">Use Case Templates</span>
      </nav>

      <PageHeader
        kicker="Templates"
        title="Use Case Templates"
        subtitle="Goal-oriented interview templates for specific AI use cases. Each template includes pre-configured prompts designed to extract knowledge that maps to common AI tasks."
      />

      {/* Error banner */}
      {error && (
        <ApiErrorAlert
          message={error}
          onDismiss={() => setError(null)}
          className="mb-6"
        />
      )}

      {/* Success message — quiet typographic confirmation, no colored box */}
      {createSuccess && (
        <p role="status" className="mb-6 text-sm font-semibold text-primary-600 dark:text-primary-400">
          Topic created. Redirecting to topic detail&hellip;
        </p>
      )}

      {/* Templates gallery */}
      {templates.length === 0 ? (
        <EmptyState
          kicker="No templates yet"
          message="Use case templates will appear here once they are created."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {templates.map((template) => {
            const prompts = parsePrompts(template.interviewPrompts);
            const isSelected = selectedTemplate?.id === template.id;
            const tag = template.aiUseCaseTag || '';
            const tagLabel = TAG_LABELS[tag] || tag.replace(/_/g, ' ');

            return (
              <div
                key={template.id}
                className={`border rounded-lg p-5 cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-primary-500 dark:border-primary-400'
                    : 'border-rule dark:border-dark-border hover:border-gray-400 dark:hover:border-gray-600'
                }`}
                onClick={() => handleSelectTemplate(template)}
                role="button"
                tabIndex={0}
                aria-expanded={isSelected}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectTemplate(template);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400 mb-1.5">
                      {tagLabel}
                    </p>
                    <h2 className="font-serif text-xl text-gray-900 dark:text-white mb-2 truncate">
                      {template.title}
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                      {template.description}
                    </p>
                  </div>
                  <svg
                    className={`w-4 h-4 shrink-0 mt-1 text-gray-400 dark:text-gray-600 transition-transform duration-200 ${
                      isSelected ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Interview prompts preview — numbered editorial markers */}
                {isSelected && prompts.length > 0 && (
                  <div className="mt-5 pt-5 border-t border-rule dark:border-dark-border">
                    <p className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-3">
                      Interview prompts ({prompts.length})
                    </p>
                    <ul className="space-y-2.5">
                      {prompts.map((prompt, idx) => (
                        <li key={idx} className="grid grid-cols-[1.5rem_1fr] gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <span className="text-xs font-semibold text-gray-300 dark:text-gray-700 pt-0.5">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span>{prompt}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Use template — hairline ghost action */}
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCreateTopic(template);
                        }}
                        loading={isCreating}
                        disabled={isCreating || !!createSuccess}
                      >
                        {createSuccess ? 'Topic created' : isCreating ? 'Creating topic…' : 'Use this template'}
                      </Button>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Creates a new topic with template configuration
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Info section */}
      <div className="mt-12">
        <SectionHeading className="mb-3">How templates work</SectionHeading>
        <p className="font-serif text-[15px] leading-relaxed text-gray-600 dark:text-gray-300 max-w-2xl">
          Each template is designed around a specific AI use case. When you create a topic from a
          template, the interview session will use specialized prompts to extract exactly the
          knowledge that AI needs to replicate your style for that use case. The resulting insights
          are tagged with the AI use case for targeted context delivery.
        </p>
      </div>
    </div>
  );
}
