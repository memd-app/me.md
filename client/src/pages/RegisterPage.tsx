import { useState, useMemo, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const { register, error, clearError } = useAuth();
  const navigate = useNavigate();

  const validatePassword = (pw: string): string | null => {
    if (pw.length < 8) return 'Password must be at least 8 characters';
    if (!/\d/.test(pw)) return 'Password must contain at least 1 number';
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) return 'Password must contain at least 1 special character';
    return null;
  };

  // Real-time password requirement checks
  const passwordChecks = useMemo(() => {
    if (!password) return { length: false, number: false, special: false };
    return {
      length: password.length >= 8,
      number: /\d/.test(password),
      special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
    };
  }, [password]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setValidationError('');

    // Validate password
    const pwError = validatePassword(password);
    if (pwError) {
      setValidationError(pwError);
      return;
    }

    if (password !== confirmPassword) {
      setValidationError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);

    try {
      await register({ email, password, name });
      navigate('/onboarding', { replace: true });
    } catch {
      // Error is handled by AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayError = validationError || error;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-dark-bg px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="text-3xl font-bold text-primary-600">
            me.md
          </Link>
          <p className="mt-2 text-gray-600 dark:text-gray-300">
            Create your account
          </p>
        </div>

        {/* Form */}
        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-5">
            {displayError && (
              <div id="register-error" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm flex items-start gap-2" role="alert" aria-live="assertive">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-medium">{displayError}</p>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Full name
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => { setName(e.target.value); if (error) clearError(); }}
                className="input-field"
                placeholder="Your full name"
                autoComplete="name"
                aria-describedby={displayError ? 'register-error' : undefined}
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (error) clearError(); if (validationError) setValidationError(''); }}
                className="input-field"
                placeholder="you@example.com"
                autoComplete="email"
                aria-describedby={displayError ? 'register-error' : undefined}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => { setPassword(e.target.value); setPasswordTouched(true); }}
                onBlur={() => setPasswordTouched(true)}
                className="input-field"
                placeholder="Min 8 chars, 1 number, 1 special char"
                autoComplete="new-password"
                aria-describedby={displayError ? 'register-error' : undefined}
              />
              {/* Real-time password requirement indicators */}
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-1.5 text-xs" data-testid="pw-check-length">
                  {password.length > 0 || passwordTouched ? (
                    passwordChecks.length ? (
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    )
                  ) : (
                    <span className="w-3.5 h-3.5 flex items-center justify-center text-gray-400">•</span>
                  )}
                  <span className={password.length > 0 || passwordTouched ? (passwordChecks.length ? 'text-green-700 dark:text-green-300' : 'text-red-600 dark:text-red-400') : 'text-gray-600 dark:text-gray-300'}>
                    At least 8 characters
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs" data-testid="pw-check-number">
                  {password.length > 0 || passwordTouched ? (
                    passwordChecks.number ? (
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    )
                  ) : (
                    <span className="w-3.5 h-3.5 flex items-center justify-center text-gray-400">•</span>
                  )}
                  <span className={password.length > 0 || passwordTouched ? (passwordChecks.number ? 'text-green-700 dark:text-green-300' : 'text-red-600 dark:text-red-400') : 'text-gray-600 dark:text-gray-300'}>
                    At least 1 number
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs" data-testid="pw-check-special">
                  {password.length > 0 || passwordTouched ? (
                    passwordChecks.special ? (
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    )
                  ) : (
                    <span className="w-3.5 h-3.5 flex items-center justify-center text-gray-400">•</span>
                  )}
                  <span className={password.length > 0 || passwordTouched ? (passwordChecks.special ? 'text-green-700 dark:text-green-300' : 'text-red-600 dark:text-red-400') : 'text-gray-600 dark:text-gray-300'}>
                    At least 1 special character
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field"
                placeholder="Repeat your password"
                autoComplete="new-password"
                aria-describedby={displayError ? 'register-error' : undefined}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary w-full"
            >
              {isSubmitting ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Already have an account?{' '}
              <Link to="/login" className="text-primary-600 hover:text-primary-500 font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
