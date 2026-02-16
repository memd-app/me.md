import { useState } from 'react';
import Modal from './common/Modal';

interface SessionExpiredModalProps {
  open: boolean;
  onReLogin: (email: string, password: string) => Promise<void>;
  onLogout: () => void;
  userEmail?: string;
}

/**
 * Modal shown when the user's session token has expired and cannot be refreshed.
 * Offers the user a choice to re-authenticate or log out.
 */
export default function SessionExpiredModal({
  open,
  onReLogin,
  onLogout,
  userEmail,
}: SessionExpiredModalProps) {
  const [email, setEmail] = useState(userEmail || '');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await onReLogin(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onLogout}
      title="Session Expired"
      testId="session-expired-modal"
      icon={
        <svg className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
      }
      footer={
        <div className="flex items-center gap-3 w-full justify-end">
          <button
            type="button"
            onClick={onLogout}
            className="btn-secondary px-4 py-2 text-sm rounded-lg"
          >
            Sign Out
          </button>
          <button
            type="submit"
            form="reauth-form"
            disabled={isLoading || !email || !password}
            className="btn-primary px-4 py-2 text-sm rounded-lg disabled:opacity-50"
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Your session has expired for security reasons. Please sign in again to continue.
        </p>

        {error && (
          <div className="p-3 text-sm text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-lg">
            {error}
          </div>
        )}

        <form id="reauth-form" onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              htmlFor="reauth-email"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Email
            </label>
            <input
              id="reauth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark-bg text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label
              htmlFor="reauth-password"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Password
            </label>
            <input
              id="reauth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark-bg text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
          </div>
        </form>
      </div>
    </Modal>
  );
}
