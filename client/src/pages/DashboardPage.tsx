import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import { formatActivityDate, formatRelativeTime } from '@/utils/dateFormat';
import { getDashboardStats, getActivityData } from '@/services/dashboard';
import { getLatestAssessment } from '@/services/assessment';
import { getSessions } from '@/services/sessions';
import { SectionHeading, EmptyState } from '@/components/ui';

interface CategoryCompleteness {
  category: string;
  label: string;
  totalTopics: number;
  exploredTopics: number;
  totalInsights: number;
  verifiedInsights: number;
  completeness: number;
}

interface TopicInsightBreakdown {
  topicId: string;
  topicTitle: string;
  category: string;
  totalInsights: number;
  verified: number;
  rejected: number;
  unverified: number;
}

interface DashboardStats {
  topics: number;
  topicsExplored: number;
  sessions: number;
  completedSessions: number;
  insights: number;
  verifiedInsights: number;
  rejectedInsights: number;
  verificationRate: number;
  notes: number;
  categoryCompleteness: CategoryCompleteness[];
  topicInsightBreakdown: TopicInsightBreakdown[];
}

interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string;
  status?: string;
  date: string;
}

interface AssessmentStatus {
  hasTaken: boolean;
  lastCompletedAt: string | null;
  attemptId: string | null;
  domainScores: Array<{ domain: string; score: number }> | null;
}

interface SessionRow {
  id: string;
  topicId: string;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

// Quoted-title substring inside an activity description is rendered in
// serif italic, matching "Recent activity" in the mockup.
function ActivityLine({ item }: { item: ActivityItem }) {
  const quoted = `"${item.title}"`;
  const idx = item.description.indexOf(quoted);
  if (idx === -1) {
    return <>{item.description}</>;
  }
  const before = item.description.slice(0, idx);
  const after = item.description.slice(idx + quoted.length);
  return (
    <>
      {before}
      <em className="font-serif italic text-gray-900 dark:text-white">{item.title}</em>
      {after}
    </>
  );
}

export default function DashboardPage() {
  const { user } = useUser();
  const db = useDatabase();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchVersion, setFetchVersion] = useState(0);
  const [assessmentStatus, setAssessmentStatus] = useState<AssessmentStatus>({
    hasTaken: false,
    lastCompletedAt: null,
    attemptId: null,
    domainScores: null,
  });

  const fetchDashboard = useCallback(async (signal?: AbortSignal) => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const statsData = getDashboardStats(db);
      setStats(statsData);

      const activityData = getActivityData(db);
      setActivity(activityData.activity || []);

      // Resumable session (for the "Continue reading" lead) — the one
      // additional service call needed beyond the existing data layer.
      setSessions(getSessions(db) || []);

      // Assessment data (optional - null means not taken)
      try {
        const aData = getLatestAssessment(db);
        if (aData) {
          setAssessmentStatus({
            hasTaken: true,
            lastCompletedAt: aData.completedAt,
            attemptId: aData.attemptId,
            domainScores: aData.domainScores?.map((d: { domain: string; domainScore: number }) => ({
              domain: d.domain,
              score: d.domainScore,
            })) || null,
          });
        } else {
          setAssessmentStatus({ hasTaken: false, lastCompletedAt: null, attemptId: null, domainScores: null });
        }
      } catch {
        setAssessmentStatus({ hasTaken: false, lastCompletedAt: null, attemptId: null, domainScores: null });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Failed to load dashboard data. Please try again.';
      setError(message);
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [user, db]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDashboard(controller.signal);
    return () => controller.abort();
  }, [fetchDashboard, fetchVersion]);

  // Determine if user is brand new (no data at all)
  const isNewUser = !isLoading && stats && stats.topics === 0 && stats.sessions === 0 && stats.insights === 0;

  // Most recently touched active/paused session, for the lead "Continue" block.
  const resumableSession = useMemo(() => {
    const candidates = sessions
      .filter((s) => s.status === 'active' || s.status === 'paused')
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      });
    return candidates[0] || null;
  }, [sessions]);

  const resumableTopicTitle = useMemo(() => {
    if (!resumableSession) return null;
    const fromBreakdown = stats?.topicInsightBreakdown.find((t) => t.topicId === resumableSession.topicId);
    if (fromBreakdown) return fromBreakdown.topicTitle;
    const fromActivity = activity.find(
      (a) => a.id === `session-paused-${resumableSession.id}` || a.id === `session-started-${resumableSession.id}`
    );
    if (fromActivity) return fromActivity.title;
    return 'this topic';
  }, [resumableSession, stats, activity]);

  const resumableInsightsCount = useMemo(() => {
    if (!resumableSession) return 0;
    return stats?.topicInsightBreakdown.find((t) => t.topicId === resumableSession.topicId)?.totalInsights ?? 0;
  }, [resumableSession, stats]);

  const resumableWhenLabel = useMemo(() => {
    if (!resumableSession) return '';
    if (resumableSession.status === 'paused') {
      return `Paused ${formatRelativeTime(resumableSession.updatedAt || resumableSession.createdAt)}`;
    }
    return `Started ${formatRelativeTime(resumableSession.createdAt)}`;
  }, [resumableSession]);

  // Insights awaiting a verify/reject decision — derived from already-fetched stats.
  const pendingInsightsCount = stats ? Math.max(stats.insights - stats.verifiedInsights - stats.rejectedInsights, 0) : 0;

  const dateline = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const firstName = user?.name?.split(' ')[0] || 'there';

  const glanceItems = [
    { key: 'topics', value: stats?.topicsExplored ?? 0, label: 'Topics explored' },
    { key: 'verified', value: stats?.verifiedInsights ?? 0, label: 'Verified insights' },
    { key: 'pending', value: pendingInsightsCount, label: 'Awaiting review', linked: true },
    { key: 'sessions', value: stats?.completedSessions ?? 0, label: 'Sessions completed' },
  ];

  const hasCategorizedTopics = !!stats?.categoryCompleteness?.some((c) => c.totalTopics > 0);

  return (
    <div className="max-w-6xl mx-auto overflow-x-hidden">
      {error && (
        <ApiErrorAlert
          message={error}
          onRetry={() => { setError(null); setFetchVersion((v) => v + 1); }}
          onDismiss={() => setError(null)}
          className="mb-6"
        />
      )}

      {/* Masthead */}
      <div className="flex items-baseline justify-between gap-4 pb-4 border-b border-ink dark:border-dark-border">
        <div className="flex items-baseline gap-2 text-[11px] tracking-[0.16em] uppercase font-sans font-bold">
          <span className="text-primary-600 dark:text-primary-400">The Desk</span>
          <span className="text-gray-400 dark:text-gray-600" aria-hidden="true">&middot;</span>
          <span className="text-gray-600 dark:text-gray-400 font-semibold">{dateline}</span>
        </div>
        <div className="text-[11px] tracking-[0.1em] uppercase font-sans font-semibold text-gray-400 dark:text-gray-600 whitespace-nowrap">
          Personal Edition
        </div>
      </div>

      <h1 className="font-serif italic font-medium text-3xl sm:text-4xl md:text-[42px] leading-[1.1] tracking-tight mt-5 mb-2 text-gray-900 dark:text-white">
        Where were we, {firstName}?
      </h1>
      <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-8">
        {isNewUser
          ? "Let’s start your first conversation."
          : 'Your knowledge, gathered one conversation at a time.'}
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] xl:gap-14 gap-10">
        {/* LEAD COLUMN */}
        <div className="xl:pr-14 xl:border-r xl:border-rule dark:xl:border-dark-border">
          {/* Lead "Continue"/"Start" feature */}
          <section aria-labelledby="lead-heading" className="pt-1 pb-7 border-b border-rule dark:border-dark-border">
            {isLoading ? (
              <div className="space-y-3" aria-hidden="true">
                <div className="h-3 w-32 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                <div className="h-9 w-2/3 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
              </div>
            ) : resumableSession ? (
              <>
                <p className="text-[11px] tracking-[0.16em] uppercase font-sans font-bold text-primary-600 dark:text-primary-400 mb-2">
                  Continue reading
                </p>
                <h2
                  id="lead-heading"
                  className="font-serif italic font-medium text-3xl sm:text-4xl leading-[1.06] tracking-tight text-gray-900 dark:text-white mb-3"
                >
                  {resumableTopicTitle}
                </h2>
                <p className="flex flex-wrap items-center gap-2 text-xs tracking-wide font-medium text-gray-500 dark:text-gray-400 mb-6">
                  <span>Interview session</span>
                  <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">&middot;</span>
                  <span>{resumableWhenLabel}</span>
                  <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">&middot;</span>
                  <span>{resumableInsightsCount} insight{resumableInsightsCount === 1 ? '' : 's'} so far</span>
                </p>
                <Link
                  to={`/app/sessions/${resumableSession.id}`}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  Resume the conversation
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
              </>
            ) : (
              <>
                <p className="text-[11px] tracking-[0.16em] uppercase font-sans font-bold text-primary-600 dark:text-primary-400 mb-2">
                  {isNewUser ? 'Get started' : 'Start here'}
                </p>
                <h2
                  id="lead-heading"
                  className="font-serif italic font-medium text-3xl sm:text-4xl leading-[1.06] tracking-tight text-gray-900 dark:text-white mb-3"
                >
                  {isNewUser ? 'Your story starts here.' : 'Ready for the next chapter?'}
                </h2>
                <p className="text-xs tracking-wide font-medium text-gray-500 dark:text-gray-400 mb-6">
                  {isNewUser
                    ? 'Your first conversation is a few minutes away.'
                    : `${stats?.topicsExplored ?? 0} topics explored so far.`}
                </p>
                <Link to="/app/topics" className="btn-primary inline-flex items-center gap-2">
                  Start an interview
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
              </>
            )}
          </section>

          {/* At a glance */}
          <section aria-label="At a glance" className="py-7 border-b border-rule dark:border-dark-border">
            <SectionHeading className="mb-5">At a glance</SectionHeading>
            {isLoading ? (
              <div className="flex gap-6" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex-1 space-y-2">
                    <div className="h-8 w-10 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                    <div className="h-2.5 w-16 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-y-6 overflow-x-auto">
                {glanceItems.map((item, idx) => {
                  const content = (
                    <>
                      <p
                        className={`font-serif italic font-medium text-3xl leading-none ${
                          item.linked ? 'text-primary-600 dark:text-primary-400' : 'text-gray-900 dark:text-white'
                        }`}
                      >
                        {item.value}
                      </p>
                      <p
                        className={`mt-2 text-[11px] tracking-[0.08em] uppercase font-sans font-semibold ${
                          item.linked
                            ? 'text-primary-600 dark:text-primary-400 border-b border-primary-300/60 dark:border-primary-700/60 inline-block pb-0.5'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {item.label}
                      </p>
                    </>
                  );
                  return (
                    <div
                      key={item.key}
                      className={`min-w-[130px] px-6 first:pl-0 last:pr-0 ${
                        idx !== glanceItems.length - 1 ? 'border-r border-rule dark:border-dark-border' : ''
                      }`}
                    >
                      {item.linked ? (
                        <Link
                          to="/app/review"
                          className="block rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                        >
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Recent activity */}
          <section aria-label="Recent activity" className="pt-7">
            <SectionHeading className="mb-4">Recent activity</SectionHeading>
            {isLoading ? (
              <div className="space-y-3" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                ))}
              </div>
            ) : activity.length === 0 ? (
              <EmptyState
                message="Nothing yet — your first conversation will appear here."
                action={
                  <Link to="/app/topics" className="btn-secondary text-sm">
                    Start an interview
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-rule dark:divide-dark-border">
                {activity.map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-4 py-3">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 min-w-0">
                      <span className="text-primary-600 dark:text-primary-400 mr-2" aria-hidden="true">&middot;</span>
                      <ActivityLine item={item} />
                    </p>
                    <span className="flex-shrink-0 text-[11px] tracking-wide text-gray-400 dark:text-gray-600 whitespace-nowrap">
                      {formatActivityDate(item.date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* RAIL */}
        <div className="flex flex-col gap-10">
          {/* In review */}
          <section aria-label="In review">
            <SectionHeading className="mb-4">In review</SectionHeading>
            {isLoading ? (
              <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" aria-hidden="true" />
            ) : pendingInsightsCount > 0 ? (
              <>
                <p className="font-serif italic text-lg leading-snug text-gray-900 dark:text-white mb-2">
                  {pendingInsightsCount} insight{pendingInsightsCount === 1 ? '' : 's'} awaiting your review.
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  Confirm, edit, or set aside what the interviewer surfaced.
                </p>
                <Link
                  to="/app/review"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                >
                  Open review queue <span aria-hidden="true">&rarr;</span>
                </Link>
              </>
            ) : (
              <EmptyState message="Nothing waiting on you right now." className="py-4" />
            )}
          </section>

          {/* Category completeness */}
          <section aria-label="Category completeness">
            <SectionHeading className="mb-5">Category completeness</SectionHeading>
            {isLoading ? (
              <div className="space-y-4" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-6 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                ))}
              </div>
            ) : hasCategorizedTopics ? (
              <div className="flex flex-col gap-4">
                {stats?.categoryCompleteness.map((cat) => (
                  <div key={cat.category}>
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-300">{cat.label}</span>
                      <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{cat.completeness}%</span>
                    </div>
                    <div
                      className="h-[2px] bg-rule dark:bg-dark-border rounded-full overflow-hidden"
                      role="progressbar"
                      aria-valuenow={cat.completeness}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${cat.label} completeness`}
                    >
                      <div
                        className="h-full bg-primary-500 dark:bg-primary-400 rounded-full transition-all duration-500"
                        style={{ width: `${cat.completeness}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                message="No categorized topics yet."
                action={
                  <Link to="/app/topics" className="btn-secondary text-sm">
                    Browse topics
                  </Link>
                }
                className="py-4"
              />
            )}
          </section>
        </div>
      </div>

      {/* Personality assessment nudge */}
      {!isLoading && !assessmentStatus.hasTaken && (
        <section
          aria-label="Personality assessment"
          className="mt-12 rounded-lg bg-panel dark:bg-dark-card px-6 py-6 sm:px-8 sm:py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        >
          <div>
            <h2 className="font-serif italic text-xl text-gray-900 dark:text-white mb-1">Who are you, really?</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 max-w-md">
              A scientifically validated Big Five assessment &mdash; 120 questions, about 15 minutes.
            </p>
          </div>
          <Link to="/app/personality" className="btn-primary whitespace-nowrap text-center flex-shrink-0">
            Take the assessment
          </Link>
        </section>
      )}
    </div>
  );
}
