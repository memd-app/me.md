import { useState, useRef, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

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

const CATEGORY_INFO: Record<string, { label: string; icon: string; color: string }> = {
  identity: { label: 'Identity', icon: '🪪', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
  skills: { label: 'Skills', icon: '🛠️', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' },
  experiences: { label: 'Experiences', icon: '📖', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
  perspectives: { label: 'Perspectives', icon: '💡', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' },
  goals: { label: 'Goals', icon: '🎯', color: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' },
};

export default function OnboardingPage() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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
  const progressPercent = ((currentStepIndex + 1) / STEPS.length) * 100;

  // Load preset topics when entering topics step
  useEffect(() => {
    if (currentStep === 'topics' && presetTopics.length === 0) {
      loadPresetTopics();
    }
  }, [currentStep]);

  const loadPresetTopics = async () => {
    setIsLoadingPresets(true);
    setPresetError('');
    try {
      const userId = user?.id;
      if (!userId) return;

      const res = await fetch('/api/topics/presets', {
        headers: { 'x-user-id': userId },
      });

      if (!res.ok) {
        throw new Error('Failed to load preset topics');
      }

      const data = await res.json();
      setPresetTopics(data.presets || []);

      // Pre-select already selected presets
      const alreadySelected = (data.presets || [])
        .filter((p: PresetTopic) => p.alreadySelected)
        .map((p: PresetTopic) => p.title);
      if (alreadySelected.length > 0) {
        setSelectedTopicTitles(new Set(alreadySelected));
      }
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : 'Failed to load topics');
    } finally {
      setIsLoadingPresets(false);
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
      const userId = user?.id;
      if (!userId) return;

      const res = await fetch('/api/topics/presets/select', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          selectedTopics: Array.from(selectedTopicTitles),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save topics');
      }

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
      const userId = user?.id;
      if (!userId) {
        setServerError('Not authenticated. Please log in again.');
        return;
      }

      // Save profile fields
      const profileRes = await fetch('/api/users/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          name: profileFields.name.trim(),
          dateOfBirth: profileFields.dateOfBirth.trim(),
          location: profileFields.location.trim(),
          occupation: profileFields.occupation.trim(),
          gender: profileFields.gender.trim(),
        }),
      });

      if (!profileRes.ok) {
        const data = await profileRes.json();
        throw new Error(data.error || 'Failed to save profile');
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
      const userId = user?.id;
      if (!userId) {
        setUrlError('Not authenticated');
        return;
      }

      const res = await fetch('/api/import/urls', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({ urls: [trimmedUrl] }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to process URL');
      }

      const data = await res.json();

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
      const userId = user?.id;
      if (!userId) {
        setPasteError('Not authenticated');
        return;
      }

      const res = await fetch('/api/import/text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          text: trimmedText,
          title: pasteTitle.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to import text');
      }

      const data = await res.json();

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
      const userId = user?.id;
      if (!userId) {
        setFileError('Not authenticated');
        return;
      }

      // Validate file size (5MB)
      if (file.size > 5 * 1024 * 1024) {
        setFileError('File too large. Maximum size is 5MB.');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/import/file', {
        method: 'POST',
        headers: {
          'x-user-id': userId,
        },
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to upload file');
      }

      const data = await res.json();

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

  const handleCompleteOnboarding = async () => {
    setIsSubmitting(true);
    try {
      const userId = user?.id;
      if (!userId) return;

      const res = await fetch('/api/users/onboarding/complete', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          updateUser(data.user);
        }
        navigate('/app', { replace: true });
      }
    } catch {
      navigate('/app', { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipOnboarding = async () => {
    setIsSubmitting(true);
    try {
      const userId = user?.id;
      if (!userId) return;

      const res = await fetch('/api/users/onboarding/complete', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          updateUser(data.user);
        }
        navigate('/app', { replace: true });
      }
    } catch {
      navigate('/app', { replace: true });
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
    <div className="min-h-screen bg-gray-50 dark:bg-dark-bg flex flex-col">
      {/* Progress bar */}
      <div className="w-full bg-gray-200 dark:bg-gray-700 h-1.5">
        <div
          className="bg-primary-600 h-1.5 transition-all duration-500 ease-out"
          style={{ width: `${progressPercent}%` }}
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Onboarding progress"
        />
      </div>

      {/* Step indicators */}
      <div className="flex justify-center gap-4 sm:gap-6 pt-6 pb-4">
        {STEPS.map((step, index) => (
          <div key={step.key} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                index <= currentStepIndex
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300'
              }`}
            >
              {index < currentStepIndex ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                index + 1
              )}
            </div>
            <span
              className={`text-sm font-medium hidden sm:inline ${
                index <= currentStepIndex
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-gray-500 dark:text-gray-300'
              }`}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex items-start justify-center px-4 pt-4 pb-12">
        <div className={`w-full ${currentStep === 'topics' ? 'max-w-2xl' : 'max-w-lg'}`}>

          {/* STEP 1: Welcome */}
          {currentStep === 'welcome' && (
            <div className="text-center">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
                Welcome to me.md
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-300 mb-8">
                Your personal knowledge system. Let&apos;s get you set up in just a few steps.
              </p>

              {/* Three Pillars */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                <div className="bg-white dark:bg-dark-card rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                  <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-2xl" role="img" aria-label="Create">💬</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Create</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    AI-guided conversations extract your personal knowledge through proven questioning methods.
                  </p>
                </div>

                <div className="bg-white dark:bg-dark-card rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                  <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-2xl" role="img" aria-label="Verify">✅</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Verify</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    You&apos;re in full control. Review and verify every insight before it becomes part of your profile.
                  </p>
                </div>

                <div className="bg-white dark:bg-dark-card rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                  <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-2xl" role="img" aria-label="Manage">🧠</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Manage</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Build a living knowledge graph and export your context for any AI tool.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => setCurrentStep('profile')}
                  className="btn-primary w-full py-3 text-base"
                >
                  Get Started
                </button>
                <button
                  onClick={handleSkipOnboarding}
                  disabled={isSubmitting}
                  className="text-sm text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  Skip for now
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Profile Fields */}
          {currentStep === 'profile' && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 text-center">
                Tell us about yourself
              </h2>
              <p className="text-gray-600 dark:text-gray-300 mb-6 text-center">
                This helps personalize your AI interviews and knowledge extraction.
              </p>

              <form onSubmit={handleProfileSubmit} className="space-y-5">
                {serverError && (
                  <div id="onboarding-server-error" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm" role="alert" aria-live="assertive">
                    {serverError}
                  </div>
                )}

                {/* Name */}
                <div>
                  <label htmlFor="ob-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="ob-name"
                    type="text"
                    value={profileFields.name}
                    onChange={(e) => handleFieldChange('name', e.target.value)}
                    className={`input-field ${fieldErrors.name ? 'border-red-500 dark:border-red-500' : ''}`}
                    placeholder="Your full name"
                    autoComplete="name"
                    aria-describedby={fieldErrors.name ? 'ob-name-error' : undefined}
                    aria-invalid={fieldErrors.name ? true : undefined}
                  />
                  {fieldErrors.name && (
                    <p id="ob-name-error" className="mt-1 text-xs text-red-500" role="alert">{fieldErrors.name}</p>
                  )}
                </div>

                {/* Date of Birth */}
                <div>
                  <label htmlFor="ob-dob" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Date of Birth <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="ob-dob"
                    type="date"
                    value={profileFields.dateOfBirth}
                    onChange={(e) => handleFieldChange('dateOfBirth', e.target.value)}
                    className={`input-field ${fieldErrors.dateOfBirth ? 'border-red-500 dark:border-red-500' : ''}`}
                    min="1900-01-01"
                    max={new Date().toISOString().split('T')[0]}
                    aria-describedby={fieldErrors.dateOfBirth ? 'ob-dob-error' : 'ob-dob-hint'}
                    aria-invalid={fieldErrors.dateOfBirth ? true : undefined}
                  />
                  <p id="ob-dob-hint" className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Must be between 1900 and today
                  </p>
                  {fieldErrors.dateOfBirth && (
                    <p id="ob-dob-error" className="mt-1 text-xs text-red-500" role="alert">{fieldErrors.dateOfBirth}</p>
                  )}
                </div>

                {/* Location */}
                <div>
                  <label htmlFor="ob-location" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Location <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="ob-location"
                    type="text"
                    value={profileFields.location}
                    onChange={(e) => handleFieldChange('location', e.target.value)}
                    className={`input-field ${fieldErrors.location ? 'border-red-500 dark:border-red-500' : ''}`}
                    placeholder="City, Country"
                    autoComplete="address-level2"
                    aria-describedby={fieldErrors.location ? 'ob-location-error' : undefined}
                    aria-invalid={fieldErrors.location ? true : undefined}
                  />
                  {fieldErrors.location && (
                    <p id="ob-location-error" className="mt-1 text-xs text-red-500" role="alert">{fieldErrors.location}</p>
                  )}
                </div>

                {/* Occupation */}
                <div>
                  <label htmlFor="ob-occupation" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Occupation <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="ob-occupation"
                    type="text"
                    value={profileFields.occupation}
                    onChange={(e) => handleFieldChange('occupation', e.target.value)}
                    className={`input-field ${fieldErrors.occupation ? 'border-red-500 dark:border-red-500' : ''}`}
                    placeholder="Your job title or role"
                    autoComplete="organization-title"
                    aria-describedby={fieldErrors.occupation ? 'ob-occupation-error' : undefined}
                    aria-invalid={fieldErrors.occupation ? true : undefined}
                  />
                  {fieldErrors.occupation && (
                    <p id="ob-occupation-error" className="mt-1 text-xs text-red-500" role="alert">{fieldErrors.occupation}</p>
                  )}
                </div>

                {/* Gender */}
                <div>
                  <label htmlFor="ob-gender" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Gender <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="ob-gender"
                    value={profileFields.gender}
                    onChange={(e) => handleFieldChange('gender', e.target.value)}
                    className={`input-field ${fieldErrors.gender ? 'border-red-500 dark:border-red-500' : ''}`}
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
                    <p id="ob-gender-error" className="mt-1 text-xs text-red-500" role="alert">{fieldErrors.gender}</p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setCurrentStep('welcome')}
                    className="flex-1 py-2.5 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn-primary flex-[2] py-2.5"
                  >
                    {isSubmitting ? 'Saving...' : 'Next'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSkipOnboarding}
                  disabled={isSubmitting}
                  className="w-full text-sm text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 transition-colors mt-2"
                >
                  Skip for now
                </button>
              </form>
            </div>
          )}

          {/* STEP 3: Context Import */}
          {currentStep === 'context' && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 text-center">
                Import existing context
              </h2>
              <p className="text-gray-600 dark:text-gray-300 mb-6 text-center">
                Optionally import content to give the AI more context about you. This step is optional.
              </p>

              {/* Import Method Tabs */}
              <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
                <button
                  type="button"
                  onClick={() => setActiveImportTab('url')}
                  className={`flex-1 py-2.5 px-3 text-sm font-medium border-b-2 transition-colors ${
                    activeImportTab === 'url'
                      ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                      : 'border-transparent text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    URL
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveImportTab('text')}
                  className={`flex-1 py-2.5 px-3 text-sm font-medium border-b-2 transition-colors ${
                    activeImportTab === 'text'
                      ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                      : 'border-transparent text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Paste Text
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveImportTab('file')}
                  className={`flex-1 py-2.5 px-3 text-sm font-medium border-b-2 transition-colors ${
                    activeImportTab === 'file'
                      ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                      : 'border-transparent text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Upload File
                  </span>
                </button>
              </div>

              {/* URL Import Tab */}
              {activeImportTab === 'url' && (
                <div className="bg-white dark:bg-dark-card rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 mb-6">
                  <p className="text-xs text-gray-500 dark:text-gray-300 mb-4">
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
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Processing...
                        </span>
                      ) : (
                        'Add URL'
                      )}
                    </button>
                  </form>

                  {urlError && (
                    <p className="mt-2 text-xs text-red-500" role="alert">{urlError}</p>
                  )}
                </div>
              )}

              {/* Paste Text Tab */}
              {activeImportTab === 'text' && (
                <div className="bg-white dark:bg-dark-card rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 mb-6">
                  <p className="text-xs text-gray-500 dark:text-gray-300 mb-4">
                    Paste text about yourself - a bio, interests, resume excerpt, or anything that describes you
                  </p>

                  <form onSubmit={handleTextSubmit} className="space-y-3">
                    <input
                      type="text"
                      value={pasteTitle}
                      onChange={(e) => setPasteTitle(e.target.value)}
                      className="input-field w-full"
                      placeholder="Title (optional) - e.g., My Bio, Personal Interests"
                      disabled={isProcessingText}
                    />
                    <textarea
                      value={pasteText}
                      onChange={(e) => {
                        setPasteText(e.target.value);
                        setPasteError('');
                      }}
                      className="input-field w-full min-h-[120px] resize-y"
                      placeholder="Paste your text here... For example, a paragraph about your interests, career, hobbies, or anything you'd like the AI to know about you."
                      disabled={isProcessingText}
                      rows={5}
                    />
                    {pasteText.trim().length > 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-300">
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
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Processing...
                        </span>
                      ) : (
                        'Import Text'
                      )}
                    </button>
                  </form>

                  {pasteError && (
                    <p className="mt-2 text-xs text-red-500" role="alert">{pasteError}</p>
                  )}
                </div>
              )}

              {/* File Upload Tab */}
              {activeImportTab === 'file' && (
                <div className="bg-white dark:bg-dark-card rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 mb-6">
                  <p className="text-xs text-gray-500 dark:text-gray-300 mb-4">
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
                      className={`flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                        isUploadingFile
                          ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 cursor-wait'
                          : 'border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      {isUploadingFile ? (
                        <div className="flex flex-col items-center gap-2">
                          <svg className="animate-spin w-8 h-8 text-primary-600" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span className="text-sm text-gray-600 dark:text-gray-300">Uploading and processing...</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <svg className="w-8 h-8 text-gray-500 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                          <span className="text-sm text-gray-600 dark:text-gray-300">
                            Click to select a file
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-300">
                            .txt, .md, .csv, .json, .pdf
                          </span>
                        </div>
                      )}
                    </label>
                  </div>

                  {fileError && (
                    <p className="mt-2 text-xs text-red-500" role="alert">{fileError}</p>
                  )}
                </div>
              )}

              {/* Import Results */}
              {importResults.length > 0 && (
                <div className="space-y-3 mb-6">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Imported Content ({importResults.length})
                  </h4>
                  {importResults.map((result, idx) => (
                    <div
                      key={result.id || idx}
                      className={`rounded-lg p-4 border ${
                        result.status === 'success'
                          ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
                          : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                      }`}
                    >
                      {result.status === 'success' ? (
                        <>
                          <div className="flex items-center gap-2 mb-1">
                            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="font-medium text-sm text-gray-900 dark:text-white">
                              {result.title || 'Untitled'}
                            </span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">
                              {result.source === 'url' ? 'URL' : result.source === 'text' ? 'Text' : 'File'}
                            </span>
                          </div>
                          {result.url && (
                            <p className="text-xs text-gray-500 dark:text-gray-300 mb-2 truncate">
                              {result.url}
                            </p>
                          )}
                          {result.summary && (
                            <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3">
                              {result.summary}
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          <div>
                            <span className="text-sm text-red-700 dark:text-red-400">
                              Failed to process: {result.title || result.url || 'Unknown'}
                            </span>
                            {result.error && (
                              <p className="text-xs text-red-500 mt-0.5">{result.error}</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Navigation buttons */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentStep('profile')}
                  className="flex-1 py-2.5 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium"
                >
                  Back
                </button>
                <button
                  onClick={() => setCurrentStep('topics')}
                  disabled={isSubmitting}
                  className="btn-primary flex-[2] py-2.5"
                >
                  {importResults.length > 0 ? 'Next: Choose Topics' : 'Skip & Choose Topics'}
                </button>
              </div>

              <button
                type="button"
                onClick={handleSkipOnboarding}
                disabled={isSubmitting}
                className="w-full text-sm text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 transition-colors mt-4"
              >
                Skip for now
              </button>
            </div>
          )}

          {/* STEP 4: Preset Topic Selection */}
          {currentStep === 'topics' && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 text-center">
                Choose your starter topics
              </h2>
              <p className="text-gray-600 dark:text-gray-300 mb-2 text-center">
                Select 3-5 topics to explore first. These will guide your initial AI interviews.
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
                {selectedTopicTitles.size} selected {selectedTopicTitles.size >= 3 && selectedTopicTitles.size <= 5 ? '✓' : selectedTopicTitles.size > 5 ? '(consider narrowing down)' : `(select at least ${3 - selectedTopicTitles.size} more)`}
              </p>

              {presetError && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-4" role="alert" aria-live="assertive">
                  {presetError}
                </div>
              )}

              {isLoadingPresets ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <svg className="animate-spin w-8 h-8 text-primary-600 mb-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <p className="text-sm text-gray-500 dark:text-gray-300">Loading topics...</p>
                </div>
              ) : (
                <>
                  {/* Category Filter Tabs */}
                  <div className="flex flex-wrap gap-2 mb-6">
                    <button
                      onClick={() => setActiveCategory(null)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        activeCategory === null
                          ? 'bg-primary-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
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
                          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                            activeCategory === cat
                              ? 'bg-primary-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          {info.icon} {info.label} ({count})
                        </button>
                      );
                    })}
                  </div>

                  {/* Topic Cards Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                    {filteredPresets.map((preset) => {
                      const isSelected = selectedTopicTitles.has(preset.title);
                      const catInfo = CATEGORY_INFO[preset.category];
                      return (
                        <button
                          key={preset.title}
                          type="button"
                          onClick={() => toggleTopicSelection(preset.title)}
                          className={`text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                            isSelected
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 shadow-sm'
                              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-card hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catInfo.color}`}>
                                {catInfo.icon} {catInfo.label}
                              </span>
                            </div>
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                              isSelected
                                ? 'border-primary-500 bg-primary-500'
                                : 'border-gray-300 dark:border-gray-600'
                            }`}>
                              {isSelected && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                          </div>
                          <h4 className={`font-semibold text-sm mb-1 ${
                            isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-900 dark:text-white'
                          }`}>
                            {preset.title}
                          </h4>
                          <p className="text-xs text-gray-500 dark:text-gray-300 line-clamp-2">
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
                  className="flex-1 py-2.5 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium"
                >
                  Back
                </button>
                <button
                  onClick={handleSavePresetTopics}
                  disabled={isSavingTopics || isSubmitting}
                  className="btn-primary flex-[2] py-2.5"
                >
                  {isSavingTopics || isSubmitting ? 'Finishing...' : selectedTopicTitles.size > 0 ? `Complete Setup (${selectedTopicTitles.size} topics)` : 'Skip & Complete Setup'}
                </button>
              </div>

              <button
                type="button"
                onClick={handleSkipOnboarding}
                disabled={isSubmitting || isSavingTopics}
                className="w-full text-sm text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 transition-colors mt-4"
              >
                Skip for now
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
