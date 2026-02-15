import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

type OnboardingStep = 'welcome' | 'profile' | 'context';

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
  url: string;
  status: 'success' | 'error';
  title?: string;
  summary?: string;
  error?: string;
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
];

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
  const [urlInput, setUrlInput] = useState('');
  const [isProcessingUrl, setIsProcessingUrl] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep);
  const progressPercent = ((currentStepIndex + 1) / STEPS.length) * 100;

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
        if (isNaN(date.getTime())) {
          errors.dateOfBirth = 'Invalid date';
          isValid = false;
        } else if (date > new Date()) {
          errors.dateOfBirth = 'Date of birth cannot be in the future';
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
        setImportResults((prev) => [...prev, ...data.results]);
      }

      setUrlInput('');
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Failed to process URL');
    } finally {
      setIsProcessingUrl(false);
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
      <div className="flex justify-center gap-6 pt-6 pb-4">
        {STEPS.map((step, index) => (
          <div key={step.key} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                index <= currentStepIndex
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
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
                  : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex items-start justify-center px-4 pt-4 pb-12">
        <div className="w-full max-w-lg">

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
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    AI-guided conversations extract your personal knowledge through proven questioning methods.
                  </p>
                </div>

                <div className="bg-white dark:bg-dark-card rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                  <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-2xl" role="img" aria-label="Verify">✅</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Verify</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    You&apos;re in full control. Review and verify every insight before it becomes part of your profile.
                  </p>
                </div>

                <div className="bg-white dark:bg-dark-card rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                  <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-2xl" role="img" aria-label="Manage">🧠</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Manage</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
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
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
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
              <p className="text-gray-600 dark:text-gray-400 mb-6 text-center">
                This helps personalize your AI interviews and knowledge extraction.
              </p>

              <form onSubmit={handleProfileSubmit} className="space-y-5">
                {serverError && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
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
                  />
                  {fieldErrors.name && (
                    <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>
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
                    max={new Date().toISOString().split('T')[0]}
                  />
                  {fieldErrors.dateOfBirth && (
                    <p className="mt-1 text-xs text-red-500">{fieldErrors.dateOfBirth}</p>
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
                  />
                  {fieldErrors.location && (
                    <p className="mt-1 text-xs text-red-500">{fieldErrors.location}</p>
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
                  />
                  {fieldErrors.occupation && (
                    <p className="mt-1 text-xs text-red-500">{fieldErrors.occupation}</p>
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
                  >
                    <option value="">Select gender</option>
                    {GENDER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.gender && (
                    <p className="mt-1 text-xs text-red-500">{fieldErrors.gender}</p>
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
                  className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors mt-2"
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
              <p className="text-gray-600 dark:text-gray-400 mb-6 text-center">
                Optionally import content from URLs to give the AI more context about you. This step is optional.
              </p>

              {/* URL Import */}
              <div className="bg-white dark:bg-dark-card rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">Import from URL</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Add links to your blog, portfolio, LinkedIn, or any page about you
                    </p>
                  </div>
                </div>

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
                  <p className="mt-2 text-xs text-red-500">{urlError}</p>
                )}
              </div>

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
                              {result.title || 'Untitled Page'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate">
                            {result.url}
                          </p>
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
                              Failed to process: {result.url}
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
                  onClick={handleCompleteOnboarding}
                  disabled={isSubmitting}
                  className="btn-primary flex-[2] py-2.5"
                >
                  {isSubmitting ? 'Finishing...' : importResults.length > 0 ? 'Complete Setup' : 'Skip & Complete Setup'}
                </button>
              </div>

              <button
                type="button"
                onClick={handleSkipOnboarding}
                disabled={isSubmitting}
                className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors mt-4"
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
