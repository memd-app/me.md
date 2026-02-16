import { useEffect, useCallback } from 'react';

/**
 * Hook that shows a browser "unsaved changes" warning (beforeunload)
 * when the user tries to refresh or close the tab while a form has dirty data.
 *
 * @param isDirty - Whether the form has unsaved changes
 * @param message - Optional custom message (most browsers ignore custom messages for security)
 */
export function useUnsavedChangesWarning(isDirty: boolean, message?: string) {
  const handleBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      // Standard way to trigger the browser's "Leave site?" dialog
      e.preventDefault();
      // For older browsers that respect a custom returnValue
      e.returnValue = message || 'You have unsaved changes. Are you sure you want to leave?';
      return e.returnValue;
    },
    [isDirty, message]
  );

  useEffect(() => {
    if (isDirty) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty, handleBeforeUnload]);
}

export default useUnsavedChangesWarning;
