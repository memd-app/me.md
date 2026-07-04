import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Small-caps amber kicker line above the title */
  kicker?: string;
  /** Page title, rendered as the editorial display serif */
  title: ReactNode;
  /** Serif-italic subtitle/deck below the title */
  subtitle?: ReactNode;
  /** Right-aligned actions (typically Button components) */
  actions?: ReactNode;
  className?: string;
}

/**
 * The editorial page header: amber kicker, large serif title, italic deck,
 * and a hairline rule closing out the block (DESIGN.md "Display" typography).
 */
export default function PageHeader({ kicker, title, subtitle, actions, className = '' }: PageHeaderProps) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-4 border-b border-rule dark:border-dark-border pb-6 mb-8 ${className}`.trim()}
    >
      <div className="min-w-0">
        {kicker && (
          <p className="uppercase text-[11px] tracking-[0.08em] font-medium font-sans text-primary-600 dark:text-primary-400 mb-2">
            {kicker}
          </p>
        )}
        <h1 className="font-serif text-3xl md:text-4xl text-gray-900 dark:text-white">{title}</h1>
        {subtitle && (
          <p className="font-serif italic text-gray-600 dark:text-gray-300 mt-2 max-w-2xl">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </div>
  );
}
