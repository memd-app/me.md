import type { ReactNode } from 'react';

interface SectionHeadingProps {
  /** Small-caps section label (e.g. "SESSIONS", "RELATED INSIGHTS") */
  children: ReactNode;
  className?: string;
}

/**
 * Small-caps section label + hairline rule extending to fill the remaining
 * width — the "SESSIONS" / "RELATED INSIGHTS" convention from the mockups.
 */
export default function SectionHeading({ children, className = '' }: SectionHeadingProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <span className="uppercase text-[11px] tracking-[0.08em] font-medium font-sans text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {children}
      </span>
      <span className="flex-1 border-t border-rule dark:border-dark-border" aria-hidden="true" />
    </div>
  );
}
