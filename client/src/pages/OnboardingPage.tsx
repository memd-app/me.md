import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

type OnboardingStep = 'welcome' | 'profile';

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
];

export default function OnboardingPage() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [profileFields, setProfileFields] = useState<ProfileFields>({
    name: user?.name || '',
    dateOfBirth: user?.dateOfBirth && user.dateOfBirth !== '2000-01-01' ? user.dateOfBirth : '',
    location: user?.location && user.location !== 'Unknown' ? user.location : '',
    occupation: user?.occupation && user.occupation !== 'Unknown' ? user.occupation : '',
    gender: user?.gender && user.gender !== 'unspecified' ? user.gender : '',
  });

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

      // Mark onboarding as complete
      const completeRes = await fetch('/api/users/onboarding/complete', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
      });

      if (!completeRes.ok) {
        const data = await completeRes.json();
        throw new Error(data.error || 'Failed to complete onboarding');
      }

      const completeData = await completeRes.json();

      // Update user in auth context
      if (completeData.user) {
        updateUser(completeData.user);
      }

      // Navigate to dashboard
      navigate('/app', { replace: true });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFieldChange = (field: keyof ProfileFields, value: string) => {
    setProfileFields((prev) => ({ ...prev, [field]: value }));
    // Clear error for this field when user starts typing
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
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
      // Fallback: navigate anyway
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
      <div className="flex justify-center gap-8 pt-6 pb-4">
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
              className={`text-sm font-medium ${
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
                    <span className="text-2xl">💬</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Create</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    AI-guided conversations extract your personal knowledge through proven questioning methods.
                  </p>
                </div>

                <div className="bg-white dark:bg-dark-card rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                  <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-2xl">✅</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Verify</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    You&apos;re in full control. Review and verify every insight before it becomes part of your profile.
                  </p>
                </div>

                <div className="bg-white dark:bg-dark-card rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                  <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-2xl">🧠</span>
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
                    {isSubmitting ? 'Saving...' : 'Complete Setup'}
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
        </div>
      </div>
    </div>
  );
}
