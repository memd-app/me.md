export type TriageIntent = 'approve' | 'reject' | 'edit' | 'next';

export interface KeyGuardContext {
  key: string;
  hasActiveCard: boolean;
  isEditing: boolean;
  isConfirmOpen: boolean;
  isBulkRunning: boolean;
  targetIsFormField: boolean;
}

export function resolveTriageIntent(ctx: KeyGuardContext): TriageIntent | null {
  if (
    !ctx.hasActiveCard ||
    ctx.isEditing ||
    ctx.isConfirmOpen ||
    ctx.isBulkRunning ||
    ctx.targetIsFormField
  ) {
    return null;
  }

  switch (ctx.key) {
    case 'ArrowRight':
      return 'approve';
    case 'ArrowLeft':
      return 'reject';
    case 'ArrowUp':
      return 'edit';
    case 'ArrowDown':
      return 'next';
    default:
      return null;
  }
}

export function computeNextActive(
  orderedIds: string[],
  activeId: string | null,
  action: 'approve' | 'reject' | 'remove' | 'next' | 'edit',
): string | null {
  if (action === 'edit') return activeId;
  if (orderedIds.length === 0) return null;

  const currentIndex = activeId ? orderedIds.indexOf(activeId) : -1;

  if (action === 'next') {
    if (currentIndex === -1) return orderedIds[0] ?? null;
    return orderedIds[Math.min(currentIndex + 1, orderedIds.length - 1)] ?? null;
  }

  if (currentIndex === -1) return orderedIds[0] ?? null;

  const remainingIds = orderedIds.filter(id => id !== activeId);
  return remainingIds[currentIndex] ?? remainingIds[remainingIds.length - 1] ?? null;
}
