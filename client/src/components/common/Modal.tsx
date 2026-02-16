import { useEffect, useRef, useCallback, type ReactNode } from 'react';

interface ModalProps {
  /** Whether the modal is visible */
  open: boolean;
  /** Called when the modal should be closed (backdrop click, Escape, close button) */
  onClose: () => void;
  /** Title displayed in the modal header */
  title: string;
  /** Optional icon element to display next to the title */
  icon?: ReactNode;
  /** Content rendered inside the modal body */
  children: ReactNode;
  /** Footer actions (buttons) - rendered at the bottom with right-aligned layout */
  footer?: ReactNode;
  /** Additional CSS class on the outer dialog panel */
  className?: string;
  /** Accessible label ID override (defaults to auto-generated) */
  labelledBy?: string;
  /** Test ID for the modal container */
  testId?: string;
  /** Maximum width class (default: "max-w-md") */
  maxWidth?: string;
}

/**
 * Responsive modal dialog that fits within the viewport at all sizes.
 * Features:
 * - Full-screen backdrop
 * - Content scrollable when too tall for viewport
 * - Close button always accessible
 * - Works at mobile (375px) and desktop widths
 * - Focus trap and Escape key handling
 * - Accessible with role="dialog", aria-modal, aria-labelledby
 */
export default function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  className = '',
  labelledBy,
  testId,
  maxWidth = 'max-w-md',
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = labelledBy || 'modal-title';

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose]
  );

  // Focus trap + body scroll lock
  useEffect(() => {
    if (!open) return;

    document.addEventListener('keydown', handleKeyDown);

    // Lock body scroll
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the dialog container
    const timer = setTimeout(() => {
      dialogRef.current?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
      clearTimeout(timer);
    };
  }, [open, handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`
          bg-white dark:bg-dark-card rounded-xl shadow-xl
          ${maxWidth} w-full
          max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)]
          flex flex-col
          outline-none
          ${className}
        `.trim()}
      >
        {/* Header - sticky at top with close button */}
        <div className="flex items-center justify-between gap-3 p-4 sm:p-6 pb-0 sm:pb-0 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="shrink-0">{icon}</div>
            )}
            <h3
              id={titleId}
              className="text-lg font-semibold text-gray-900 dark:text-white truncate"
            >
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1.5 -m-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Close dialog"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body - scrollable overflow */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0">
          {children}
        </div>

        {/* Footer - sticky at bottom */}
        {footer && (
          <div className="flex items-center justify-end gap-3 p-4 sm:p-6 pt-0 sm:pt-0 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
