import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useToast } from '../contexts/ToastContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import ConflictsSection from '../components/verification/ConflictsSection';
import SwipeableCard from '../components/verification/SwipeableCard';
import { Badge, Button, EmptyState, PageHeader, SectionHeading } from '@/components/ui';
import { getInsightStats, getPendingInsights, getAllInsights, verifyInsight, rejectInsight, editInsight, getInsight } from '@/services/insights';
import { formatDateTime as sharedFormatDateTime, formatShortDate } from '@/utils/dateFormat';

interface Insight {
  id: string;
  noteId: string;
  topicId: string;
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

  // Batch review mode state
  const [batchMode, setBatchMode] = useState(false);
  const [batchIndex, setBatchIndex] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchReviewed, setBatchReviewed] = useState(0);
  const [batchInsights, setBatchInsights] = useState<Insight[]>([]);

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

  const handleApprove = async (insightId: string) => {
    if (!user) return;
    setActionInProgress(insightId);
    try {
      verifyInsight(db, insightId);

      // Remove from pending list and update stats
      setPendingInsights(prev => prev.filter(i => i.id !== insightId));
      setStats(prev => ({
        ...prev,
        pending: prev.pending - 1,
        verified: prev.verified + 1,
      }));
      addToast('Insight approved and verified successfully!', 'success');
    } catch (err) {
      console.error('Failed to approve insight:', err);
      setError('Failed to approve insight');
      addToast('Failed to approve insight', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReject = async (insightId: string) => {
    if (!user) return;
    setActionInProgress(insightId);
    try {
      rejectInsight(db, insightId, 'Rejected by user');

      // Remove from pending list and update stats
      setPendingInsights(prev => prev.filter(i => i.id !== insightId));
      setStats(prev => ({
        ...prev,
        pending: prev.pending - 1,
        rejected: prev.rejected + 1,
      }));
      addToast('Insight rejected', 'warning');
    } catch (err) {
      console.error('Failed to reject insight:', err);
      setError('Failed to reject insight');
      addToast('Failed to reject insight', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStartEdit = (insight: Insight) => {
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
  };

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

  // ============================================
  // Batch Review Mode Handlers
  // ============================================

  const startBatchReview = () => {
    if (pendingInsights.length === 0) return;
    // Snapshot the current pending insights for the batch
    setBatchInsights([...pendingInsights]);
    setBatchTotal(pendingInsights.length);
    setBatchIndex(0);
    setBatchReviewed(0);
    setBatchMode(true);
    // Reset edit/history state
    setEditState(null);
    setHistoryState(null);
  };

  const exitBatchReview = () => {
    setBatchMode(false);
    setBatchInsights([]);
    setBatchIndex(0);
    setBatchReviewed(0);
    setBatchTotal(0);
    setEditState(null);
    setHistoryState(null);
  };

  const advanceBatch = () => {
    setBatchReviewed(prev => prev + 1);
    setEditState(null);
    setHistoryState(null);
    // Find the next insight that hasn't been acted on yet
    // We check against the current pendingInsights which gets updated as items are approved/rejected
    setBatchIndex(prev => prev + 1);
  };

  const handleBatchApprove = async (insightId: string) => {
    await handleApprove(insightId);
    // Remove from batchInsights too
    setBatchInsights(prev => prev.map(i => i.id === insightId ? { ...i, verificationStatus: '_done' } : i));
    advanceBatch();
  };

  const handleBatchReject = async (insightId: string) => {
    await handleReject(insightId);
    setBatchInsights(prev => prev.map(i => i.id === insightId ? { ...i, verificationStatus: '_done' } : i));
    advanceBatch();
  };

  const handleBatchSaveEditAndContinue = async () => {
    await handleSaveEdit();
    // After save, mark as reviewed and advance
    if (editState) {
      setBatchInsights(prev => prev.map(i => i.id === editState.insightId ? { ...i, verificationStatus: '_done' } : i));
    }
    advanceBatch();
  };

  // Get the current batch insight (skipping already-done ones)
  const getCurrentBatchInsight = (): Insight | null => {
    if (!batchMode || batchInsights.length === 0) return null;
    // Find the next un-acted insight starting from batchIndex
    for (let i = batchIndex; i < batchInsights.length; i++) {
      if (batchInsights[i].verificationStatus !== '_done') {
        // Update batchIndex if we skipped some
        if (i !== batchIndex) setBatchIndex(i);
        return batchInsights[i];
      }
    }
    return null; // All done
  };

  const currentBatchInsight = batchMode ? getCurrentBatchInsight() : null;
  const batchComplete = batchMode && currentBatchInsight === null;

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

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader title="Verification queue" subtitle="Review and verify AI-extracted insights." />
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
    { key: 'pending', value: stats.pending, label: 'Pending review' },
    { key: 'verified', value: stats.verified, label: 'Verified' },
    { key: 'rejected', value: stats.rejected, label: 'Rejected' },
    { key: 'neverExport', value: neverExportCount, label: 'Never export', note: 'Managed in Settings' },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Verification queue"
        subtitle="Review and verify AI-extracted insights."
        actions={
          !batchMode && pendingInsights.length >= 2 ? (
            <Button variant="secondary" size="sm" onClick={startBatchReview}>
              Start batch review ({pendingInsights.length})
            </Button>
          ) : undefined
        }
      />

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

      {/* Batch Review Mode */}
      {batchMode && (
        batchComplete ? (
          <div className="text-center py-16 border-y border-rule dark:border-dark-border">
            <p className="text-[11px] tracking-[0.16em] uppercase font-sans font-bold text-primary-600 dark:text-primary-400 mb-3">
              Batch review
            </p>
            <h2 className="font-serif italic font-medium text-3xl text-gray-900 dark:text-white mb-3">
              Queue cleared.
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
              You reviewed <span className="font-serif italic text-lg text-primary-600 dark:text-primary-400">{batchReviewed}</span> of {batchTotal} insights.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button variant="primary" onClick={exitBatchReview}>
                Back to queue
              </Button>
              {pendingInsights.length > 0 && (
                <Button variant="secondary" onClick={startBatchReview}>
                  Review remaining ({pendingInsights.length})
                </Button>
              )}
            </div>
          </div>
        ) : currentBatchInsight && (() => {
          const insight = currentBatchInsight;
          return (
            <div className="space-y-6">
              {/* Batch progress indicator */}
              <div className="border border-rule dark:border-dark-border bg-panel dark:bg-dark-card rounded-lg px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-baseline gap-3">
                    <span className="text-[11px] tracking-[0.14em] uppercase font-sans font-bold text-primary-600 dark:text-primary-400">
                      Batch review
                    </span>
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {batchReviewed + 1} of {batchTotal}
                    </span>
                  </div>
                  <button
                    onClick={exitBatchReview}
                    className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                  >
                    Exit batch
                  </button>
                </div>
                {/* Thin amber hairline fill, not a bar */}
                <div className="h-[2px] bg-rule dark:bg-dark-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 dark:bg-primary-400 rounded-full transition-all duration-300"
                    style={{ width: `${(batchReviewed / batchTotal) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                  <span>{batchReviewed} reviewed</span>
                  <span>{batchTotal - batchReviewed} remaining</span>
                </div>
              </div>

              {/* Single insight card in focus */}
              <div className="card">
                {/* Insight content - view or edit mode */}
                <div className="mb-5">
                  {editState?.insightId === insight.id ? (
                    <div className="space-y-3">
                      <textarea
                        ref={editTextareaRef}
                        value={editState.editedContent}
                        onChange={(e) => setEditState({ ...editState, editedContent: e.target.value })}
                        className="input-field font-serif text-lg leading-relaxed resize-y min-h-[100px]"
                        rows={4}
                        disabled={editSaving}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleBatchSaveEditAndContinue}
                          loading={editSaving}
                          disabled={editSaving || editState.editedContent.trim() === '' || editState.editedContent.trim() === insight.content}
                        >
                          Save &amp; continue
                        </Button>
                        <Button variant="secondary" size="sm" onClick={handleCancelEdit} disabled={editSaving}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="font-serif text-lg leading-relaxed text-gray-900 dark:text-white break-words">
                      {insight.content}
                    </p>
                  )}
                </div>

                {/* Metadata */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-5 text-xs text-gray-500 dark:text-gray-400">
                  <span>{insight.confidenceScore}% confidence ({getConfidenceLabel(insight.confidenceScore)})</span>
                  {insight.extractionMethod === 'fallback' && (
                    <>
                      <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">&middot;</span>
                      <span title="This insight was extracted using rule-based pattern matching instead of AI. It may be lower quality — please review carefully.">
                        <Badge variant="neutral" label="Rule-based" />
                      </span>
                    </>
                  )}
                  {insight.topicTitle && (
                    <>
                      <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">&middot;</span>
                      <span className="truncate max-w-[200px]">{insight.topicTitle}</span>
                    </>
                  )}
                  {insight.createdAt && (
                    <>
                      <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">&middot;</span>
                      <span>{formatDate(insight.createdAt)}</span>
                    </>
                  )}
                </div>

                {/* Batch action buttons */}
                {editState?.insightId !== insight.id && (
                  <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-rule dark:border-dark-border">
                    <Button
                      variant="primary"
                      onClick={() => handleBatchApprove(insight.id)}
                      loading={actionInProgress === insight.id}
                      disabled={actionInProgress === insight.id}
                    >
                      Approve
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={() => handleStartEdit(insight)}
                      disabled={actionInProgress === insight.id}
                    >
                      Edit &amp; continue
                    </Button>

                    <button
                      onClick={() => handleBatchReject(insight.id)}
                      disabled={actionInProgress === insight.id}
                      className="inline-flex items-center px-5 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-400 border border-rule dark:border-dark-border rounded-md hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-400 dark:hover:border-primary-500 transition-colors disabled:opacity-50"
                    >
                      Reject
                    </button>

                    {/* Skip button for batch mode */}
                    <button
                      onClick={advanceBatch}
                      className="ml-auto text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                    >
                      Skip &rarr;
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()
      )}

      {/* Pending insights list (Verification Queue view) - hidden in batch mode */}
      {!batchMode && (
        pendingInsights.length === 0 ? (
          <EmptyState
            message="No insights to verify. Complete interview sessions to generate insights for verification."
            className="py-16"
          />
        ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {pendingInsights.length} insight{pendingInsights.length !== 1 ? 's' : ''} awaiting review
            </p>
          </div>
          {/* Keyboard navigation hint */}
          <p className="text-xs text-gray-400 dark:text-gray-600 hidden lg:block" aria-hidden="true">
            <kbd className="px-1.5 py-0.5 rounded-sm border border-rule dark:border-dark-border text-gray-500 dark:text-gray-400 font-mono text-[10px]">Tab</kbd> to navigate cards,{' '}
            <kbd className="px-1.5 py-0.5 rounded-sm border border-rule dark:border-dark-border text-gray-500 dark:text-gray-400 font-mono text-[10px]">A</kbd> to approve,{' '}
            <kbd className="px-1.5 py-0.5 rounded-sm border border-rule dark:border-dark-border text-gray-500 dark:text-gray-400 font-mono text-[10px]">R</kbd> to reject,{' '}
            <kbd className="px-1.5 py-0.5 rounded-sm border border-rule dark:border-dark-border text-gray-500 dark:text-gray-400 font-mono text-[10px]">Tab</kbd> into card for Edit/History buttons
          </p>
          {pendingInsights.map(insight => {
            return (
            <SwipeableCard
              key={insight.id}
              onSwipeRight={() => handleApprove(insight.id)}
              onSwipeLeft={() => handleReject(insight.id)}
              rightLabel="Approve"
              leftLabel="Reject"
              disabled={actionInProgress === insight.id || editState?.insightId === insight.id}
              tabIndex={0}
              ariaLabel={`Insight: ${insight.content.substring(0, 80)}${insight.content.length > 80 ? '...' : ''}. Press A to approve, R to reject, or Tab to action buttons.`}
            >
            <div className="card hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
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
                      disabled={editSaving}
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
                        disabled={editSaving || editState.editedContent.trim() === '' || editState.editedContent.trim() === insight.content}
                        aria-label="Save edited insight"
                      >
                        Save
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleCancelEdit}
                        disabled={editSaving}
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
                    disabled={actionInProgress === insight.id}
                    aria-label="Approve this insight"
                  >
                    Approve
                  </Button>

                  {/* Edit button */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleStartEdit(insight)}
                    disabled={actionInProgress === insight.id}
                    aria-label="Edit this insight"
                  >
                    Edit
                  </Button>

                  {/* Reject button — ink-on-rule, turns accent on hover (DESIGN.md; no dedicated red outside confirmations) */}
                  <button
                    onClick={() => handleReject(insight.id)}
                    disabled={actionInProgress === insight.id}
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
            </SwipeableCard>
          );
          })}
        </div>
      ))}

      {/* Insight Conflicts Section - only in verification view */}
      <div className="mt-12 pt-8 border-t border-rule dark:border-dark-border">
        <ConflictsSection />
      </div>
    </div>
  );
}
