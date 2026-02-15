import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

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
  const { user } = useAuth();
  const [pendingInsights, setPendingInsights] = useState<Insight[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, verified: 0, rejected: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [intervalDropdownOpen, setIntervalDropdownOpen] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);

      const [statsRes, pendingRes] = await Promise.all([
        fetch('/api/insights/stats', {
          headers: { 'x-user-id': user.id },
        }),
        fetch('/api/insights/pending', {
          headers: { 'x-user-id': user.id },
        }),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      if (pendingRes.ok) {
        const pendingData = await pendingRes.json();
        setPendingInsights(pendingData.insights || []);
      }
    } catch (err) {
      console.error('Failed to fetch verification data:', err);
      setError('Failed to load verification queue');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleApprove = async (insightId: string, reVerifyInterval?: string) => {
    if (!user) return;
    setActionInProgress(insightId);
    try {
      const body: Record<string, string> = {};
      if (reVerifyInterval) {
        body.reVerifyInterval = reVerifyInterval;
      }

      const res = await fetch(`/api/insights/${insightId}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error('Failed to verify insight');
      }

      // Remove from pending list and update stats
      setPendingInsights(prev => prev.filter(i => i.id !== insightId));
      setStats(prev => ({
        ...prev,
        pending: prev.pending - 1,
        verified: prev.verified + 1,
      }));
      setIntervalDropdownOpen(null);
    } catch (err) {
      console.error('Failed to approve insight:', err);
      setError('Failed to approve insight');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReject = async (insightId: string) => {
    if (!user) return;
    setActionInProgress(insightId);
    try {
      const res = await fetch(`/api/insights/${insightId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ reason: 'Rejected by user' }),
      });

      if (!res.ok) {
        throw new Error('Failed to reject insight');
      }

      // Remove from pending list and update stats
      setPendingInsights(prev => prev.filter(i => i.id !== insightId));
      setStats(prev => ({
        ...prev,
        pending: prev.pending - 1,
        rejected: prev.rejected + 1,
      }));
    } catch (err) {
      console.error('Failed to reject insight:', err);
      setError('Failed to reject insight');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStartEdit = (insight: Insight) => {
    setEditState({ insightId: insight.id, editedContent: insight.content });
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
      const res = await fetch(`/api/insights/${editState.insightId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ content: editState.editedContent.trim() }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save edit');
      }

      const data = await res.json();

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

  const getConfidenceColor = (score: number | null) => {
    if (!score) return 'text-gray-500 dark:text-gray-400';
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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const getIntervalLabel = (interval: string | null) => {
    if (!interval) return null;
    return INTERVAL_LABELS[interval] || interval;
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Verification Queue</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">Review and verify AI-extracted insights</p>
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
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Review and verify AI-extracted insights
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 dark:hover:text-red-300 ml-2">
            &times;
          </button>
        </div>
      )}

      {/* Verification stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.pending}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Pending Review</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.verified}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Verified</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.rejected}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Rejected</p>
        </div>
      </div>

      {/* Pending insights list */}
      {pendingInsights.length === 0 ? (
        <div className="card text-center py-12">
          <span className="text-4xl block mb-3">&#x2705;</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No insights to verify
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Complete interview sessions to generate insights for verification.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {pendingInsights.length} insight{pendingInsights.length !== 1 ? 's' : ''} awaiting review
          </p>
          {pendingInsights.map(insight => (
            <div
              key={insight.id}
              className="card border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
            >
              {/* Insight content - view or edit mode */}
              <div className="mb-3">
                {editState?.insightId === insight.id ? (
                  <div className="space-y-2">
                    <textarea
                      ref={editTextareaRef}
                      value={editState.editedContent}
                      onChange={(e) => setEditState({ ...editState, editedContent: e.target.value })}
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
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        disabled={editSaving}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-sm font-medium rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
                        Press Escape to cancel
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-900 dark:text-white leading-relaxed">
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

                {/* Source topic */}
                {insight.topicTitle && (
                  <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                    {insight.topicTitle}
                  </span>
                )}

                {/* Source session reference */}
                {insight.sourceSessionId && (
                  <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Session
                  </span>
                )}

                {/* Date */}
                {insight.createdAt && (
                  <span className="text-gray-400 dark:text-gray-500">
                    {formatDate(insight.createdAt)}
                  </span>
                )}

                {/* Re-verification indicator */}
                {insight.verificationStatus === 're_verification_pending' && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300">
                    <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Re-verification
                  </span>
                )}

                {/* Previous verification info for re-verification items */}
                {insight.verificationStatus === 're_verification_pending' && insight.reVerifyInterval && (
                  <span className="text-xs text-purple-600 dark:text-purple-400">
                    Interval: {getIntervalLabel(insight.reVerifyInterval)}
                  </span>
                )}

                {/* Previously verified date for re-verification items */}
                {insight.verificationStatus === 're_verification_pending' && insight.verifiedAt && (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    Last verified: {formatDate(insight.verifiedAt)}
                  </span>
                )}
              </div>

              {/* Action buttons - hidden during edit mode */}
              {editState?.insightId !== insight.id && (
                <div className="flex items-center gap-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                  {/* Quick approve button */}
                  <button
                    onClick={() => handleApprove(insight.id)}
                    disabled={actionInProgress === insight.id}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-medium rounded-lg transition-colors"
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
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-700 rounded-lg transition-colors"
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
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors border border-gray-300 dark:border-gray-600"
                      title="Set re-verification interval and approve"
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
                      <div className="absolute bottom-full mb-1 left-0 z-10 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
                        <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Approve with re-verification interval
                          </p>
                        </div>
                        <div className="py-1">
                          {INTERVAL_OPTIONS.map(option => (
                            <button
                              key={option.value}
                              onClick={() => handleApprove(insight.id, option.value)}
                              className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                            >
                              <p className="text-sm font-medium text-gray-900 dark:text-white">{option.label}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">{option.description}</p>
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
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
