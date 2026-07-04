type BadgeVariant = 'verified' | 'pending' | 'rejected' | 'neutral';

interface BadgeProps {
  /** Which typographic status treatment to render (DESIGN.md "Status semantics") */
  variant: BadgeVariant;
  /** Overrides the default label text for the variant */
  label?: string;
  /** Optional confidence percentage, appended as "· 92% CONFIDENCE" */
  confidence?: number;
  /** Compact (11px) or cozy (12px) small-caps sizing (default: 'sm') */
  size?: 'sm' | 'md';
  className?: string;
}

const DEFAULT_LABEL: Record<BadgeVariant, string> = {
  verified: 'Verified',
  pending: 'Awaiting review',
  rejected: 'Rejected',
  neutral: 'Status',
};

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  verified: 'text-primary-600 dark:text-primary-400',
  pending: 'text-gray-500 dark:text-gray-400',
  rejected: 'text-gray-400 dark:text-gray-500 line-through',
  neutral: 'text-gray-500 dark:text-gray-400',
};

const SMALL_CAPS = 'uppercase tracking-[0.08em] font-medium font-sans';
const TEXT_SIZE = { sm: 'text-[11px]', md: 'text-xs' } as const;
const ICON_SIZE = { sm: 'w-3 h-3', md: 'w-3.5 h-3.5' } as const;

/**
 * Status is shown typographically (small caps + accent or muting), never as
 * a colored pill — see DESIGN.md "Status semantics".
 */
export default function Badge({ variant, label, confidence, size = 'sm', className = '' }: BadgeProps) {
  // An empty label means icon-only — but only 'verified' has an icon, so
  // other variants fall back to their default label rather than vanishing.
  const text = label === '' && variant !== 'verified' ? DEFAULT_LABEL[variant] : (label ?? DEFAULT_LABEL[variant]);
  const ariaText = text || DEFAULT_LABEL[variant];
  const ariaLabel = typeof confidence === 'number' ? `${ariaText}, ${confidence}% confidence` : ariaText;

  return (
    <span
      className={`inline-flex items-center gap-1 ${SMALL_CAPS} ${TEXT_SIZE[size]} ${VARIANT_CLASSES[variant]} ${className}`.trim()}
      role="status"
      aria-label={ariaLabel}
    >
      {variant === 'verified' && (
        <svg className={`${ICON_SIZE[size]} shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      )}
      {text && <span>{text}</span>}
      {typeof confidence === 'number' && (
        <span className="text-gray-500 dark:text-gray-400">· {confidence}% confidence</span>
      )}
    </span>
  );
}
