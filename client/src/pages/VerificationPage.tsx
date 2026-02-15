import { useState, useEffect, useCallback } from 'react';
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

export default function VerificationPage() {
  const { user } = useAuth();
  const [pendingInsights, setPendingInsights] = useState<Insight[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, verified: 0, rejected: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

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

  const handleApprove = async (insightId: string) => {
    if (!user) return;
    setActionInProgress(insightId);
    try {
      const res = await fetch(`/api/insights/${insightId}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
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
              {/* Insight content */}
              <div className="mb-3">
                <p className="text-gray-900 dark:text-white leading-relaxed">
                  {insight.content}
                </p>
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
                    Re-verification
                  </span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-3 border-t border-gray-100 dark:border-gray-700">
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
