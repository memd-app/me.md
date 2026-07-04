import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** The quiet editorial message, rendered serif italic */
  message: ReactNode;
  /** Optional small-caps kicker line above the message */
  kicker?: string;
  /** Optional action slot rendered below the message */
  action?: ReactNode;
  className?: string;
}

/**
 * Quiet, editorial empty state — serif italic message rather than an icon +
 * bold headline, per DESIGN.md's "serif italic for anything inviting
 * reflection" signature move.
 */
export default function EmptyState({ message, kicker, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className}`.trim()}>
      {kicker && (
        <p className="uppercase text-[11px] tracking-[0.08em] font-medium font-sans text-gray-500 dark:text-gray-400 mb-3">
          {kicker}
        </p>
      )}
      <p className="font-serif italic text-lg md:text-xl text-gray-600 dark:text-gray-300 max-w-md">
        {message}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
