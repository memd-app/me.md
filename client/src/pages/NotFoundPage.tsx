import { Link, useLocation } from 'react-router-dom';

/**
 * NotFoundPage - A styled 404 page that adapts based on context.
 *
 * When rendered inside /app/* (within AppLayout with sidebar), it shows
 * a compact version with navigation back to the dashboard.
 *
 * When rendered at the top level (e.g., /random-path), it shows a
 * full-screen version with navigation back to the home page.
 */
export default function NotFoundPage() {
  const location = useLocation();
  const isInsideApp = location.pathname.startsWith('/app');

  // Inside /app layout - compact version (sidebar is already present)
  if (isInsideApp) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="card max-w-md w-full text-center">
          {/* 404 icon */}
          <div className="mx-auto w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-6">
            <svg className="w-8 h-8 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          <h1 className="text-5xl font-bold text-primary-600 dark:text-primary-400 mb-3">404</h1>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Page not found
          </h2>
          <p className="text-gray-600 dark:text-gray-300 mb-2">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-6 font-mono break-all">
            {location.pathname}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/app/dashboard" className="btn-primary text-center">
              Go to the Desk
            </Link>
            <Link to="/" className="btn-secondary text-center">
              Go to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Top-level 404 - full-screen version
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-dark-bg px-4">
      <div className="card max-w-md w-full text-center">
        {/* 404 icon */}
        <div className="mx-auto w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h1 className="text-5xl font-bold text-primary-600 dark:text-primary-400 mb-3">404</h1>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          Page not found
        </h2>
        <p className="text-gray-600 dark:text-gray-300 mb-2">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-6 font-mono break-all">
          {location.pathname}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/" className="btn-primary text-center">
            Go to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
