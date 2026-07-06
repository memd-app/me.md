import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useToast } from '../contexts/ToastContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import Modal from '@/components/common/Modal';
import { Badge, Button, EmptyState, PageHeader, SectionHeading } from '@/components/ui';
import { getInsightStats, getPendingInsights, getAllInsights, verifyInsight, rejectInsight, editInsight, getInsight } from '@/services/insights';
import { enqueueVaultWrite } from '@/services/vaultWriteThrough';
import { formatDateTime as sharedFormatDateTime, formatShortDate } from '@/utils/dateFormat';
import { groupPendingInsights, NO_TOPIC_KEY, type InsightGroup } from '@/utils/reviewGrouping';
import { computeNextActive, resolveTriageIntent } from '@/utils/reviewKeyboard';

const BULK_CHUNK_SIZE = 20;

type BulkKind = 'verify' | 'reject';

interface Insight {
  id: string;
  noteId: string;
  topicId: string | null;
  userId: string;
  content: string;
  confidenceScore: number | null;
  verificationStatus: string;
  privacyTier: string | null;
  extractionMethod: string | null; // 'ai' | 'fallback'
  sourceSessionId: string | null;
  verifiedAt: string | null;
  reVerifyAt: string | null;
  reVerifyInterval: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  topicTitle: string | null;
}

interface Stats {
  pending: number;
  verified: number;
  rejected: number;
  total: number;
}

interface EditState {
  insightId: string;
  editedContent: string;
  expectedUpdatedAt: string | null;
}

interface HistoryEntry {
  id: string;
  insightId: string;
  action: string;
  previousContent: string | null;
  newContent: string | null;
  createdAt: string | null;
}

interface HistoryState {
  insightId: string;
  entries: HistoryEntry[];
  loading: boolean;
}

export default function VerificationPage() {
  const { user } = useUser();
  const db = useDatabase();
  const { addToast } = useToast();
  const [pendingInsights, setPendingInsights] = useState<Insight[]>([]);
  const [verifiedInsights, setVerifiedInsights] = useState<Insight[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, verified: 0, rejected: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [historyState, setHistoryState] = useState<HistoryState | null>(null);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{
    kind: BulkKind;
    groupKey: string;
    groupName: string;
    total: number;
    done: number;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: BulkKind;
    group: InsightGroup;
  } | null>(null);
  const bulkCancelRef = useRef(false);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const previousVisibleIdsRef = useRef<string[]>([]);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    if (!user) return;
    try {
      setError(null);

      const statsData = getInsightStats(db);
      setStats(statsData);

      const pendingData = getPendingInsights(db);
      setPendingInsights(pendingData.insights || []);

      const verifiedData = getAllInsights(db, 'verified');
      setVerifiedInsights(verifiedData.insights || []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Failed to fetch verification data:', err);
      setError('Failed to load verification queue');
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData]);

  const groups = useMemo(() => groupPendingInsights(pendingInsights), [pendingInsights]);
  const visibleInsights = useMemo(
    () =>
      activeGroupKey
        ? pendingInsights.filter(insight => (insight.topicId ?? NO_TOPIC_KEY) === activeGroupKey)
        : pendingInsights,
    [activeGroupKey, pendingInsights],
  );
  const activeGroup = activeGroupKey ? groups.find(group => group.key === activeGroupKey) ?? null : null;

  const focusCard = useCallback((id: string | null) => {
    if (!id) return;
    window.setTimeout(() => {
      cardRefs.current.get(id)?.focus();
    }, 0);
  }, []);

  const approveOne = useCallback((id: string) => {
    verifyInsight(db, id);
    enqueueVaultWrite(db, id, 'verify');
  }, [db]);

  const rejectOne = useCallback((id: string) => {
    rejectInsight(db, id, 'Rejected by user');
    enqueueVaultWrite(db, id, 'reject');
  }, [db]);

  const handleApprove = useCallback((insightId: string) => {
    if (!user || bulk || actionInProgress) return;
    setActionInProgress(insightId);
    const orderIds = visibleInsights.map(insight => insight.id);
    try {
      approveOne(insightId);

      // Remove from pending list and update stats
      setPendingInsights(prev => prev.filter(i => i.id !== insightId));
      setStats(prev => ({
        ...prev,
        pending: prev.pending - 1,
        verified: prev.verified + 1,
      }));
      const nextId = computeNextActive(orderIds, insightId, 'approve');
      setActiveCardId(nextId);
      focusCard(nextId);
      addToast('Insight verified', 'success');
    } catch (err) {
      console.error('Failed to approve insight:', err);
      setError('Failed to approve insight');
      addToast('Failed to approve insight', 'error');
    } finally {
      setActionInProgress(null);
    }
  }, [actionInProgress, addToast, approveOne, bulk, focusCard, user, visibleInsights]);

  const handleReject = useCallback((insightId: string) => {
    if (!user || bulk || actionInProgress) return;
    setActionInProgress(insightId);
    const orderIds = visibleInsights.map(insight => insight.id);
    try {
      rejectOne(insightId);

      // Remove from pending list and update stats
      setPendingInsights(prev => prev.filter(i => i.id !== insightId));
      setStats(prev => ({
        ...prev,
        pending: prev.pending - 1,
        rejected: prev.rejected + 1,
      }));
      const nextId = computeNextActive(orderIds, insightId, 'reject');
      setActiveCardId(nextId);
      focusCard(nextId);
      addToast('Insight rejected', 'warning');
    } catch (err) {
      console.error('Failed to reject insight:', err);
      setError('Failed to reject insight');
      addToast('Failed to reject insight', 'error');
    } finally {
      setActionInProgress(null);
    }
  }, [actionInProgress, addToast, bulk, focusCard, rejectOne, user, visibleInsights]);

  const runBulk = useCallback(async (kind: BulkKind, group: InsightGroup) => {
    if (bulk) return;

    // Only act on insights still pending (a single-card action may have raced the confirm dialog).
    const pendingIdSet = new Set(pendingInsights.map(insight => insight.id));
    const ids = group.insightIds.filter(id => pendingIdSet.has(id));
    // A card being edited may be processed by this bulk run — clear the edit so
    // the editor state can't outlive its unmounted card and disable arrow triage.
    setEditState(prev => (prev && ids.includes(prev.insightId) ? null : prev));
    bulkCancelRef.current = false;
    setBulk({ kind, groupKey: group.key, groupName: group.name, total: ids.length, done: 0 });

    const processedIds: string[] = [];
    let flushedCount = 0;
    let done = 0;

    const flushProcessed = (batchIds: string[]) => {
      if (batchIds.length === 0) return;
      const processedSet = new Set(batchIds);
      setPendingInsights(prev => prev.filter(insight => !processedSet.has(insight.id)));
      setStats(prev =>
        kind === 'verify'
          ? { ...prev, pending: prev.pending - batchIds.length, verified: prev.verified + batchIds.length }
          : { ...prev, pending: prev.pending - batchIds.length, rejected: prev.rejected + batchIds.length }
      );
    };

    for (let i = 0; i < ids.length; i++) {
      if (bulkCancelRef.current) break;

      const id = ids[i];
      try {
        if (kind === 'verify') {
          approveOne(id);
        } else {
          rejectOne(id);
        }
        processedIds.push(id);
        done++;
      } catch (err) {
        console.error('Bulk item failed', id, err);
      }

      if ((i + 1) % BULK_CHUNK_SIZE === 0 || i === ids.length - 1) {
        const batchIds = processedIds.slice(flushedCount);
        flushProcessed(batchIds);
        flushedCount = processedIds.length;
        setBulk(current => current && ({ ...current, done }));
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }

    const finalBatchIds = processedIds.slice(flushedCount);
    flushProcessed(finalBatchIds);
    setBulk(current => current && ({ ...current, done }));

    const verb = kind === 'verify' ? 'Approved' : 'Rejected';
    addToast(
      bulkCancelRef.current
        ? `${verb} ${done} of ${ids.length} — cancelled`
        : `${verb} ${done} insight${done === 1 ? '' : 's'}`,
      kind === 'verify' ? 'success' : 'warning',
    );
    setBulk(null);

    const processedSet = new Set(processedIds);
    setActiveGroupKey(key => {
      if (key !== group.key) return key;
      const hasRemaining = pendingInsights.some(
        insight => (insight.topicId ?? NO_TOPIC_KEY) === group.key && !processedSet.has(insight.id),
      );
      return hasRemaining ? key : null;
    });
  }, [addToast, approveOne, bulk, pendingInsights, rejectOne]);

  const handleStartEdit = useCallback((insight: Insight) => {
    if (bulk) return;
    setEditState({ insightId: insight.id, editedContent: insight.content, expectedUpdatedAt: insight.updatedAt });
    // Focus textarea after render
    setTimeout(() => {
      editTextareaRef.current?.focus();
      // Move cursor to end
      if (editTextareaRef.current) {
        const len = editTextareaRef.current.value.length;
        editTextareaRef.current.setSelectionRange(len, len);
      }
    }, 50);
  }, [bulk]);

  const handleCancelEdit = () => {
    setEditState(null);
  };

  const handleSaveEdit = async () => {
    if (!user || !editState) return;
    if (editState.editedContent.trim() === '') {
      setError('Insight content cannot be empty');
      return;
    }

    setEditSaving(true);
    try {
      const data = editInsight(db, editState.insightId, {
          content: editState.editedContent.trim(),
          expectedUpdatedAt: editState.expectedUpdatedAt || undefined,
        });
      enqueueVaultWrite(db, editState.insightId, 'edit');

      // Update the insight in the pending list with new content
      setPendingInsights(prev =>
        prev.map(i =>
          i.id === editState.insightId
            ? { ...i, content: data.insight.content, updatedAt: data.insight.updatedAt }
            : i
        )
      );

      setEditState(null);
    } catch (err) {
      console.error('Failed to save insight edit:', err);
      setError(err instanceof Error ? err.message : 'Failed to save edit');
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleHistory = async (insightId: string) => {
    // Toggle off if already showing this insight's history
    if (historyState?.insightId === insightId) {
      setHistoryState(null);
      return;
    }

    if (!user) return;

    setHistoryState({ insightId, entries: [], loading: true });

    try {
      const data = getInsight(db, insightId);
      const history: HistoryEntry[] = data.verificationHistory || [];

      // Sort chronologically (oldest first) for timeline display
      history.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateA - dateB;
      });

      setHistoryState({ insightId, entries: history, loading: false });
    } catch (err) {
      console.error('Failed to fetch history:', err);
      setHistoryState({ insightId, entries: [], loading: false });
      setError('Failed to load verification history');
    }
  };

  useEffect(() => {
    if (activeGroupKey && !groups.some(group => group.key === activeGroupKey)) {
      setActiveGroupKey(null);
    }
  }, [activeGroupKey, groups]);

  useEffect(() => {
    const currentIds = visibleInsights.map(insight => insight.id);
    const previousIds = previousVisibleIdsRef.current;

    if (activeCardId && !currentIds.includes(activeCardId)) {
      const candidateId = computeNextActive(previousIds, activeCardId, 'remove');
      const nextId = candidateId && currentIds.includes(candidateId)
        ? candidateId
        : currentIds[0] ?? null;
      setActiveCardId(nextId);
      focusCard(nextId);
    }

    previousVisibleIdsRef.current = currentIds;
  }, [activeCardId, focusCard, visibleInsights]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const activeCardEl = activeCardId ? cardRefs.current.get(activeCardId) ?? null : null;
      const intent = resolveTriageIntent({
        key: e.key,
        hasActiveCard: !!activeCardId && el === activeCardEl,
        isEditing: editState !== null,
        isConfirmOpen: confirm !== null,
        isBulkRunning: bulk !== null,
        targetIsFormField: !!el && (
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable
        ),
      });

      if (!intent || !activeCardId) return;
      e.preventDefault();

      if (intent === 'approve') {
        handleApprove(activeCardId);
        return;
      }

      if (intent === 'reject') {
        handleReject(activeCardId);
        return;
      }

      if (intent === 'edit') {
        const insight = visibleInsights.find(item => item.id === activeCardId);
        if (insight) handleStartEdit(insight);
        return;
      }

      const nextId = computeNextActive(visibleInsights.map(insight => insight.id), activeCardId, 'next');
      setActiveCardId(nextId);
      focusCard(nextId);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    activeCardId,
    bulk,
    confirm,
    editState,
    focusCard,
    handleApprove,
    handleReject,
    handleStartEdit,
    visibleInsights,
  ]);

  const getActionLabel = (action: string): string => {
    switch (action) {
      case 'verified': return 'Verified';
      case 'rejected': return 'Rejected';
      case 'edited': return 'Edited';
      case 're_verified': return 'Re-verified';
      case 're_rejected': return 'Re-rejected';
      case 're_verification_triggered': return 'Re-verification triggered';
      default: return action;
    }
  };

  // Typographic status colors only — no badge boxes (DESIGN.md "Status semantics").
  const getActionColor = (action: string): string => {
    switch (action) {
      case 'verified':
      case 're_verified':
        return 'text-primary-600 dark:text-primary-400';
      case 'rejected':
      case 're_rejected':
        return 'text-gray-400 dark:text-gray-500 line-through';
      case 'edited':
        return 'text-gray-700 dark:text-gray-300';
      case 're_verification_triggered':
        return 'text-gray-500 dark:text-gray-400';
      default:
        return 'text-gray-500 dark:text-gray-400';
    }
  };

  const formatDateTime = (dateStr: string | null) => sharedFormatDateTime(dateStr);

  const getConfidenceLabel = (score: number | null) => {
    if (!score) return 'Unknown';
    if (score >= 80) return 'High';
    if (score >= 60) return 'Medium';
    return 'Low';
  };

  const formatDate = (dateStr: string | null) => formatShortDate(dateStr);

  const getOriginLabel = (origin: InsightGroup['origin']) => {
    switch (origin) {
      case 'session':
        return 'Session';
      case 'mixed':
        return 'Mixed';
      default:
        return 'Imported';
    }
  };

  const insightNoun = (count: number) => `insight${count === 1 ? '' : 's'}`;

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader title="Review" subtitle="Everything the interviewer extracted, awaiting your judgment." />
        <div className="flex gap-8 mb-10" aria-hidden="true">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="space-y-2">
              <div className="h-8 w-10 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
              <div className="h-2.5 w-20 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="card space-y-3" aria-hidden="true">
              <div className="h-4 w-3/4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
              <div className="h-3 w-1/3 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const neverExportCount = verifiedInsights.filter(i => i.privacyTier === 'never_export').length;
  const queueStats: Array<{ key: string; value: number; label: string; note?: string }> = [
    { key: 'pending', value: stats.pending, label: 'Awaiting review' },
    { key: 'verified', value: stats.verified, label: 'Verified' },
    { key: 'rejected', value: stats.rejected, label: 'Rejected' },
    { key: 'neverExport', value: neverExportCount, label: 'Never export', note: 'Managed in Settings' },
  ];
  const confirmCount = confirm?.group.count ?? 0;

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Review"
        subtitle="Everything the interviewer extracted, awaiting your judgment."
      />

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm
            ? `${confirm.kind === 'verify' ? 'Approve' : 'Reject'} all in ${confirm.group.name}`
            : 'Review source'
        }
        footer={confirm && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            {confirm.kind === 'verify' ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const payload = confirm;
                  setConfirm(null);
                  void runBulk(payload.kind, payload.group);
                }}
              >
                Approve {confirmCount}
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const payload = confirm;
                  setConfirm(null);
                  void runBulk(payload.kind, payload.group);
                }}
                className="inline-flex items-center px-3.5 py-1.5 text-sm font-semibold text-gray-600 dark:text-gray-400 border border-rule dark:border-dark-border rounded-md hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-400 dark:hover:border-primary-500 transition-colors disabled:opacity-50"
              >
                Reject {confirmCount}
              </button>
            )}
          </>
        )}
      >
        {confirm && (
          <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            {confirm.kind === 'verify'
              ? `This verifies ${confirmCount} ${insightNoun(confirmCount)} and writes each to your vault. You can still edit or reject any of them afterward.`
              : `This rejects ${confirmCount} ${insightNoun(confirmCount)}. Rejected insights are removed from your profile export.`}
          </p>
        )}
      </Modal>

      {/* Error message */}
      {error && (
        <ApiErrorAlert
          message={error}
          onDismiss={() => setError(null)}
          className="mb-6"
        />
      )}

      {/* Queue status — editorial numerals, like the Desk's "At a glance" */}
      <section aria-label="Queue status" className="mb-10">
        <SectionHeading className="mb-5">Queue status</SectionHeading>
        <div className="flex flex-wrap gap-y-6">
          {queueStats.map((item, idx) => (
            <div
              key={item.key}
              className={`min-w-[130px] px-6 first:pl-0 last:pr-0 ${
                idx !== queueStats.length - 1 ? 'border-r border-rule dark:border-dark-border' : ''
              }`}
            >
              <p className="font-serif italic font-medium text-3xl leading-none text-gray-900 dark:text-white">
                {item.value}
              </p>
              <p className="mt-2 text-[11px] tracking-[0.08em] uppercase font-sans font-semibold text-gray-500 dark:text-gray-400">
                {item.label}
              </p>
              {item.note && (
                <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-600">{item.note}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {groups.length > 0 && (
        <section aria-label="Review by source" className="mb-10">
          <SectionHeading className="mb-4">Review by source</SectionHeading>
          <div className="border-y border-rule dark:border-dark-border divide-y divide-rule dark:divide-dark-border">
            {groups.map(group => {
              const isActive = activeGroupKey === group.key;
              const groupBulk = bulk?.groupKey === group.key ? bulk : null;
              const progressPercent = groupBulk && groupBulk.total > 0
                ? Math.round((groupBulk.done / groupBulk.total) * 100)
                : 0;

              return (
                <div
                  key={group.key}
                  className={`py-4 transition-colors ${
                    isActive ? 'bg-panel/60 dark:bg-dark-card/60 px-4 -mx-4' : ''
                  }`}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h2 className="font-serif text-xl leading-tight text-gray-900 dark:text-white truncate">
                          {group.name}
                        </h2>
                        <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-500 dark:text-gray-400">
                          {getOriginLabel(group.origin)}
                        </span>
                        <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-primary-600 dark:text-primary-400">
                          {group.count}
                        </span>
                      </div>
                      {group.preview.length > 0 && (
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 truncate">
                          {group.preview.join(' · ')}
                        </p>
                      )}
                    </div>

                    {groupBulk ? (
                      <div className="sm:min-w-[220px]" aria-live="polite">
                        <div className="flex items-center justify-end gap-3">
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            {groupBulk.done} of {groupBulk.total}…
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              bulkCancelRef.current = true;
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                        <div className="mt-2 h-px bg-rule dark:bg-dark-border">
                          <div
                            className="h-px bg-primary-500 transition-[width] duration-150"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            if (!bulk) setConfirm({ kind: 'verify', group });
                          }}
                          disabled={bulk !== null}
                        >
                          Approve all ({group.count})
                        </Button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!bulk) setConfirm({ kind: 'reject', group });
                          }}
                          disabled={bulk !== null}
                          className="inline-flex items-center px-3.5 py-1.5 text-sm font-semibold text-gray-600 dark:text-gray-400 border border-rule dark:border-dark-border rounded-md hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-400 dark:hover:border-primary-500 transition-colors disabled:opacity-50"
                        >
                          Reject all ({group.count})
                        </button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setActiveGroupKey(group.key)}
                          disabled={bulk !== null}
                        >
                          Review individually
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {pendingInsights.length === 0 ? (
        <EmptyState
          message="Nothing awaiting review. Finish an interview session and new insights will land here."
          className="py-16"
        />
      ) : (
        <div className="space-y-5">
          {activeGroup && (
            <div className="inline-flex items-center gap-2 rounded-sm border border-rule dark:border-dark-border px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400">
              <span>
                <span className="text-[11px] uppercase tracking-[0.08em] font-semibold">Showing:</span> {activeGroup.name}
              </span>
              <button
                type="button"
                onClick={() => setActiveGroupKey(null)}
                aria-label="Clear source filter"
                className="text-gray-400 hover:text-primary-600 dark:text-gray-500 dark:hover:text-primary-400 transition-colors"
              >
                ×
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {visibleInsights.length} insight{visibleInsights.length !== 1 ? 's' : ''} awaiting review
            </p>
          </div>
          {/* Keyboard navigation hint */}
          <p className="text-xs text-gray-400 dark:text-gray-600 hidden lg:block" aria-hidden="true">
            <kbd className="px-1.5 py-0.5 rounded-sm border border-rule dark:border-dark-border text-gray-500 dark:text-gray-400 font-mono text-[10px]">Tab</kbd> to navigate review actions
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-600 hidden lg:block" aria-hidden="true">
            <kbd className="px-1.5 py-0.5 rounded-sm border border-rule dark:border-dark-border text-gray-500 dark:text-gray-400 font-mono text-[10px]">→</kbd> approve · <kbd className="px-1.5 py-0.5 rounded-sm border border-rule dark:border-dark-border text-gray-500 dark:text-gray-400 font-mono text-[10px]">←</kbd> reject · <kbd className="px-1.5 py-0.5 rounded-sm border border-rule dark:border-dark-border text-gray-500 dark:text-gray-400 font-mono text-[10px]">↑</kbd> edit · <kbd className="px-1.5 py-0.5 rounded-sm border border-rule dark:border-dark-border text-gray-500 dark:text-gray-400 font-mono text-[10px]">↓</kbd> next
          </p>
          {visibleInsights.length === 0 ? (
            <EmptyState
              message="No insights in this source. Clear the source filter to return to the full queue."
              className="py-16"
            />
          ) : visibleInsights.map(insight => (
            <div
              key={insight.id}
              role="article"
              tabIndex={0}
              aria-keyshortcuts="ArrowRight ArrowLeft ArrowUp ArrowDown"
              aria-label={`Insight: ${insight.content.substring(0, 80)}${insight.content.length > 80 ? '…' : ''}. Use the review action buttons to approve, edit, reject, or view history.`}
              ref={node => {
                if (node) {
                  cardRefs.current.set(insight.id, node);
                } else {
                  cardRefs.current.delete(insight.id);
                }
              }}
              onFocus={() => setActiveCardId(insight.id)}
              onBlur={(e) => {
                const nextTarget = e.relatedTarget;
                if (!(nextTarget instanceof Node) || !e.currentTarget.contains(nextTarget)) {
                  setActiveCardId(current => current === insight.id ? null : current);
                }
              }}
              className={`card hover:border-gray-300 dark:hover:border-gray-600 transition-colors focus:outline-none ${
                activeCardId === insight.id ? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-paper dark:ring-offset-dark-bg' : ''
              }`}
            >
              {/* Insight content - view or edit mode */}
              <div className="mb-4">
                {editState?.insightId === insight.id ? (
                  <div className="space-y-3">
                    <textarea
                      ref={editTextareaRef}
                      value={editState.editedContent}
                      onChange={(e) => setEditState({ ...editState, editedContent: e.target.value })}
                      aria-label="Edit insight content"
                      className="input-field font-serif leading-relaxed resize-y min-h-[80px]"
                      rows={3}
                      disabled={editSaving || bulk !== null}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          handleCancelEdit();
                        }
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSaveEdit}
                        loading={editSaving}
                        disabled={editSaving || bulk !== null || editState.editedContent.trim() === '' || editState.editedContent.trim() === insight.content}
                        aria-label="Save edited insight"
                      >
                        Save
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleCancelEdit}
                        disabled={editSaving || bulk !== null}
                        aria-label="Cancel editing"
                      >
                        Cancel
                      </Button>
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                        Press Escape to cancel
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="font-serif text-lg leading-relaxed text-gray-900 dark:text-white break-words">
                    {insight.content}
                  </p>
                )}
              </div>

              {/* Metadata row */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-4 text-xs text-gray-500 dark:text-gray-400">
                {/* Confidence score */}
                <span>{insight.confidenceScore}% confidence ({getConfidenceLabel(insight.confidenceScore)})</span>

                {/* Extraction method indicator — only shown for fallback */}
                {insight.extractionMethod === 'fallback' && (
                  <>
                    <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">&middot;</span>
                    <span title="This insight was extracted using rule-based pattern matching instead of AI. It may be lower quality — please review carefully.">
                      <Badge variant="neutral" label="Rule-based" />
                    </span>
                  </>
                )}

                {/* Source topic */}
                {insight.topicTitle && (
                  <>
                    <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">&middot;</span>
                    <span className="truncate max-w-[200px]">{insight.topicTitle}</span>
                  </>
                )}

                {/* Source session reference */}
                {insight.sourceSessionId && (
                  <>
                    <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">&middot;</span>
                    <span>Session</span>
                  </>
                )}

                {/* Date */}
                {insight.createdAt && (
                  <>
                    <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">&middot;</span>
                    <span>{formatDate(insight.createdAt)}</span>
                  </>
                )}

                {/* Privacy tier indicator — passive small-caps marker, managed in Settings (single owner) */}
                <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">&middot;</span>
                <span
                  className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.08em] font-medium ${
                    insight.privacyTier === 'never_export'
                      ? 'text-gray-500 dark:text-gray-400'
                      : 'text-primary-600 dark:text-primary-400'
                  }`}
                  title="Privacy tier is managed in Settings"
                >
                  {insight.privacyTier === 'never_export' ? 'Never export' : 'Exportable'}
                </span>
              </div>

              {/* Action buttons - hidden during edit mode */}
              {editState?.insightId !== insight.id && (
                <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-rule dark:border-dark-border" role="group" aria-label="Insight actions">
                  {/* Quick approve button */}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleApprove(insight.id)}
                    loading={actionInProgress === insight.id}
                    disabled={actionInProgress === insight.id || bulk !== null}
                    aria-label="Approve this insight"
                  >
                    Approve
                  </Button>

                  {/* Edit button */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleStartEdit(insight)}
                    disabled={actionInProgress === insight.id || bulk !== null}
                    aria-label="Edit this insight"
                  >
                    Edit
                  </Button>

                  {/* Reject button — ink-on-rule, turns accent on hover (DESIGN.md; no dedicated red outside confirmations) */}
                  <button
                    onClick={() => handleReject(insight.id)}
                    disabled={actionInProgress === insight.id || bulk !== null}
                    aria-label="Reject this insight"
                    className="inline-flex items-center px-3.5 py-1.5 text-sm font-semibold text-gray-600 dark:text-gray-400 border border-rule dark:border-dark-border rounded-md hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-400 dark:hover:border-primary-500 transition-colors disabled:opacity-50"
                  >
                    Reject
                  </button>

                  {/* History button - pushed to the right */}
                  <button
                    onClick={() => handleToggleHistory(insight.id)}
                    aria-label={`View verification history${historyState?.insightId === insight.id ? ' (open)' : ''}`}
                    aria-expanded={historyState?.insightId === insight.id}
                    className={`ml-auto text-[11px] font-bold uppercase tracking-wide transition-colors ${
                      historyState?.insightId === insight.id
                        ? 'text-primary-600 dark:text-primary-400'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                    title="View verification history"
                  >
                    History
                  </button>
                </div>
              )}

              {/* Verification History Timeline */}
              {historyState?.insightId === insight.id && (
                <div className="mt-4 pt-4 border-t border-rule dark:border-dark-border">
                  <SectionHeading className="mb-4">Verification history</SectionHeading>

                  {historyState.loading ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Loading history&hellip;</p>
                  ) : historyState.entries.length === 0 ? (
                    <p className="font-serif italic text-sm text-gray-500 dark:text-gray-400">
                      No verification history yet. This insight has not been verified, edited, or rejected.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {historyState.entries.map((entry, idx) => (
                        <div key={entry.id} className="grid grid-cols-[1.5rem_1fr] gap-3">
                          {/* Numbered editorial marker */}
                          <span className="text-xs font-semibold text-gray-300 dark:text-gray-700 pt-0.5">
                            {String(idx + 1).padStart(2, '0')}
                          </span>

                          {/* Content */}
                          <div className="min-w-0 pb-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className={`text-[11px] font-bold uppercase tracking-wide ${getActionColor(entry.action)}`}>
                                {getActionLabel(entry.action)}
                              </span>
                              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                {formatDateTime(entry.createdAt)}
                              </span>
                              {idx === historyState.entries.length - 1 && (
                                <span className="text-[10.5px] uppercase tracking-wide text-gray-400 dark:text-gray-600">
                                  Latest
                                </span>
                              )}
                            </div>

                            {/* Show content diff for edits */}
                            {entry.action === 'edited' && entry.previousContent && entry.newContent && (
                              <div className="mt-1.5 space-y-1 text-xs">
                                <p className="break-words">
                                  <span className="text-gray-400 dark:text-gray-500 font-semibold">Before: </span>
                                  <span className="text-gray-400 dark:text-gray-500 line-through">{entry.previousContent}</span>
                                </p>
                                <p className="break-words">
                                  <span className="text-gray-700 dark:text-gray-300 font-semibold">After: </span>
                                  <span className="text-gray-700 dark:text-gray-300">{entry.newContent}</span>
                                </p>
                              </div>
                            )}

                            {/* Show info for re-verification triggers */}
                            {entry.action === 're_verification_triggered' && entry.newContent && (
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {entry.newContent}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
