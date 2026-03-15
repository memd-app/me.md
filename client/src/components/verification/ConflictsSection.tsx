import { useState, useEffect, useCallback } from 'react';
import { useUser } from '../../contexts/UserContext';
import { formatShortDate } from '@/utils/dateFormat';

interface Insight {
  id: string;
  content: string;
  confidenceScore: number | null;
  verificationStatus: string;
  topicTitle: string | null;
  sourceSessionId: string | null;
  createdAt: string | null;
}

interface Conflict {
  id: string;
  userId: string;
  insightAId: string;
  insightBId: string;
  resolutionStatus: string;
  resolutionNote: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  insightA: Insight | null;
  insightB: Insight | null;
}

interface ConflictStats {
  total: number;
  unresolved: number;
  resolved: number;
}

interface ResolutionState {
  conflictId: string;
  resolution: string;
  note: string;
}

const RESOLUTION_OPTIONS = [
  {
    value: 'both_true_different_contexts',
    label: 'Both true in different contexts',
    description: 'Both statements are valid - they apply in different situations',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
  },
  {
    value: 'a_outdated',
    label: 'First insight is outdated',
    description: 'The first statement is no longer accurate - mark for re-verification',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    value: 'b_outdated',
    label: 'Second insight is outdated',
    description: 'The second statement is no longer accurate - mark for re-verification',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    value: 'clarified',
    label: 'Let me clarify',
    description: 'Provide your own explanation to resolve this conflict',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
];

export default function ConflictsSection() {
  const { user } = useUser();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [stats, setStats] = useState<ConflictStats>({ total: 0, unresolved: 0, resolved: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [resolutionState, setResolutionState] = useState<ResolutionState | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const fetchConflicts = useCallback(async (signal?: AbortSignal) => {
    if (!user) return;
    try {
      setError(null);
      const statusParam = showResolved ? '' : '?status=unresolved';
      const [conflictsRes, statsRes] = await Promise.all([
        fetch(`/api/conflicts${statusParam}`, {
          headers: { 'x-user-id': user.id },
          signal,
        }),
        fetch('/api/conflicts/stats', {
          headers: { 'x-user-id': user.id },
          signal,
        }),
      ]);

      if (conflictsRes.ok) {
        const data = await conflictsRes.json();
        if (!signal?.aborted) {
          setConflicts(data.conflicts || []);
        }
      }

      if (statsRes.ok) {
        const data = await statsRes.json();
        if (!signal?.aborted) {
          setStats(data);
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Failed to fetch conflicts:', err);
      if (!signal?.aborted) {
        setError('Failed to load conflicts');
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [user, showResolved]);

  useEffect(() => {
    const controller = new AbortController();
    fetchConflicts(controller.signal);
    return () => controller.abort();
  }, [fetchConflicts]);

  const handleDetectConflicts = async () => {
    if (!user) return;
    setIsDetecting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/conflicts/detect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to detect conflicts');
      }

      const data = await res.json();
      setSuccessMsg(data.message);

      // Refresh conflicts list
      await fetchConflicts();
    } catch (err) {
      console.error('Conflict detection failed:', err);
      setError('Failed to run conflict detection');
    } finally {
      setIsDetecting(false);
    }
  };

  const handleStartResolve = (conflictId: string) => {
    setResolutionState({ conflictId, resolution: '', note: '' });
  };

  const handleCancelResolve = () => {
    setResolutionState(null);
  };

  const handleResolve = async () => {
    if (!user || !resolutionState || !resolutionState.resolution) return;

    // For "clarified" resolution, require a note
    if (resolutionState.resolution === 'clarified' && !resolutionState.note.trim()) {
      setError('Please provide a clarification note');
      return;
    }

    setIsResolving(true);
    setError(null);

    try {
      const res = await fetch(`/api/conflicts/${resolutionState.conflictId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({
          resolution: resolutionState.resolution,
          resolutionNote: resolutionState.note.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to resolve conflict');
      }

      setSuccessMsg('Conflict resolved successfully');
      setResolutionState(null);

      // Refresh conflicts
      await fetchConflicts();
    } catch (err) {
      console.error('Failed to resolve conflict:', err);
      setError(err instanceof Error ? err.message : 'Failed to resolve conflict');
    } finally {
      setIsResolving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'unresolved':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300">
            Unresolved
          </span>
        );
      case 'both_true_different_contexts':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
            Both Valid
          </span>
        );
      case 'a_outdated':
      case 'b_outdated':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
            Outdated
          </span>
        );
      case 'clarified':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300">
            Clarified
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
            {status}
          </span>
        );
    }
  };

  const formatDate = (dateStr: string | null) => formatShortDate(dateStr);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Insight Conflicts</h2>
        </div>
        <div className="card animate-pulse">
          <div className="h-4 w-3/4 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
          <div className="h-3 w-1/2 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            Insight Conflicts
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {stats.unresolved > 0
              ? `${stats.unresolved} unresolved conflict${stats.unresolved !== 1 ? 's' : ''} detected`
              : 'No unresolved conflicts'}
            {stats.resolved > 0 && ` (${stats.resolved} resolved)`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Show/hide resolved toggle */}
          <button
            onClick={() => setShowResolved(!showResolved)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
          >
            {showResolved ? 'Hide Resolved' : 'Show All'}
          </button>

          {/* Detect conflicts button */}
          <button
            onClick={handleDetectConflicts}
            disabled={isDetecting}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isDetecting ? (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
            {isDetecting ? 'Scanning...' : 'Scan for Conflicts'}
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 dark:hover:text-red-300 ml-2">
            &times;
          </button>
        </div>
      )}
      {successMsg && (
        <div className="p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-300 flex justify-between items-center">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-green-500 hover:text-green-700 dark:hover:text-green-300 ml-2">
            &times;
          </button>
        </div>
      )}

      {/* Conflicts list */}
      {conflicts.length === 0 ? (
        <div className="card text-center py-8 border border-dashed border-gray-300 dark:border-gray-600">
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-400 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-gray-600 dark:text-gray-300 font-medium">
            {showResolved ? 'No conflicts found' : 'No unresolved conflicts'}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Click &quot;Scan for Conflicts&quot; to check for contradictions between your insights.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {conflicts.map(conflict => (
            <div
              key={conflict.id}
              className="card border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {/* Conflict header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {getStatusBadge(conflict.resolutionStatus)}
                  {conflict.createdAt && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Detected {formatDate(conflict.createdAt)}
                    </span>
                  )}
                </div>
                {conflict.resolvedAt && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Resolved {formatDate(conflict.resolvedAt)}
                  </span>
                )}
              </div>

              {/* Side-by-side comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Insight A */}
                <div className={`p-3 rounded-lg border ${
                  conflict.resolutionStatus === 'a_outdated'
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700'
                    : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                }`}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                      Insight A
                    </span>
                    {conflict.resolutionStatus === 'a_outdated' && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">(outdated)</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-900 dark:text-white leading-relaxed break-words">
                    {conflict.insightA?.content || 'Insight not found'}
                  </p>
                  {conflict.insightA?.topicTitle && (
                    <p className="mt-2 text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1 truncate">
                      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      <span className="truncate">{conflict.insightA.topicTitle}</span>
                    </p>
                  )}
                </div>

                {/* Insight B */}
                <div className={`p-3 rounded-lg border ${
                  conflict.resolutionStatus === 'b_outdated'
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700'
                    : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                }`}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                      Insight B
                    </span>
                    {conflict.resolutionStatus === 'b_outdated' && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">(outdated)</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-900 dark:text-white leading-relaxed break-words">
                    {conflict.insightB?.content || 'Insight not found'}
                  </p>
                  {conflict.insightB?.topicTitle && (
                    <p className="mt-2 text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1 truncate">
                      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      <span className="truncate">{conflict.insightB.topicTitle}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Resolution note if resolved */}
              {conflict.resolutionNote && conflict.resolutionStatus !== 'unresolved' && (
                <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">Resolution Note:</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 break-words">{conflict.resolutionNote}</p>
                </div>
              )}

              {/* Resolution actions (only for unresolved) */}
              {conflict.resolutionStatus === 'unresolved' && (
                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                  {resolutionState?.conflictId === conflict.id ? (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        How would you like to resolve this conflict?
                      </p>

                      {/* Resolution options */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {RESOLUTION_OPTIONS.map(option => (
                          <button
                            key={option.value}
                            onClick={() => setResolutionState({
                              ...resolutionState,
                              resolution: option.value,
                            })}
                            className={`text-left p-3 rounded-lg border transition-colors ${
                              resolutionState.resolution === option.value
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
                                : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className={resolutionState.resolution === option.value
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-gray-600 dark:text-gray-300'
                              }>
                                {option.icon}
                              </span>
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                {option.label}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-300 ml-7">
                              {option.description}
                            </p>
                          </button>
                        ))}
                      </div>

                      {/* Clarification note input */}
                      {resolutionState.resolution === 'clarified' && (
                        <div>
                          <label htmlFor="conflict-clarification" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Your clarification:
                          </label>
                          <textarea
                            id="conflict-clarification"
                            value={resolutionState.note}
                            onChange={(e) => setResolutionState({ ...resolutionState, note: e.target.value })}
                            placeholder="Explain how these insights relate or clarify the apparent contradiction..."
                            className="w-full px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y min-h-[60px]"
                            rows={2}
                          />
                        </div>
                      )}

                      {/* Optional note for non-clarified resolutions */}
                      {resolutionState.resolution && resolutionState.resolution !== 'clarified' && (
                        <div>
                          <label htmlFor="conflict-resolution-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Note (optional):
                          </label>
                          <input
                            id="conflict-resolution-note"
                            type="text"
                            value={resolutionState.note}
                            onChange={(e) => setResolutionState({ ...resolutionState, note: e.target.value })}
                            placeholder="Add a note about this resolution..."
                            className="w-full px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          />
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleResolve}
                          disabled={!resolutionState.resolution || isResolving}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          {isResolving ? (
                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          Resolve
                        </button>
                        <button
                          onClick={handleCancelResolve}
                          disabled={isResolving}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleStartResolve(conflict.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      Resolve Conflict
                    </button>
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
