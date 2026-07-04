import { useState, useRef, useEffect, useMemo, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { getPresetTopics, selectPresetTopics } from '@/services/topics';
import { importUrls, importText, importFile } from '@/services/import';
import { Card, Badge } from '@/components/ui';

type OnboardingStep = 'welcome' | 'profile' | 'context' | 'topics';
type ImportTab = 'url' | 'text' | 'file';

interface ProfileFields {
  name: string;
  dateOfBirth: string;
  location: string;
  occupation: string;
  gender: string;
}

interface FieldErrors {
  name?: string;
  dateOfBirth?: string;
  location?: string;
  occupation?: string;
  gender?: string;
}

interface ImportResult {
  id: string;
  url?: string;
  source: 'url' | 'text' | 'file';
  status: 'success' | 'error';
  title?: string;
  summary?: string;
  error?: string;
}

interface PresetTopic {
  title: string;
  description: string;
  category: string;
  intent: string;
  tags: string[];
  suggestedQuestion: string;
  alreadySelected: boolean;
}

const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non-binary', label: 'Non-binary' },
  { value: 'prefer-not-to-say', label: 'Prefer not to say' },
  { value: 'other', label: 'Other' },
];

const STEPS: { key: OnboardingStep; label: string }[] = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'profile', label: 'Profile' },
  { key: 'context', label: 'Context' },
  { key: 'topics', label: 'Topics' },
];

// Status is shown typographically (small caps + accent/muting) — no colored
// pills or category icons, per DESIGN.md.
const CATEGORY_INFO: Record<string, { label: string }> = {
  identity: { label: 'Identity' },
  skills: { label: 'Skills' },
  experiences: { label: 'Experiences' },
  perspectives: { label: 'Perspectives' },
  goals: { label: 'Goals' },
};

const PILLARS: { title: string; description: string }[] = [
  {
    title: 'Create',
    description:
      'AI-guided conversations extract your personal knowledge through proven questioning methods.',
  },
  {
    title: 'Verify',
    description:
      "You're in full control. Review and verify every insight before it becomes part of your profile.",
  },
  {
    title: 'Manage',
    description: 'Build a living knowledge graph and export your context for any AI tool.',
  },
];

const IMPORT_TABS: { key: ImportTab; label: string }[] = [
  { key: 'url', label: 'URL' },
  { key: 'text', label: 'Paste text' },
  { key: 'file', label: 'Upload file' },
];

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/** Centered editorial step header: amber small-caps kicker, serif italic title, italic deck. */
function StepHeading({ kicker, title, subtitle }: { kicker: string; title: string; subtitle?: string }) {
  return (
    <div className="text-center mb-10">
      <p className="text-[11px] tracking-[0.16em] uppercase font-sans font-bold text-primary-600 dark:text-primary-400 mb-3">
        {kicker}
      </p>
      <h2 className="font-serif italic text-3xl sm:text-4xl text-ink dark:text-gray-100 mb-3">{title}</h2>
      {subtitle && (
        <p className="font-serif italic text-gray-600 dark:text-gray-300 max-w-md mx-auto">{subtitle}</p>
      )}
    </div>
  );
}

export default function OnboardingPage() {
  const { user, updateUser, createUser } = useUser();
  const db = useDatabase();
  const navigate = useNavigate();

  const [currentStep, setCurrentStepRaw] = useState<OnboardingStep>('welcome');
  const [highestStepReached, setHighestStepReached] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Wrapper around setCurrentStep that also tracks the highest step reached
  const setCurrentStep = (step: OnboardingStep) => {
    setCurrentStepRaw(step);
    const stepIndex = STEPS.findIndex((s) => s.key === step);
    setHighestStepReached((prev) => Math.max(prev, stepIndex));
  };

  // Profile fields
  const [profileFields, setProfileFields] = useState<ProfileFields>({
    name: user?.name || '',
    dateOfBirth: user?.dateOfBirth && user.dateOfBirth !== '2000-01-01' ? user.dateOfBirth : '',
    location: user?.location && user.location !== 'Unknown' ? user.location : '',
    occupation: user?.occupation && user.occupation !== 'Unknown' ? user.occupation : '',
    gender: user?.gender && user.gender !== 'unspecified' ? user.gender : '',
  });

  // Context import state
  const [activeImportTab, setActiveImportTab] = useState<ImportTab>('url');
  const [urlInput, setUrlInput] = useState('');
  const [isProcessingUrl, setIsProcessingUrl] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  // Paste text state
  const [pasteText, setPasteText] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [isProcessingText, setIsProcessingText] = useState(false);
  const [pasteError, setPasteError] = useState('');

  // File upload state
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [fileError, setFileError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preset topics state
  const [presetTopics, setPresetTopics] = useState<PresetTopic[]>([]);
  const [selectedTopicTitles, setSelectedTopicTitles] = useState<Set<string>>(new Set());
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [presetError, setPresetError] = useState('');
  const [isSavingTopics, setIsSavingTopics] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep);

  // Track unsaved changes during onboarding flow
  const isOnboardingDirty = useMemo(() => {
    if (currentStep === 'welcome') return false;
    // Check if profile fields have been modified
    const hasProfileData =
      profileFields.name.trim() !== '' ||
      profileFields.dateOfBirth.trim() !== '' ||
      profileFields.location.trim() !== '' ||
      profileFields.occupation.trim() !== '' ||
      profileFields.gender !== '';
    // Check if imports or topic selections exist
    const hasImportData = importResults.length > 0 || pasteText.trim() !== '';
    const hasTopicSelections = selectedTopicTitles.size > 0;
    return hasProfileData || hasImportData || hasTopicSelections;
  }, [currentStep, profileFields, importResults, pasteText, selectedTopicTitles]);

  useUnsavedChangesWarning(isOnboardingDirty);

  // Load preset topics when entering topics step
  useEffect(() => {
    if (currentStep === 'topics' && presetTopics.length === 0) {
      const controller = new AbortController();
      loadPresetTopics(controller.signal);
      return () => controller.abort();
    }
  }, [currentStep]);

  const loadPresetTopics = async (signal?: AbortSignal) => {
    setIsLoadingPresets(true);
    setPresetError('');
    try {
      const data = getPresetTopics(db);
      if (!signal?.aborted) {
        setPresetTopics(data.presets || []);

        // Pre-select already selected presets
        const alreadySelected = (data.presets || [])
          .filter((p: PresetTopic) => p.alreadySelected)
          .map((p: PresetTopic) => p.title);
        if (alreadySelected.length > 0) {
          setSelectedTopicTitles(new Set(alreadySelected));
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!signal?.aborted) {
        setPresetError(err instanceof Error ? err.message : 'Failed to load topics');
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoadingPresets(false);
      }
    }
  };

  const toggleTopicSelection = (title: string) => {
    setSelectedTopicTitles((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  const handleSavePresetTopics = async () => {
    if (selectedTopicTitles.size === 0) {
      // Allow skipping
      await handleCompleteOnboarding();
      return;
    }

    setIsSavingTopics(true);
    setPresetError('');

    try {
      selectPresetTopics(db, Array.from(selectedTopicTitles));

      // Complete onboarding after saving topics
      await handleCompleteOnboarding();
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : 'Failed to save topics');
    } finally {
      setIsSavingTopics(false);
    }
  };

  const validateProfileFields = (): boolean => {
    const errors: FieldErrors = {};
    let isValid = true;

    if (!profileFields.name.trim()) {
      errors.name = 'Name is required';
      isValid = false;
    }

    if (!profileFields.dateOfBirth.trim()) {
      errors.dateOfBirth = 'Date of birth is required';
      isValid = false;
    } else {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(profileFields.dateOfBirth)) {
        errors.dateOfBirth = 'Please use YYYY-MM-DD format';
        isValid = false;
      } else {
        const date = new Date(profileFields.dateOfBirth);
        const minDate = new Date('1900-01-01');
        if (isNaN(date.getTime())) {
          errors.dateOfBirth = 'Invalid date';
          isValid = false;
        } else if (date > new Date()) {
          errors.dateOfBirth = 'Date of birth cannot be in the future';
          isValid = false;
        } else if (date < minDate) {
          errors.dateOfBirth = 'Date of birth must be after January 1, 1900';
          isValid = false;
        }
      }
    }

    if (!profileFields.location.trim()) {
      errors.location = 'Location is required';
      isValid = false;
    }

    if (!profileFields.occupation.trim()) {
      errors.occupation = 'Occupation is required';
      isValid = false;
    }

    if (!profileFields.gender.trim()) {
      errors.gender = 'Gender is required';
      isValid = false;
    }

    setFieldErrors(errors);
    return isValid;
  };

  const handleProfileSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');

    if (!validateProfileFields()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const profileData = {
        name: profileFields.name.trim(),
        dateOfBirth: profileFields.dateOfBirth.trim(),
        location: profileFields.location.trim(),
        occupation: profileFields.occupation.trim(),
        gender: profileFields.gender.trim(),
      };

      if (user) {
        updateUser(profileData);
      } else {
        createUser(profileData);
      }

      // Move to context import step
      setCurrentStep('context');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFieldChange = (field: keyof ProfileFields, value: string) => {
    setProfileFields((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleUrlSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setUrlError('');

    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) {
      setUrlError('Please enter a URL');
      return;
    }

    // Validate URL format
    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setUrlError('Only http and https URLs are supported');
        return;
      }
    } catch {
      setUrlError('Please enter a valid URL (e.g., https://example.com)');
      return;
    }

    setIsProcessingUrl(true);

    try {
      const data = await importUrls(db, [trimmedUrl]);

      if (data.results && data.results.length > 0) {
        setImportResults((prev) => [
          ...prev,
          ...data.results.map((r: { id: string; url: string; status: 'success' | 'error'; title?: string; summary?: string; error?: string }) => ({
            ...r,
            source: 'url' as const,
          })),
        ]);
      }

      setUrlInput('');
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Failed to process URL');
    } finally {
      setIsProcessingUrl(false);
    }
  };

  const handleTextSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPasteError('');

    const trimmedText = pasteText.trim();
    if (!trimmedText) {
      setPasteError('Please enter some text');
      return;
    }

    if (trimmedText.length < 10) {
      setPasteError('Please enter at least 10 characters');
      return;
    }

    setIsProcessingText(true);

    try {
      const data = importText(db, trimmedText, pasteTitle.trim() || undefined);

      setImportResults((prev) => [
        ...prev,
        {
          id: data.id,
          source: 'text',
          status: 'success',
          title: data.title || 'Pasted text',
          summary: data.summary,
        },
      ]);

      setPasteText('');
      setPasteTitle('');
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : 'Failed to import text');
    } finally {
      setIsProcessingText(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError('');
    setIsUploadingFile(true);

    try {
      // Validate file size (5MB)
      if (file.size > 5 * 1024 * 1024) {
        setFileError('File too large. Maximum size is 5MB.');
        return;
      }

      const data = await importFile(db, file);

      setImportResults((prev) => [
        ...prev,
        {
          id: data.id,
          source: 'file',
          status: 'success',
          title: data.title || data.filename || 'Uploaded file',
          summary: data.summary,
        },
      ]);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Failed to upload file');
      setImportResults((prev) => [
        ...prev,
        {
          id: '',
          source: 'file',
          status: 'error',
          title: file.name,
          error: err instanceof Error ? err.message : 'Failed to upload file',
        },
      ]);
    } finally {
      setIsUploadingFile(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const [showAssessmentSuggestion, setShowAssessmentSuggestion] = useState(false);

  const handleCompleteOnboarding = async () => {
    setIsSubmitting(true);
    try {
      updateUser({ onboardingCompleted: true });
      // Show assessment suggestion instead of navigating directly
      setShowAssessmentSuggestion(true);
    } catch {
      navigate('/app/dashboard', { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipOnboarding = async () => {
    setIsSubmitting(true);
    try {
      updateUser({ onboardingCompleted: true });
      navigate('/app/dashboard', { replace: true });
    } catch {
      navigate('/app/dashboard', { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get unique categories from presets for display
  const categories = Object.keys(CATEGORY_INFO);
  const filteredPresets = activeCategory
    ? presetTopics.filter((p) => p.category === activeCategory)
    : presetTopics;

  return (
    <div className="min-h-screen bg-paper dark:bg-dark-bg flex flex-col">
      {/* Masthead — quiet running wordmark, present through every step */}
      <div className="pt-12 pb-2 text-center" aria-hidden="true">
        <span className="font-serif italic text-xl text-ink dark:text-gray-100">
          me<span className="text-primary-500 not-italic">.</span>md
        </span>
      </div>

      {/* Step indicator — numbered editorial markers, hairline connectors, no progress pills */}
      <nav aria-label="Onboarding progress" className="w-full max-w-[680px] mx-auto px-6 pt-6 pb-10">
        <ol className="flex items-center">
          {STEPS.map((step, index) => {
            const isCompleted = index <= highestStepReached && index !== currentStepIndex;
            const isCurrent = index === currentStepIndex;
            return (
              <li
                key={step.key}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex items-center ${index < STEPS.length - 1 ? 'flex-1' : ''}`}
              >
                <span className="sr-only">
                  {`Step ${index + 1}: ${step.label}${isCompleted ? ' (completed)' : isCurrent ? ' (current)' : ' (upcoming)'}`}
                </span>
                <div className="flex items-center gap-2 shrink-0" aria-hidden="true">
                  <span
                    className={`flex items-center justify-center font-sans text-[11px] font-semibold tabular-nums ${
                      isCurrent
                        ? 'text-ink dark:text-gray-100'
                        : isCompleted
                          ? 'text-primary-500 dark:text-primary-400'
                          : 'text-ink/40 dark:text-[#7A7264]'
                    }`}
                  >
                    {isCompleted ? (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      String(index + 1).padStart(2, '0')
                    )}
                  </span>
                  {isCurrent && <span className="w-1 h-1 rounded-full bg-primary-500" />}
                  <span
                    className={`hidden sm:inline text-[11px] uppercase tracking-[0.08em] font-sans font-medium ${
                      isCurrent
                        ? 'text-ink dark:text-gray-100'
                        : isCompleted
                          ? 'text-gray-500 dark:text-gray-400'
                          : 'text-ink/40 dark:text-[#7A7264]'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                {index < STEPS.length - 1 && (
                  <span className="flex-1 h-px bg-rule dark:bg-dark-border mx-3 sm:mx-4" />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Content */}
      <main className="flex-1 flex items-start justify-center px-6 pb-16">
        <div className="w-full max-w-[680px]">

          {/* STEP 1: Welcome */}
          {currentStep === 'welcome' && (
            <div className="text-center">
              <h1 className="font-serif italic text-4xl sm:text-5xl leading-[1.1] text-ink dark:text-gray-100 mb-5">
                Welcome to your book of record.
              </h1>
              <p className="text-gray-600 dark:text-gray-300 max-w-md mx-auto mb-12">
                A few short steps, and we&apos;ll begin gathering the story only you can tell.
              </p>

              {/* Three pillars — numbered editorial rows, not colored cards */}
              <div className="border-t border-rule dark:border-dark-border text-left mb-12">
                {PILLARS.map((pillar, i) => (
                  <div
                    key={pillar.title}
                    className="flex gap-5 py-6 border-b border-rule dark:border-dark-border"
                  >
                    <span className="font-sans text-[11px] tracking-[0.08em] text-ink/40 dark:text-[#7A7264] tabular-nums pt-1 shrink-0">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h3 className="font-serif text-lg text-ink dark:text-gray-100 mb-1">{pillar.title}</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-300">{pillar.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col items-center gap-4">
                <button
                  onClick={() => setCurrentStep('profile')}
                  className="btn-primary px-10 py-3 text-base"
                >
                  Get Started
                </button>
                <button
                  onClick={handleSkipOnboarding}
                  disabled={isSubmitting}
                  className="text-[11px] uppercase tracking-[0.08em] font-sans font-medium text-ink/40 dark:text-[#7A7264] hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                >
                  Skip for now
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Profile Fields */}
          {currentStep === 'profile' && (
            <div>
              <StepHeading
                kicker="Step 02 · Profile"
                title="Tell us about yourself"
                subtitle="This helps personalize your AI interviews and knowledge extraction."
              />

              <form onSubmit={handleProfileSubmit} className="space-y-6">
                {serverError && (
                  <p
                    id="onboarding-server-error"
                    className="text-sm text-red-600 dark:text-red-400 border-l-2 border-red-400 dark:border-red-500 pl-3"
                    role="alert"
                    aria-live="assertive"
                  >
                    {serverError}
                  </p>
                )}

                {/* Name */}
                <div>
                  <label htmlFor="ob-name" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                    Full Name <span className="text-primary-500">*</span>
                  </label>
                  <input
                    id="ob-name"
                    type="text"
                    value={profileFields.name}
                    onChange={(e) => handleFieldChange('name', e.target.value)}
                    className={`input-field ${fieldErrors.name ? 'border-red-400 dark:border-red-500' : ''}`}
                    placeholder="Your full name"
                    autoComplete="name"
                    aria-describedby={fieldErrors.name ? 'ob-name-error' : undefined}
                    aria-invalid={fieldErrors.name ? true : undefined}
                  />
                  {fieldErrors.name && (
                    <p id="ob-name-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">{fieldErrors.name}</p>
                  )}
                </div>

                {/* Date of Birth */}
                <div>
                  <label htmlFor="ob-dob" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                    Date of Birth <span className="text-primary-500">*</span>
                  </label>
                  <input
                    id="ob-dob"
                    type="date"
                    value={profileFields.dateOfBirth}
                    onChange={(e) => handleFieldChange('dateOfBirth', e.target.value)}
                    className={`input-field ${fieldErrors.dateOfBirth ? 'border-red-400 dark:border-red-500' : ''}`}
                    min="1900-01-01"
                    max={new Date().toISOString().split('T')[0]}
                    aria-describedby={fieldErrors.dateOfBirth ? 'ob-dob-error' : 'ob-dob-hint'}
                    aria-invalid={fieldErrors.dateOfBirth ? true : undefined}
                  />
                  <p id="ob-dob-hint" className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    Must be between 1900 and today
                  </p>
                  {fieldErrors.dateOfBirth && (
                    <p id="ob-dob-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">{fieldErrors.dateOfBirth}</p>
                  )}
                </div>

                {/* Location */}
                <div>
                  <label htmlFor="ob-location" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                    Location <span className="text-primary-500">*</span>
                  </label>
                  <input
                    id="ob-location"
                    type="text"
                    value={profileFields.location}
                    onChange={(e) => handleFieldChange('location', e.target.value)}
                    className={`input-field ${fieldErrors.location ? 'border-red-400 dark:border-red-500' : ''}`}
                    placeholder="City, Country"
                    autoComplete="address-level2"
                    aria-describedby={fieldErrors.location ? 'ob-location-error' : undefined}
                    aria-invalid={fieldErrors.location ? true : undefined}
                  />
                  {fieldErrors.location && (
                    <p id="ob-location-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">{fieldErrors.location}</p>
                  )}
                </div>

                {/* Occupation */}
                <div>
                  <label htmlFor="ob-occupation" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                    Occupation <span className="text-primary-500">*</span>
                  </label>
                  <input
                    id="ob-occupation"
                    type="text"
                    value={profileFields.occupation}
                    onChange={(e) => handleFieldChange('occupation', e.target.value)}
                    className={`input-field ${fieldErrors.occupation ? 'border-red-400 dark:border-red-500' : ''}`}
                    placeholder="Your job title or role"
                    autoComplete="organization-title"
                    aria-describedby={fieldErrors.occupation ? 'ob-occupation-error' : undefined}
                    aria-invalid={fieldErrors.occupation ? true : undefined}
                  />
                  {fieldErrors.occupation && (
                    <p id="ob-occupation-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">{fieldErrors.occupation}</p>
                  )}
                </div>

                {/* Gender */}
                <div>
                  <label htmlFor="ob-gender" className="block text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                    Gender <span className="text-primary-500">*</span>
                  </label>
                  <select
                    id="ob-gender"
                    value={profileFields.gender}
                    onChange={(e) => handleFieldChange('gender', e.target.value)}
                    className={`input-field ${fieldErrors.gender ? 'border-red-400 dark:border-red-500' : ''}`}
                    aria-describedby={fieldErrors.gender ? 'ob-gender-error' : undefined}
                    aria-invalid={fieldErrors.gender ? true : undefined}
                  >
                    <option value="">Select gender</option>
                    {GENDER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.gender && (
                    <p id="ob-gender-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">{fieldErrors.gender}</p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setCurrentStep('welcome')}
                    className="btn-secondary flex-1"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn-primary flex-[2]"
                  >
                    {isSubmitting ? 'Saving…' : 'Continue'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSkipOnboarding}
                  disabled={isSubmitting}
                  className="w-full text-[11px] uppercase tracking-[0.08em] font-sans font-medium text-ink/40 dark:text-[#7A7264] hover:text-primary-600 dark:hover:text-primary-400 transition-colors mt-1"
                >
                  Skip for now
                </button>
              </form>
            </div>
          )}

          {/* STEP 3: Context Import */}
          {currentStep === 'context' && (
            <div>
              <StepHeading
                kicker="Step 03 · Context (optional)"
                title="Import existing context"
                subtitle="Give the interviewer a head start with things you've already written about yourself."
              />

              {/* Import Method Tabs */}
              <div className="flex border-b border-rule dark:border-dark-border mb-8" role="tablist" aria-label="Import method">
                {IMPORT_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={activeImportTab === tab.key}
                    aria-controls={`import-panel-${tab.key}`}
                    id={`import-tab-${tab.key}`}
                    onClick={() => setActiveImportTab(tab.key)}
                    className={`flex-1 pb-3 pt-1 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold border-b-2 transition-colors ${
                      activeImportTab === tab.key
                        ? 'border-primary-500 text-ink dark:text-gray-100'
                        : 'border-transparent text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* URL Import Tab */}
              {activeImportTab === 'url' && (
                <div id="import-panel-url" role="tabpanel" aria-labelledby="import-tab-url">
                  <Card className="mb-8">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                      Add links to your blog, portfolio, LinkedIn, or any page about you
                    </p>

                    <form onSubmit={handleUrlSubmit} className="flex gap-2">
                      <input
                        type="text"
                        value={urlInput}
                        onChange={(e) => {
                          setUrlInput(e.target.value);
                          setUrlError('');
                        }}
                        className="input-field flex-1"
                        placeholder="https://example.com/about-me"
                        disabled={isProcessingUrl}
                      />
                      <button
                        type="submit"
                        disabled={isProcessingUrl || !urlInput.trim()}
                        className="btn-primary px-4 py-2 whitespace-nowrap"
                      >
                        {isProcessingUrl ? (
                          <span className="flex items-center gap-2">
                            <Spinner />
                            Processing…
                          </span>
                        ) : (
                          'Add URL'
                        )}
                      </button>
                    </form>

                    {urlError && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">{urlError}</p>
                    )}
                  </Card>
                </div>
              )}

              {/* Paste Text Tab */}
              {activeImportTab === 'text' && (
                <div id="import-panel-text" role="tabpanel" aria-labelledby="import-tab-text">
                  <Card className="mb-8">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                      Paste text about yourself — a bio, interests, resume excerpt, or anything that describes you
                    </p>

                    <form onSubmit={handleTextSubmit} className="space-y-3">
                      <input
                        type="text"
                        value={pasteTitle}
                        onChange={(e) => setPasteTitle(e.target.value)}
                        className="input-field w-full"
                        placeholder="Title (optional) — e.g., My Bio, Personal Interests"
                        disabled={isProcessingText}
                      />
                      <textarea
                        value={pasteText}
                        onChange={(e) => {
                          setPasteText(e.target.value);
                          setPasteError('');
                        }}
                        className="input-field w-full min-h-[120px] resize-y"
                        placeholder="Paste your text here… For example, a paragraph about your interests, career, hobbies, or anything you'd like the AI to know about you."
                        disabled={isProcessingText}
                        rows={5}
                      />
                      {pasteText.trim().length > 0 && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {pasteText.trim().length} characters
                        </p>
                      )}
                      <button
                        type="submit"
                        disabled={isProcessingText || !pasteText.trim()}
                        className="btn-primary w-full py-2"
                      >
                        {isProcessingText ? (
                          <span className="flex items-center justify-center gap-2">
                            <Spinner />
                            Processing…
                          </span>
                        ) : (
                          'Import Text'
                        )}
                      </button>
                    </form>

                    {pasteError && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">{pasteError}</p>
                    )}
                  </Card>
                </div>
              )}

              {/* File Upload Tab */}
              {activeImportTab === 'file' && (
                <div id="import-panel-file" role="tabpanel" aria-labelledby="import-tab-file">
                  <Card className="mb-8">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                      Upload a text file, markdown, CSV, JSON, or PDF (max 5MB)
                    </p>

                    <div className="space-y-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.md,.csv,.json,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf"
                        onChange={handleFileUpload}
                        className="hidden"
                        id="onboarding-file-upload"
                        disabled={isUploadingFile}
                      />
                      <label
                        htmlFor="onboarding-file-upload"
                        className={`flex flex-col items-center justify-center w-full h-36 border border-dashed rounded-md cursor-pointer transition-colors ${
                          isUploadingFile
                            ? 'border-rule dark:border-dark-border cursor-wait'
                            : 'border-rule dark:border-dark-border hover:border-primary-400 dark:hover:border-primary-500 hover:bg-panel/60 dark:hover:bg-dark-card/60'
                        }`}
                      >
                        {isUploadingFile ? (
                          <div className="flex flex-col items-center gap-2">
                            <Spinner className="w-6 h-6 text-primary-500" />
                            <span className="text-sm text-gray-500 dark:text-gray-400">Uploading and processing…</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2">
                            <svg className="w-6 h-6 text-gray-400 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                            </svg>
                            <span className="text-sm text-gray-600 dark:text-gray-300">
                              Click to select a file
                            </span>
                            <span className="text-[11px] uppercase tracking-[0.08em] font-sans text-gray-400 dark:text-gray-600">
                              .txt · .md · .csv · .json · .pdf
                            </span>
                          </div>
                        )}
                      </label>
                    </div>

                    {fileError && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">{fileError}</p>
                    )}
                  </Card>
                </div>
              )}

              {/* Import Results */}
              {importResults.length > 0 && (
                <div className="mb-8">
                  <p className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-3">
                    Imported ({importResults.length})
                  </p>
                  <div className="border-t border-rule dark:border-dark-border">
                    {importResults.map((result, idx) => (
                      <div
                        key={result.id || idx}
                        className="border-b border-rule dark:border-dark-border py-4"
                      >
                        {result.status === 'success' ? (
                          <>
                            <div className="flex items-center justify-between gap-3 mb-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <Badge variant="verified" label="Imported" />
                                <span className="font-serif text-ink dark:text-gray-100 truncate">
                                  {result.title || 'Untitled'}
                                </span>
                              </div>
                              <span className="text-[11px] uppercase tracking-[0.08em] font-sans font-medium text-gray-400 dark:text-gray-600 shrink-0">
                                {result.source === 'url' ? 'URL' : result.source === 'text' ? 'Text' : 'File'}
                              </span>
                            </div>
                            {result.url && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 truncate">
                                {result.url}
                              </p>
                            )}
                            {result.summary && (
                              <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3">
                                {result.summary}
                              </p>
                            )}
                          </>
                        ) : (
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-red-600 dark:text-red-400">
                                Failed
                              </span>
                              <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
                                {result.title || result.url || 'Unknown'}
                              </span>
                            </div>
                            {result.error && (
                              <p className="text-xs text-red-600 dark:text-red-400">{result.error}</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Navigation buttons */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentStep('profile')}
                  className="btn-secondary flex-1"
                >
                  Back
                </button>
                <button
                  onClick={() => setCurrentStep('topics')}
                  disabled={isSubmitting}
                  className="btn-primary flex-[2]"
                >
                  Continue
                </button>
              </div>

              <button
                type="button"
                onClick={handleSkipOnboarding}
                disabled={isSubmitting}
                className="w-full text-[11px] uppercase tracking-[0.08em] font-sans font-medium text-ink/40 dark:text-[#7A7264] hover:text-primary-600 dark:hover:text-primary-400 transition-colors mt-4"
              >
                Skip for now
              </button>
            </div>
          )}

          {/* STEP 4: Preset Topic Selection */}
          {currentStep === 'topics' && (
            <div>
              <StepHeading
                kicker="Step 04 · Topics"
                title="Choose where to begin"
                subtitle="Select 3–5 topics to explore first. These will guide your initial AI interviews."
              />

              <p
                className={`text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-center mb-8 ${
                  selectedTopicTitles.size >= 3 && selectedTopicTitles.size <= 5
                    ? 'text-primary-600 dark:text-primary-400'
                    : 'text-gray-400 dark:text-gray-600'
                }`}
              >
                {selectedTopicTitles.size} selected
                {selectedTopicTitles.size > 5 && ' — consider narrowing down'}
                {selectedTopicTitles.size > 0 && selectedTopicTitles.size < 3 &&
                  ` — choose at least ${3 - selectedTopicTitles.size} more`}
                {selectedTopicTitles.size === 0 && ' — choose at least 3'}
              </p>

              {presetError && (
                <p
                  className="text-sm text-red-600 dark:text-red-400 border-l-2 border-red-400 dark:border-red-500 pl-3 mb-6"
                  role="alert"
                  aria-live="assertive"
                >
                  {presetError}
                </p>
              )}

              {isLoadingPresets ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Spinner className="w-6 h-6 text-primary-500 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">Loading topics…</p>
                </div>
              ) : (
                <>
                  {/* Category Filter Tabs */}
                  <div className="flex flex-wrap gap-x-6 gap-y-2 mb-8 pb-3 border-b border-rule dark:border-dark-border">
                    <button
                      onClick={() => setActiveCategory(null)}
                      className={`text-[11px] uppercase tracking-[0.08em] font-sans font-semibold pb-1 border-b-2 transition-colors ${
                        activeCategory === null
                          ? 'border-primary-500 text-ink dark:text-gray-100'
                          : 'border-transparent text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400'
                      }`}
                    >
                      All ({presetTopics.length})
                    </button>
                    {categories.map((cat) => {
                      const info = CATEGORY_INFO[cat];
                      const count = presetTopics.filter((p) => p.category === cat).length;
                      if (count === 0) return null;
                      return (
                        <button
                          key={cat}
                          onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
                          className={`text-[11px] uppercase tracking-[0.08em] font-sans font-semibold pb-1 border-b-2 transition-colors ${
                            activeCategory === cat
                              ? 'border-primary-500 text-ink dark:text-gray-100'
                              : 'border-transparent text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400'
                          }`}
                        >
                          {info.label} ({count})
                        </button>
                      );
                    })}
                  </div>

                  {/* Topic cards — quiet editorial cards, amber ring/check for selection */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
                    {filteredPresets.map((preset) => {
                      const isSelected = selectedTopicTitles.has(preset.title);
                      const catInfo = CATEGORY_INFO[preset.category];
                      return (
                        <button
                          key={preset.title}
                          type="button"
                          onClick={() => toggleTopicSelection(preset.title)}
                          aria-pressed={isSelected}
                          className={`text-left p-5 rounded-md border bg-transparent transition-colors ${
                            isSelected
                              ? 'border-primary-500 dark:border-primary-400 ring-1 ring-primary-500/30'
                              : 'border-rule dark:border-dark-border hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <span className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400">
                              {catInfo?.label}
                            </span>
                            <span
                              className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                                isSelected
                                  ? 'border-primary-500 bg-primary-500'
                                  : 'border-gray-300 dark:border-gray-600'
                              }`}
                              aria-hidden="true"
                            >
                              {isSelected && (
                                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                          </div>
                          <h4 className="font-serif text-base text-ink dark:text-gray-100 mb-1">
                            {preset.title}
                          </h4>
                          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                            {preset.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Navigation buttons */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentStep('context')}
                  className="btn-secondary flex-1"
                >
                  Back
                </button>
                <button
                  onClick={handleSavePresetTopics}
                  disabled={isSavingTopics || isSubmitting}
                  className="btn-primary flex-[2]"
                >
                  {isSavingTopics || isSubmitting ? 'Finishing…' : 'Finish'}
                </button>
              </div>

              <button
                type="button"
                onClick={handleSkipOnboarding}
                disabled={isSubmitting || isSavingTopics}
                className="w-full text-[11px] uppercase tracking-[0.08em] font-sans font-medium text-ink/40 dark:text-[#7A7264] hover:text-primary-600 dark:hover:text-primary-400 transition-colors mt-4"
              >
                Skip for now
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Assessment Suggestion Overlay - shown after onboarding completion */}
      {showAssessmentSuggestion && (
        <div className="fixed inset-0 z-50 bg-paper dark:bg-dark-bg flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <div className="bg-white dark:bg-dark-card border border-rule dark:border-dark-border rounded-lg p-8">
              <p className="text-[11px] tracking-[0.16em] uppercase font-sans font-bold text-primary-600 dark:text-primary-400 mb-4">
                The Big Five
              </p>
              <h2 className="font-serif italic text-2xl sm:text-3xl text-ink dark:text-gray-100 mb-3">
                Discover your personality
              </h2>
              <p className="text-gray-600 dark:text-gray-300 mb-2">
                Take the Big Five personality assessment to add scientifically-validated personality insights to your profile.
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
                120 questions &middot; ~15 minutes &middot; Based on the IPIP-NEO model
              </p>

              <div className="space-y-3">
                <button
                  onClick={() => navigate('/app/personality', { replace: true })}
                  className="btn-primary w-full py-3 text-base"
                >
                  Take the Big Five Test
                </button>
                <button
                  onClick={() => navigate('/app/dashboard', { replace: true })}
                  className="btn-secondary w-full py-2.5"
                >
                  Skip for now &mdash; I&apos;ll do it later
                </button>
              </div>

              <p className="mt-4 text-[11px] uppercase tracking-[0.08em] font-sans text-ink/40 dark:text-[#7A7264]">
                You can always take the test from the sidebar menu
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
