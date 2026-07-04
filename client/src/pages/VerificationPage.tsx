import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useToast } from '../contexts/ToastContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import ConflictsSection from '../components/verification/ConflictsSection';
import SwipeableCard from '../components/verification/SwipeableCard';
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
  agreementScore: number | null;
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

const INTERVAL_LABELS: Record<string, string> = {
  weekly: '1-4 weeks',
  monthly: '~1 month',
  quarterly: '~3 months',
  biannual: '~6 months',
  annual: '~12 months',
};

const INTERVAL_OPTIONS = [
  { value: 'weekly', label: 'Weekly (1-4 weeks)', description: 'Situational insights that change frequently' },
  { value: 'monthly', label: 'Monthly (~1 month)', description: 'Moderate insights' },
  { value: 'quarterly', label: 'Quarterly (~3 months)', description: 'Preferences and styles' },
  { value: 'biannual', label: 'Biannual (~6 months)', description: 'Core traits and values' },
  { value: 'annual', label: 'Annual (~12 months)', description: 'Deep, stable identity traits' },
];

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
  const [intervalDropdownOpen, setIntervalDropdownOpen] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [historyState, setHistoryState] = useState<HistoryState | null>(null);
  const [agreementUpdating, setAgreementUpdating] = useState<string | null>(null);

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

  const handleApprove = async (insightId: string, reVerifyInterval?: string) => {
    if (!user) return;
    setActionInProgress(insightId);
    try {
      const body: Record<string, string> = {};
      if (reVerifyInterval) {
        body.reVerifyInterval = reVerifyInterval;
      }

      verifyInsight(db, insightId, body.reVerifyInterval ? { reVerifyInterval: body.reVerifyInterval } : undefined);

      // Remove from pending list and update stats
      setPendingInsights(prev => prev.filter(i => i.id !== insightId));
      setStats(prev => ({
        ...prev,
        pending: prev.pending - 1,
        verified: prev.verified + 1,
      }));
      setIntervalDropdownOpen(null);
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
    setIntervalDropdownOpen(null);
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

  const handleSetAgreement = async (insightId: string, score: number) => {
    if (!user) return;
    setAgreementUpdating(insightId);
    try {
      const data = editInsight(db, insightId, { agreementScore: score });
      const updatedScore = data.insight.agreementScore;

      // Update in pending insights
      setPendingInsights(prev =>
        prev.map(i =>
          i.id === insightId ? { ...i, agreementScore: updatedScore, updatedAt: data.insight.updatedAt } : i
        )
      );
      // Update in verified insights
      setVerifiedInsights(prev =>
        prev.map(i =>
          i.id === insightId ? { ...i, agreementScore: updatedScore, updatedAt: data.insight.updatedAt } : i
        )
      );
    } catch (err) {
      console.error('Failed to update agreement score:', err);
      setError(err instanceof Error ? err.message : 'Failed to update agreement score');
    } finally {
      setAgreementUpdating(null);
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
    setIntervalDropdownOpen(null);
  };

  const exitBatchReview = () => {
    setBatchMode(false);
    setBatchInsights([]);
    setBatchIndex(0);
    setBatchReviewed(0);
    setBatchTotal(0);
    setEditState(null);
    setHistoryState(null);
    setIntervalDropdownOpen(null);
  };

  const advanceBatch = () => {
    setBatchReviewed(prev => prev + 1);
    setEditState(null);
    setHistoryState(null);
    setIntervalDropdownOpen(null);
    // Find the next insight that hasn't been acted on yet
    // We check against the current pendingInsights which gets updated as items are approved/rejected
    setBatchIndex(prev => prev + 1);
  };

  const handleBatchApprove = async (insightId: string, reVerifyInterval?: string) => {
    await handleApprove(insightId, reVerifyInterval);
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

  const getAgreementColor = (score: number | null): string => {
    if (score === null) return 'bg-gray-200 dark:bg-gray-700';
    if (score >= 8) return 'bg-green-500';
    if (score >= 5) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const getAgreementLabel = (score: number | null): string => {
    if (score === null) return 'Not rated';
    if (score >= 9) return 'Strongly agree';
    if (score >= 7) return 'Agree';
    if (score >= 5) return 'Somewhat agree';
    if (score >= 3) return 'Somewhat disagree';
    return 'Strongly disagree';
  };

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

  const getActionColor = (action: string): string => {
    switch (action) {
      case 'verified':
      case 're_verified':
        return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800';
      case 'rejected':
      case 're_rejected':
        return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800';
      case 'edited':
        return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800';
      case 're_verification_triggered':
        return 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 border-purple-200 dark:border-purple-800';
      default:
        return 'text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-800';
    }
  };

  const getActionIcon = (action: string): string => {
    switch (action) {
      case 'verified':
      case 're_verified':
        return 'M5 13l4 4L19 7'; // checkmark
      case 'rejected':
      case 're_rejected':
        return 'M6 18L18 6M6 6l12 12'; // X
      case 'edited':
        return 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z'; // pencil
      case 're_verification_triggered':
        return 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'; // refresh
      default:
        return 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'; // info
    }
  };

  const formatDateTime = (dateStr: string | null) => sharedFormatDateTime(dateStr);

  const getConfidenceColor = (score: number | null) => {
    if (!score) return 'text-gray-500 dark:text-gray-300';
    if (score >= 80) return 'text-green-600 dark:text-green-400';
    if (score >= 60) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getConfidenceLabel = (score: number | null) => {
    if (!score) return 'Unknown';
    if (score >= 80) return 'High';
    if (score >= 60) return 'Medium';
    return 'Low';
  };

  const formatDate = (dateStr: string | null) => formatShortDate(dateStr);

  const getIntervalLabel = (interval: string | null) => {
    if (!interval) return null;
    return INTERVAL_LABELS[interval] || interval;
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Verification Queue</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-300">Review and verify AI-extracted insights</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="card text-center animate-pulse">
              <div className="h-8 w-12 bg-gray-200 dark:bg-gray-700 rounded mx-auto mb-2" />
              <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="card animate-pulse">
              <div className="h-4 w-3/4 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
              <div className="h-3 w-1/2 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
              <div className="h-3 w-1/3 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Verification Queue</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          Review and verify AI-extracted insights
        </p>
      </div>

      {/* Error message */}
      {error && (
        <ApiErrorAlert
          message={error}
          onDismiss={() => setError(null)}
          className="mb-4"
        />
      )}

      {/* Verification stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.pending}</p>
          <p className="text-sm text-gray-500 dark:text-gray-300">Pending Review</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.verified}</p>
          <p className="text-sm text-gray-500 dark:text-gray-300">Verified</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.rejected}</p>
          <p className="text-sm text-gray-500 dark:text-gray-300">Rejected</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
            {verifiedInsights.filter(i => i.privacyTier === 'never_export').length}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-300">Never export &middot; managed in Settings</p>
        </div>
      </div>

      {/* Batch Review Mode */}
      {batchMode && (
        batchComplete ? (
          <div className="card text-center py-12">
            <span className="text-4xl block mb-3">&#x1F389;</span>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Batch Review Complete!
            </h2>
            <p className="text-gray-600 dark:text-gray-300 mb-2">
              You reviewed <span className="font-bold text-green-600 dark:text-green-400">{batchReviewed}</span> out of {batchTotal} insights.
            </p>
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={exitBatchReview}
                className="btn-primary"
              >
                Back to Queue
              </button>
              {pendingInsights.length > 0 && (
                <button
                  onClick={startBatchReview}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Review Remaining ({pendingInsights.length})
                </button>
              )}
            </div>
          </div>
        ) : currentBatchInsight && (() => {
          const insight = currentBatchInsight;
          const isReVerification = insight.verificationStatus === 're_verification_pending';
          return (
            <div className="space-y-4">
              {/* Batch progress indicator */}
              <div className="card bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-300 ring-1 ring-primary-300 dark:ring-primary-700">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Batch Review
                    </span>
                    <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                      {batchReviewed + 1} of {batchTotal}
                    </span>
                  </div>
                  <button
                    onClick={exitBatchReview}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-200 bg-white dark:bg-gray-800 rounded-md border border-gray-300 dark:border-gray-600 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Exit Batch
                  </button>
                </div>
                {/* Progress bar */}
                <div className="w-full h-2 bg-primary-200 dark:bg-primary-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 dark:bg-primary-400 rounded-full transition-all duration-300"
                    style={{ width: `${(batchReviewed / batchTotal) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-xs text-primary-600 dark:text-primary-400">
                  <span>{batchReviewed} reviewed</span>
                  <span>{batchTotal - batchReviewed} remaining</span>
                </div>
              </div>

              {/* Single insight card in focus */}
              <div
                className={`card border-2 transition-colors ${
                  isReVerification
                    ? 'border-purple-300 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-900/10'
                    : 'border-primary-300 dark:border-primary-700 bg-white dark:bg-gray-900'
                }`}
              >
                {/* Re-verification banner */}
                {isReVerification && (
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-purple-200 dark:border-purple-800">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 ring-1 ring-purple-300 dark:ring-purple-700">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Re-check
                    </span>
                    {insight.verifiedAt && (
                      <span className="text-xs text-purple-600 dark:text-purple-400">
                        Last verified: {formatDate(insight.verifiedAt)}
                      </span>
                    )}
                  </div>
                )}

                {/* Insight content - view or edit mode */}
                <div className="mb-4">
                  {editState?.insightId === insight.id ? (
                    <div className="space-y-2">
                      <textarea
                        ref={editTextareaRef}
                        value={editState.editedContent}
                        onChange={(e) => setEditState({ ...editState, editedContent: e.target.value })}
                        className="w-full px-3 py-2 text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-blue-400 dark:border-blue-500 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y min-h-[80px] leading-relaxed text-lg"
                        rows={4}
                        disabled={editSaving}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleBatchSaveEditAndContinue}
                          disabled={editSaving || editState.editedContent.trim() === '' || editState.editedContent.trim() === insight.content}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          {editSaving ? (
                            <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          Save &amp; Continue
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          disabled={editSaving}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-900 dark:text-white leading-relaxed text-lg">
                      {insight.content}
                    </p>
                  )}
                </div>

                {/* Metadata */}
                <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
                  <span className={`flex items-center gap-1 ${getConfidenceColor(insight.confidenceScore)}`}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    {insight.confidenceScore}% ({getConfidenceLabel(insight.confidenceScore)})
                  </span>
                  {/* Extraction method indicator — only shown for fallback */}
                  {insight.extractionMethod === 'fallback' && (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      title="This insight was extracted using rule-based pattern matching instead of AI. It may be lower quality — please review carefully."
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Rule-based
                    </span>
                  )}
                  {insight.topicTitle && (
                    <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      {insight.topicTitle}
                    </span>
                  )}
                  {insight.createdAt && (
                    <span className="text-gray-500 dark:text-gray-300">
                      {formatDate(insight.createdAt)}
                    </span>
                  )}
                </div>

                {/* Agreement Scale */}
                <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      Agreement: {getAgreementLabel(insight.agreementScore)}
                    </span>
                    {insight.agreementScore !== null && (
                      <span className={`text-xs font-bold ${
                        insight.agreementScore >= 7 ? 'text-green-600 dark:text-green-400' :
                        insight.agreementScore >= 4 ? 'text-amber-600 dark:text-amber-400' :
                        'text-red-600 dark:text-red-400'
                      }`}>
                        {insight.agreementScore}/10
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(score => (
                      <button
                        key={score}
                        onClick={() => handleSetAgreement(insight.id, score)}
                        disabled={agreementUpdating === insight.id}
                        className={`flex-1 h-8 rounded text-xs font-medium transition-all ${
                          insight.agreementScore === score
                            ? `${getAgreementColor(score)} text-white ring-2 ring-offset-1 ring-offset-gray-50 dark:ring-offset-gray-800 ${
                                score >= 8 ? 'ring-green-400' : score >= 5 ? 'ring-amber-400' : 'ring-red-400'
                              }`
                            : insight.agreementScore !== null && score <= insight.agreementScore
                              ? `${getAgreementColor(score)} text-white opacity-60`
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                        } ${agreementUpdating === insight.id ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                        title={`Set agreement to ${score}/10`}
                      >
                        {score}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Batch action buttons - large and prominent */}
                {editState?.insightId !== insight.id && (
                  <div className="flex items-center gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => handleBatchApprove(insight.id)}
                      disabled={actionInProgress === insight.id}
                      className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
                    >
                      {actionInProgress === insight.id ? (
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      Approve
                    </button>

                    <button
                      onClick={() => handleStartEdit(insight)}
                      disabled={actionInProgress === insight.id}
                      className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-700 rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit &amp; Continue
                    </button>

                    <button
                      onClick={() => handleBatchReject(insight.id)}
                      disabled={actionInProgress === insight.id}
                      className="inline-flex items-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Reject
                    </button>

                    {/* Skip button for batch mode */}
                    <button
                      onClick={advanceBatch}
                      className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      Skip
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
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
        <div className="card text-center py-12">
          <span className="text-4xl block mb-3">&#x2705;</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No insights to verify
          </h2>
          <p className="text-gray-600 dark:text-gray-300">
            Complete interview sessions to generate insights for verification.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-300">
              {pendingInsights.length} insight{pendingInsights.length !== 1 ? 's' : ''} awaiting review
            </p>
            {pendingInsights.length >= 2 && (
              <button
                onClick={startBatchReview}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Start Batch Review ({pendingInsights.length})
              </button>
            )}
          </div>
          {/* Keyboard navigation hint */}
          <p className="text-xs text-gray-400 dark:text-gray-500 hidden lg:block" aria-hidden="true">
            <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono text-[10px]">Tab</kbd> to navigate cards,{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono text-[10px]">A</kbd> to approve,{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono text-[10px]">R</kbd> to reject,{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono text-[10px]">Tab</kbd> into card for Edit/History buttons
          </p>
          {pendingInsights.map(insight => {
            const isReVerification = insight.verificationStatus === 're_verification_pending';
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
            <div
              className={`card border transition-colors ${
                isReVerification
                  ? 'border-purple-300 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-900/10 hover:border-purple-400 dark:hover:border-purple-600'
                  : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
              }`}
            >
              {/* Re-verification banner at top of card */}
              {isReVerification && (
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-purple-200 dark:border-purple-800">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 ring-1 ring-purple-300 dark:ring-purple-700">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Re-check
                  </span>
                  {insight.verifiedAt && (
                    <span className="text-xs text-purple-600 dark:text-purple-400">
                      Last verified: {formatDate(insight.verifiedAt)}
                    </span>
                  )}
                  {insight.reVerifyInterval && (
                    <span className="text-xs text-gray-500 dark:text-gray-300 ml-auto">
                      Schedule: {getIntervalLabel(insight.reVerifyInterval)}
                    </span>
                  )}
                </div>
              )}

              {/* Insight content - view or edit mode */}
              <div className="mb-3">
                {editState?.insightId === insight.id ? (
                  <div className="space-y-2">
                    <textarea
                      ref={editTextareaRef}
                      value={editState.editedContent}
                      onChange={(e) => setEditState({ ...editState, editedContent: e.target.value })}
                      aria-label="Edit insight content"
                      className="w-full px-3 py-2 text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-blue-400 dark:border-blue-500 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y min-h-[80px] leading-relaxed"
                      rows={3}
                      disabled={editSaving}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          handleCancelEdit();
                        }
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveEdit}
                        disabled={editSaving || editState.editedContent.trim() === '' || editState.editedContent.trim() === insight.content}
                        aria-label="Save edited insight"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                      >
                        {editSaving ? (
                          <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        disabled={editSaving}
                        aria-label="Cancel editing"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                      >
                        Cancel
                      </button>
                      <span className="text-xs text-gray-500 dark:text-gray-300 ml-2">
                        Press Escape to cancel
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-900 dark:text-white leading-relaxed break-words">
                    {insight.content}
                  </p>
                )}
              </div>

              {/* Metadata row */}
              <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
                {/* Confidence score */}
                <span className={`flex items-center gap-1 ${getConfidenceColor(insight.confidenceScore)}`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  {insight.confidenceScore}% ({getConfidenceLabel(insight.confidenceScore)})
                </span>

                {/* Extraction method indicator — only shown for fallback */}
                {insight.extractionMethod === 'fallback' && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    title="This insight was extracted using rule-based pattern matching instead of AI. It may be lower quality — please review carefully."
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Rule-based
                  </span>
                )}

                {/* Source topic */}
                {insight.topicTitle && (
                  <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 min-w-0 max-w-[200px]">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                    <span className="truncate">{insight.topicTitle}</span>
                  </span>
                )}

                {/* Source session reference */}
                {insight.sourceSessionId && (
                  <span className="flex items-center gap-1 text-gray-500 dark:text-gray-300">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Session
                  </span>
                )}

                {/* Date */}
                {insight.createdAt && (
                  <span className="text-gray-500 dark:text-gray-300">
                    {formatDate(insight.createdAt)}
                  </span>
                )}

                {/* Note: Re-verification badge/info shown in card banner above for re-check items */}

                {/* Privacy tier indicator — managed in Settings (single owner) */}
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

              {/* Agreement Scale 1-10 */}
              <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Agreement: {getAgreementLabel(insight.agreementScore)}
                  </span>
                  {insight.agreementScore !== null && (
                    <span className={`text-xs font-bold ${
                      insight.agreementScore >= 7 ? 'text-green-600 dark:text-green-400' :
                      insight.agreementScore >= 4 ? 'text-amber-600 dark:text-amber-400' :
                      'text-red-600 dark:text-red-400'
                    }`}>
                      {insight.agreementScore}/10
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(score => (
                    <button
                      key={score}
                      onClick={() => handleSetAgreement(insight.id, score)}
                      disabled={agreementUpdating === insight.id}
                      className={`flex-1 h-7 rounded text-xs font-medium transition-all ${
                        insight.agreementScore === score
                          ? `${getAgreementColor(score)} text-white ring-2 ring-offset-1 ring-offset-gray-50 dark:ring-offset-gray-800 ${
                              score >= 8 ? 'ring-green-400' : score >= 5 ? 'ring-amber-400' : 'ring-red-400'
                            }`
                          : insight.agreementScore !== null && score <= insight.agreementScore
                            ? `${getAgreementColor(score)} text-white opacity-60`
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                      } ${agreementUpdating === insight.id ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                      title={`Set agreement to ${score}/10`}
                    >
                      {score}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action buttons - hidden during edit mode */}
              {editState?.insightId !== insight.id && (
                <div className="flex items-center gap-3 pt-3 border-t border-gray-100 dark:border-gray-700" role="group" aria-label="Insight actions">
                  {/* Quick approve button */}
                  <button
                    onClick={() => handleApprove(insight.id)}
                    disabled={actionInProgress === insight.id}
                    aria-label="Approve this insight"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                  >
                    {actionInProgress === insight.id ? (
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    Approve
                  </button>

                  {/* Edit button */}
                  <button
                    onClick={() => handleStartEdit(insight)}
                    disabled={actionInProgress === insight.id}
                    aria-label="Edit this insight"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-700 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit
                  </button>

                  {/* Re-verification interval selector */}
                  <div className="relative">
                    <button
                      onClick={() => setIntervalDropdownOpen(intervalDropdownOpen === insight.id ? null : insight.id)}
                      disabled={actionInProgress === insight.id}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                      title="Set re-verification interval and approve"
                      aria-label="Schedule re-verification interval"
                      aria-expanded={intervalDropdownOpen === insight.id}
                      aria-haspopup="true"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Schedule
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* Dropdown menu */}
                    {intervalDropdownOpen === insight.id && (
                      <div className="absolute bottom-full mb-1 left-0 z-10 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg" role="menu" aria-label="Re-verification interval options">
                        <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Approve with re-verification interval
                          </p>
                        </div>
                        <div className="py-1">
                          {INTERVAL_OPTIONS.map(option => (
                            <button
                              key={option.value}
                              onClick={() => handleApprove(insight.id, option.value)}
                              role="menuitem"
                              className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-700"
                            >
                              <p className="text-sm font-medium text-gray-900 dark:text-white">{option.label}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-300">{option.description}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Reject button */}
                  <button
                    onClick={() => handleReject(insight.id)}
                    disabled={actionInProgress === insight.id}
                    aria-label="Reject this insight"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Reject
                  </button>

                  {/* History button - pushed to the right */}
                  <button
                    onClick={() => handleToggleHistory(insight.id)}
                    aria-label={`View verification history${historyState?.insightId === insight.id ? ' (open)' : ''}`}
                    aria-expanded={historyState?.insightId === insight.id}
                    className={`ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                      historyState?.insightId === insight.id
                        ? 'text-primary-700 dark:text-primary-300 bg-primary-100 dark:bg-primary-900/40 border border-primary-300 dark:border-primary-600'
                        : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    title="View verification history"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    History
                  </button>
                </div>
              )}

              {/* Verification History Timeline */}
              {historyState?.insightId === insight.id && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Verification History
                  </h4>

                  {historyState.loading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-300">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Loading history...
                    </div>
                  ) : historyState.entries.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-300 italic">
                      No verification history yet. This insight has not been verified, edited, or rejected.
                    </p>
                  ) : (
                    <div className="relative">
                      {/* Timeline line */}
                      <div className="absolute left-3.5 top-2 bottom-2 w-px bg-gray-200 dark:bg-gray-700" />

                      <div className="space-y-3">
                        {historyState.entries.map((entry, idx) => (
                          <div key={entry.id} className="relative flex gap-3">
                            {/* Timeline dot */}
                            <div className={`relative z-10 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center border ${getActionColor(entry.action)}`}>
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={getActionIcon(entry.action)} />
                              </svg>
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0 pb-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-sm font-medium ${getActionColor(entry.action).split(' ').slice(0, 2).join(' ')}`}>
                                  {getActionLabel(entry.action)}
                                </span>
                                <span className="text-xs text-gray-500 dark:text-gray-300">
                                  {formatDateTime(entry.createdAt)}
                                </span>
                                {idx === historyState.entries.length - 1 && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">
                                    Latest
                                  </span>
                                )}
                              </div>

                              {/* Show content diff for edits */}
                              {entry.action === 'edited' && entry.previousContent && entry.newContent && (
                                <div className="mt-1.5 space-y-1">
                                  <div className="text-xs break-words">
                                    <span className="text-red-500 dark:text-red-400 font-medium">Before: </span>
                                    <span className="text-gray-600 dark:text-gray-300 line-through">{entry.previousContent}</span>
                                  </div>
                                  <div className="text-xs break-words">
                                    <span className="text-green-500 dark:text-green-400 font-medium">After: </span>
                                    <span className="text-gray-700 dark:text-gray-300">{entry.newContent}</span>
                                  </div>
                                </div>
                              )}

                              {/* Show info for re-verification triggers */}
                              {entry.action === 're_verification_triggered' && entry.newContent && (
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-300">
                                  {entry.newContent}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
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
      {true && (
        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
          <ConflictsSection />
        </div>
      )}
    </div>
  );
}
