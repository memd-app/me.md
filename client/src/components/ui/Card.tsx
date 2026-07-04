import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Whether the default card padding is applied (default: true) */
  padded?: boolean;
}

/**
 * Thin wrapper around the shared `.card` surface (hairline border, no shadow —
 * see DESIGN.md "Shape & depth"). Pass any div props through, including
 * `className` for one-off layout tweaks.
 */
export default function Card({
  padded = true,
  className = '',
  children,
  ...rest
}: CardProps) {
  return (
    <div className={`card ${padded ? '' : 'p-0'} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
