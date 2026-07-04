import type { ButtonHTMLAttributes } from 'react';
import LoadingSpinner from '@/components/common/LoadingSpinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style of the button (default: 'primary') */
  variant?: ButtonVariant;
  /** Button size (default: 'md') */
  size?: ButtonSize;
  /** Shows an inline spinner and disables interaction while true */
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost:
    'bg-transparent text-ink hover:text-primary-600 dark:text-gray-200 dark:hover:text-primary-400 ' +
    'px-4 py-2 rounded-md font-medium transition-colors duration-200 ' +
    'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'text-sm px-3 py-1.5',
  md: '',
};

/**
 * Shared button component covering the three Modern Editorial actions:
 * filled ink (primary), hairline ghost (secondary) and text-only (ghost).
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-2 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`.trim()}
      {...rest}
    >
      {loading && <LoadingSpinner size="sm" />}
      {children}
    </button>
  );
}
