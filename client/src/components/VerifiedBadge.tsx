/**
 * Shared VerifiedBadge component for consistent display of verification status
 * across all views in the application.
 */

interface VerifiedBadgeProps {
  status: string; // 'verified' | 'unverified' | 'rejected' | 're_verification_pending'
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<string, {
  label: string;
  ariaLabel: string;
  bgClass: string;
  textClass: string;
  icon: 'check' | 'x' | 'clock' | 'none';
}> = {
  verified: {
    label: 'Verified',
    ariaLabel: 'Verified insight',
    bgClass: 'bg-green-100 dark:bg-green-900/30',
    textClass: 'text-green-700 dark:text-green-300',
    icon: 'check',
  },
  rejected: {
    label: 'Rejected',
    ariaLabel: 'Rejected insight',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
    textClass: 'text-red-700 dark:text-red-300',
    icon: 'x',
  },
  re_verification_pending: {
    label: 'Re-verify',
    ariaLabel: 'Re-verification pending',
    bgClass: 'bg-amber-100 dark:bg-amber-900/30',
    textClass: 'text-amber-700 dark:text-amber-300',
    icon: 'clock',
  },
  unverified: {
    label: 'Pending',
    ariaLabel: 'Pending verification',
    bgClass: 'bg-gray-100 dark:bg-gray-700',
    textClass: 'text-gray-600 dark:text-gray-400',
    icon: 'none',
  },
};

export default function VerifiedBadge({ status, size = 'sm', showLabel = true }: VerifiedBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.unverified;
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const padding = size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1';

  return (
    <span
      className={`inline-flex items-center gap-1 ${padding} rounded-full ${textSize} font-medium ${config.bgClass} ${config.textClass}`}
      role="status"
      aria-label={config.ariaLabel}
    >
      {config.icon === 'check' && (
        <svg className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
      {config.icon === 'x' && (
        <svg className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      {config.icon === 'clock' && (
        <svg className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}
      {showLabel && config.label}
    </span>
  );
}
