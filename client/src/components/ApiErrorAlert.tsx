/**
 * ApiErrorAlert — a reusable, user-friendly error alert component.
 *
 * Shows a clear, non-technical message for any API / server error,
 * with an optional "Try Again" retry button and a dismiss (×) button.
 * Intended to replace raw error strings throughout the app.
 */

interface ApiErrorAlertProps {
  /** The error message to display (will be mapped to a friendly message if it looks technical) */
  message: string;
  /** Optional callback to retry the failed action */
  onRetry?: () => void;
  /** Optional callback to dismiss the alert */
  onDismiss?: () => void;
  /** Optional custom class name */
  className?: string;
}

/**
 * Map raw / technical error messages to user-friendly alternatives.
 * If the message already looks user-friendly, it is returned as-is.
 */
function friendlyMessage(raw: string): string {
  const lower = raw.toLowerCase();

  // Network / connection errors
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('unable to connect')) {
    return 'The network request didn\'t go through. Check your internet connection and try again.';
  }

  // Explicit 500 / internal server error
  if (lower.includes('internal server error') || lower.includes('status 500') || lower === '500') {
    return 'Something unexpected went wrong. Try again in a moment — if it keeps happening, please open an issue on GitHub.';
  }

  // Generic "something went wrong" from backend
  if (lower === 'something went wrong') {
    return 'Something went wrong. Please try again shortly.';
  }

  // Timeout
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The request took too long to complete. Please try again.';
  }

  // If the message looks like a stack trace or technical jargon, replace it
  if (
    lower.includes('unexpected token') ||
    lower.includes('syntax error') ||
    lower.includes('cannot read properties') ||
    lower.includes('undefined is not') ||
    lower.includes('typeerror') ||
    lower.includes('referenceerror') ||
    lower.startsWith('error:')
  ) {
    return 'An unexpected error occurred. Please try again — if it keeps happening, please open an issue on GitHub.';
  }

  // Return the original if it already looks human-readable
  return raw;
}

export default function ApiErrorAlert({ message, onRetry, onDismiss, className = '' }: ApiErrorAlertProps) {
  const friendly = friendlyMessage(message);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 ${className}`}
    >
      <div className="flex items-start gap-3">
        {/* Error icon */}
        <svg
          className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500"
          fill="currentColor"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>

        {/* Message + actions */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{friendly}</p>

          {/* Action buttons */}
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Try again
            </button>
          )}
        </div>

        {/* Dismiss button */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="flex-shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
            aria-label="Dismiss error"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
