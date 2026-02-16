import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import VerifiedBadge from '@/components/VerifiedBadge';
import { formatDateTime } from '@/utils/dateFormat';

interface BigFiveDomainScore {
  domain: string;
  domainScore: number;
}

interface AssessmentLatest {
  attemptId: string;
  completedAt: string;
  domainScores: BigFiveDomainScore[];
}

const DOMAIN_INFO: Record<string, { label: string; color: string; bgColor: string }> = {
  N: { label: 'Neuroticism', color: 'text-rose-600 dark:text-rose-400', bgColor: 'bg-rose-100 dark:bg-rose-900/30' },
  E: { label: 'Extraversion', color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  O: { label: 'Openness', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  A: { label: 'Agreeableness', color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-100 dark:bg-emerald-900/30' },
  C: { label: 'Conscientiousness', color: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-100 dark:bg-purple-900/30' },
};

function getScoreLevel(score: number): string {
  if (score >= 4) return 'High';
  if (score >= 3.5) return 'Above Avg';
  if (score >= 2.5) return 'Average';
  if (score >= 2) return 'Below Avg';
  return 'Low';
}

interface ProfileSection {
  title: string;
  content: string[];
  topicSources: string[];
}

interface ProfileSummary {
  userName: string;
  occupation: string;
  location: string;
  generatedAt: string;
  totalVerifiedInsights: number;
  topicsExplored: number;
  sections: {
    personalPortrait: ProfileSection;
    communicationStyle: ProfileSection;
    decisionMakingPatterns: ProfileSection;
    strengthsAndExpertise: ProfileSection;
    toneOfVoice: ProfileSection;
    keyThemes: ProfileSection;
  };
}

function SectionCard({
  section,
  icon,
  emptyMessage,
}: {
  section: ProfileSection;
  icon: string;
  emptyMessage: string;
}) {
  const hasContent = section.content.length > 0;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{icon}</span>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {section.title}
        </h2>
        {hasContent && (
          <span className="ml-auto flex items-center gap-2">
            <VerifiedBadge status="verified" size="sm" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-300">
              {section.content.length} insight{section.content.length !== 1 ? 's' : ''}
            </span>
          </span>
        )}
      </div>

      {hasContent ? (
        <>
          <ul className="space-y-2">
            {section.content.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
                <svg className="mt-1 w-4 h-4 text-green-500 dark:text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="leading-relaxed break-words">{item}</span>
              </li>
            ))}
          </ul>
          {section.topicSources.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-300 break-words">
                <span className="font-medium">Sources:</span>{' '}
                {section.topicSources.join(', ')}
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="text-gray-500 dark:text-gray-300 italic">{emptyMessage}</p>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const location = useLocation();
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [assessmentData, setAssessmentData] = useState<AssessmentLatest | null>(null);
  const previousInsightCount = useRef<number | null>(null);
  const isMounted = useRef(true);

  const fetchSummary = useCallback(async (showLoadingState = true, signal?: AbortSignal) => {
    if (!user) return;
    try {
      if (showLoadingState) setLoading(true);
      setError(null);
      const res = await fetch('/api/profile/summary', {
        headers: { 'x-user-id': user.id },
        signal,
      });
      if (!res.ok) {
        throw new Error('Failed to fetch profile summary');
      }
      const data = await res.json();
      if (isMounted.current) {
        setSummary(data.summary);
        previousInsightCount.current = data.summary.totalVerifiedInsights;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      }
    } finally {
      if (isMounted.current && showLoadingState && !signal?.aborted) {
        setLoading(false);
      }
    }
  }, [user]);

  // Fetch latest assessment data
  const fetchAssessment = useCallback(async (signal?: AbortSignal) => {
    if (!user) return;
    try {
      const res = await fetch('/api/assessment/latest', {
        headers: { 'x-user-id': user.id },
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (isMounted.current) setAssessmentData(data);
      } else {
        // 404 means no completed assessment - that's fine
        if (isMounted.current) setAssessmentData(null);
      }
    } catch {
      // ignore
    }
  }, [user]);

  // Fetch on mount and when navigating back to this page
  useEffect(() => {
    isMounted.current = true;
    const controller = new AbortController();
    fetchSummary(true, controller.signal);
    fetchAssessment(controller.signal);
    return () => { isMounted.current = false; controller.abort(); };
  }, [fetchSummary, fetchAssessment, location.key]);

  // Auto-refresh when tab regains focus (user may have verified insights in another tab/page)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user) {
        fetchSummary(false);
      }
    };
    const handleFocus = () => {
      if (user) {
        fetchSummary(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchSummary, user]);

  const handleRegenerate = async () => {
    if (!user) return;
    try {
      setRegenerating(true);
      const res = await fetch('/api/profile/regenerate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
      });
      if (!res.ok) throw new Error('Failed to regenerate profile');
      const data = await res.json();
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate');
    } finally {
      setRegenerating(false);
    }
  };

  const handleExportMarkdown = async () => {
    if (!user) return;
    try {
      setExporting(true);
      const res = await fetch('/api/profile/export/markdown', {
        headers: { 'x-user-id': user.id },
      });
      if (!res.ok) throw new Error('Failed to export profile');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${user.name.replace(/[^a-zA-Z0-9]/g, '_')}_me.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="card">
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-3" />
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="card bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" role="alert" aria-live="assertive">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button onClick={() => fetchSummary()} className="btn-primary mt-3">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const hasAnyInsights = summary && summary.totalVerifiedInsights > 0;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Profile Summary
          </h1>
          <p className="mt-1 text-gray-600 dark:text-gray-300">
            Your auto-generated personal profile
            {summary && summary.totalVerifiedInsights > 0 && (
              <span className="ml-2 text-sm">
                ({summary.totalVerifiedInsights} verified insight
                {summary.totalVerifiedInsights !== 1 ? 's' : ''} across{' '}
                {summary.topicsExplored} topic{summary.topicsExplored !== 1 ? 's' : ''})
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="btn-secondary text-sm"
          >
            {regenerating ? (
              <span className="flex items-center gap-1">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Regenerating...
              </span>
            ) : (
              'Regenerate'
            )}
          </button>
          <button
            onClick={handleExportMarkdown}
            disabled={exporting || !hasAnyInsights}
            className="btn-primary text-sm"
            title={!hasAnyInsights ? 'Need verified insights to export' : 'Export as me.md'}
          >
            {exporting ? (
              <span className="flex items-center gap-1">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Exporting...
              </span>
            ) : (
              'Export as me.md'
            )}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {summary && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="card text-center py-3">
            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {summary.totalVerifiedInsights}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-300">Verified Insights</p>
          </div>
          <div className="card text-center py-3">
            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {summary.topicsExplored}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-300">Topics Explored</p>
          </div>
          <div className="card text-center py-3">
            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {Object.values(summary.sections).filter(s => s.content.length > 0).length}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-300">Profile Sections</p>
          </div>
        </div>
      )}

      {/* Personality Summary Card */}
      {assessmentData ? (
        <div className="card mb-6 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xl">🧠</span>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Personality Profile
              </h2>
            </div>
            <Link
              to={`/app/assessment/${assessmentData.attemptId}/results`}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              View Full Results
            </Link>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {['O', 'C', 'E', 'A', 'N'].map(domain => {
              const info = DOMAIN_INFO[domain];
              const score = assessmentData.domainScores.find(d => d.domain === domain);
              const scoreVal = score?.domainScore ?? 0;
              const pct = Math.round((scoreVal / 5) * 100);
              return (
                <div key={domain} className={`rounded-lg p-3 text-center ${info.bgColor}`}>
                  <p className={`text-xs font-semibold ${info.color} mb-1`}>{info.label}</p>
                  <p className={`text-lg font-bold ${info.color}`}>{scoreVal.toFixed(1)}</p>
                  <div className="w-full h-1.5 bg-white/50 dark:bg-black/20 rounded-full mt-1 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-current opacity-60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{getScoreLevel(scoreVal)}</p>
                </div>
              );
            })}
          </div>
          {assessmentData.completedAt && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 text-center">
              Last assessed {formatDateTime(assessmentData.completedAt)}
            </p>
          )}
        </div>
      ) : !loading && (
        <div className="card mb-6 p-5">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🧠</span>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-white">Personality Assessment</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Take the Big Five test to add personality insights to your profile
              </p>
            </div>
            <Link to="/app/assessment" className="btn-primary text-sm whitespace-nowrap">
              Take Test
            </Link>
          </div>
        </div>
      )}

      {/* Empty state when no verified insights */}
      {!hasAnyInsights && (
        <div className="card text-center py-8 mb-6">
          <div className="text-4xl mb-3">🧠</div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No Verified Insights Yet
          </h2>
          <p className="text-gray-600 dark:text-gray-300 max-w-md mx-auto">
            Complete interview sessions and verify the extracted insights to build your
            personal profile. Each verified insight adds to your profile summary.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <a href="/app/topics" className="btn-primary">
              Browse Topics
            </a>
            <a href="/app/verify" className="btn-secondary">
              Verify Insights
            </a>
          </div>
        </div>
      )}

      {/* Profile sections */}
      {summary && (
        <div className="space-y-6">
          <SectionCard
            section={summary.sections.personalPortrait}
            icon="🎭"
            emptyMessage="Complete more interview sessions to generate your personal portrait including values, beliefs, and core traits."
          />
          <SectionCard
            section={summary.sections.communicationStyle}
            icon="💬"
            emptyMessage="Your communication patterns and preferences will appear here after verification."
          />
          <SectionCard
            section={summary.sections.decisionMakingPatterns}
            icon="⚖️"
            emptyMessage="Your decision frameworks and patterns will be summarized here."
          />
          <SectionCard
            section={summary.sections.strengthsAndExpertise}
            icon="💪"
            emptyMessage="An overview of your strengths and areas of expertise will appear after insights are verified."
          />
          <SectionCard
            section={summary.sections.toneOfVoice}
            icon="🎤"
            emptyMessage="Your tone of voice analysis with examples will appear here."
          />
          <SectionCard
            section={summary.sections.keyThemes}
            icon="🔗"
            emptyMessage="Key themes and connections across your topics will be visualized here."
          />
        </div>
      )}

      {/* Generated at timestamp */}
      {summary && summary.generatedAt && (
        <p className="mt-6 text-xs text-gray-500 dark:text-gray-300 text-center">
          Profile auto-generated from verified insights &middot; Last updated{' '}
          {formatDateTime(summary.generatedAt)}
          <span className="block mt-1 text-gray-400 dark:text-gray-600">
            Profile updates automatically when insights are verified, edited, or removed
          </span>
        </p>
      )}
    </div>
  );
}
