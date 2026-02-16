interface LoadingSpinnerProps {
  /** Size of the spinner */
  size?: 'sm' | 'md' | 'lg';
  /** Optional message to show below the spinner */
  message?: string;
  /** Additional CSS classes for the container */
  className?: string;
  /** Whether to center the spinner in a card container */
  card?: boolean;
}

const sizeClasses = {
  sm: 'w-4 h-4 border-2',
  md: 'w-8 h-8 border-4',
  lg: 'w-10 h-10 border-4',
};

/**
 * Consistent loading spinner component used across all pages.
 * Uses the primary color theme (primary-200/primary-600) for consistency.
 */
export default function LoadingSpinner({
  size = 'md',
  message,
  className = '',
  card = false,
}: LoadingSpinnerProps) {
  const spinner = (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div
        className={`animate-spin inline-block ${sizeClasses[size]} border-primary-200 border-t-primary-600 rounded-full ${message ? 'mb-3' : ''}`}
        role="status"
        aria-label={message || 'Loading'}
      />
      {message && (
        <p className="text-gray-600 dark:text-gray-300 text-sm">{message}</p>
      )}
    </div>
  );

  if (card) {
    return (
      <div className="card text-center py-12">
        {spinner}
      </div>
    );
  }

  return spinner;
}
