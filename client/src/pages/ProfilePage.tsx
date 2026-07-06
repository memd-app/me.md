import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { Link, useLocation } from 'react-router-dom';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import { formatDateTime } from '@/utils/dateFormat';
import { getProfileSummary, regenerateProfile, exportAsMarkdown } from '@/services/profile';
import { getLatestAssessment } from '@/services/assessment';
import { isApiKeyConfigured } from '@/services/anthropic';
import {
  getFacetStaleness,
  getProfileFacets,
  synthesizeFacets,
  type FacetRecord,
} from '@/services/profileSynthesis';
import { useToast } from '@/contexts/ToastContext';
import { PageHeader, SectionHeading, EmptyState, Button, SimpleMarkdown } from '@/components/ui';

interface BigFiveDomainScore {
  domain: string;
  domainScore: number;
}

interface AssessmentLatest {
  attemptId: string;
  completedAt: string;
  domainScores: BigFiveDomainScore[];
}

const DOMAIN_LABELS: Record<string, string> = {
  O: 'Openness',
  C: 'Conscientiousness',
  E: 'Extraversion',
  A: 'Agreeableness',
  N: 'Neuroticism',
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

/**
 * A profile section: SectionHeading + serif reading text. Insights are
 * numbered with quiet two-digit editorial markers (DESIGN.md "Numbered
 * editorial markers") instead of colored checkmark icons.
 */
function ProfileSectionBlock({
  section,
  emptyMessage,
}: {
  section: ProfileSection;
  emptyMessage: string;
}) {
  const hasContent = section.content.length > 0;

  return (
    <section>
      <SectionHeading>{section.title}</SectionHeading>

      {hasContent && (
        <p className="mt-3 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400">
          {section.content.length} verified insight{section.content.length !== 1 ? 's' : ''}
        </p>
      )}

      {hasContent ? (
        <>
          <ul className="mt-4 space-y-3">
            {section.content.map((item, idx) => (
              <li key={idx} className="flex gap-3">
                <span className="shrink-0 pt-0.5 font-sans text-xs text-gray-400 dark:text-gray-600 tabular-nums">
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <span className="font-serif text-[15px] leading-relaxed text-gray-800 dark:text-gray-200 break-words">
                  {item}
                </span>
              </li>
            ))}
          </ul>
          {section.topicSources.length > 0 && (
            <p className="mt-4 pt-3 border-t border-rule dark:border-dark-border text-xs text-gray-500 dark:text-gray-400 break-words">
              <span className="font-semibold">Sources:</span> {section.topicSources.join(', ')}
            </p>
          )}
        </>
      ) : (
        <p className="mt-4 font-serif italic text-gray-500 dark:text-gray-400">{emptyMessage}</p>
      )}
    </section>
  );
}

export default function ProfilePage() {
  const { user } = useUser();
  const db = useDatabase();
  const location = useLocation();
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [assessmentData, setAssessmentData] = useState<AssessmentLatest | null>(null);
  const [facets, setFacets] = useState<FacetRecord[]>([]);
  const [facetStaleness, setFacetStaleness] = useState<{ insightCount: number; generatedAt: string | null; verifiedSince: number } | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const previousInsightCount = useRef<number | null>(null);
  const isMounted = useRef(true);
  const { addToast } = useToast();

  const fetchSummary = useCallback(async (showLoadingState = true, signal?: AbortSignal) => {
    if (!user) return;
    try {
      if (showLoadingState) setLoading(true);
      setError(null);
      const data = getProfileSummary(db);
      if (isMounted.current) {
        setSummary(data.summary);
        setFacets(getProfileFacets(db));
        setFacetStaleness(getFacetStaleness(db));
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
  const fetchAssessment = useCallback(async (_signal?: AbortSignal) => {
    if (!user) return;
    try {
      const data = getLatestAssessment(db);
      if (isMounted.current) setAssessmentData(data as AssessmentLatest | null);
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
      const data = regenerateProfile(db);
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
      const markdown = exportAsMarkdown(db);
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(user.name || 'user').replace(/[^a-zA-Z0-9]/g, '_')}_me.md`;
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

  const handleSynthesize = async () => {
    if (!user || !hasAnyInsights) return;
    if (!isApiKeyConfigured()) {
      addToast('Add your Anthropic API key in Settings to generate the analysis.', 'warning');
      return;
    }

    try {
      setSynthesizing(true);
      const nextFacets = await synthesizeFacets(db);
      setFacets(nextFacets);
      setFacetStaleness(getFacetStaleness(db));
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not generate the analysis', 'error');
    } finally {
      setSynthesizing(false);
    }
  };

  const handleCopyFacet = async (facet: FacetRecord) => {
    try {
      await navigator.clipboard.writeText(facet.body);
      addToast('Facet copied to clipboard');
    } catch {
      addToast('Could not copy facet', 'error');
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="animate-pulse space-y-8" aria-hidden="true">
          <div className="h-8 bg-gray-100 dark:bg-gray-800 rounded w-1/3" />
          <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
          <div className="space-y-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-3">
                <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/4" />
                <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-3/4" />
                <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-2/3" />
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
        <ApiErrorAlert
          message={error}
          onRetry={() => fetchSummary()}
          onDismiss={() => setError(null)}
        />
      </div>
    );
  }

  const hasAnyInsights = summary !== null && summary.totalVerifiedInsights > 0;
  const hasFacets = facets.length > 0;
  const canSynthesize = hasAnyInsights && isApiKeyConfigured();
  const synthesizeTitle = !hasAnyInsights
    ? 'Verify insights to generate a profile analysis.'
    : !canSynthesize
      ? 'Add your Anthropic API key in Settings to generate the analysis.'
      : hasFacets
        ? 'Regenerate profile analysis'
        : 'Generate profile analysis';

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Profile"
        subtitle={
          summary && summary.totalVerifiedInsights > 0 ? (
            <>
              Your auto-generated personal profile — {summary.totalVerifiedInsights} verified insight
              {summary.totalVerifiedInsights !== 1 ? 's' : ''} across {summary.topicsExplored} topic
              {summary.topicsExplored !== 1 ? 's' : ''}.
            </>
          ) : (
            'Your auto-generated personal profile.'
          )
        }
        actions={
          <>
            <Button variant="secondary" onClick={handleRegenerate} loading={regenerating}>
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </Button>
            <Button
              onClick={handleExportMarkdown}
              disabled={!hasAnyInsights}
              loading={exporting}
              title={!hasAnyInsights ? 'Need verified insights to export' : 'Export as me.md'}
            >
              {exporting ? 'Exporting…' : 'Export as me.md'}
            </Button>
            <Link
              to="/app/export"
              className="text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors whitespace-nowrap"
            >
              More export options &rarr;
            </Link>
          </>
        }
      />

      {/* Stat trio — serif-italic numerals over small-caps labels, like the Desk */}
      {summary && (
        <div className="flex flex-wrap gap-y-6 mb-10 pb-8 border-b border-rule dark:border-dark-border">
          {[
            { value: summary.totalVerifiedInsights, label: 'Verified insights' },
            { value: summary.topicsExplored, label: 'Topics explored' },
            {
              value: Object.values(summary.sections).filter((s) => s.content.length > 0).length,
              label: 'Profile sections',
            },
          ].map((item, idx) => (
            <div
              key={item.label}
              className={`min-w-[140px] px-6 first:pl-0 ${idx !== 2 ? 'border-r border-rule dark:border-dark-border' : ''}`}
            >
              <p className="font-serif italic font-medium text-3xl leading-none text-gray-900 dark:text-white">
                {item.value}
              </p>
              <p className="mt-2 text-[11px] tracking-[0.08em] uppercase font-sans font-semibold text-gray-500 dark:text-gray-400">
                {item.label}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Personality snapshot — typographic score levels, no colored pills */}
      {assessmentData ? (
        <section className="mb-10 pb-8 border-b border-rule dark:border-dark-border">
          <div className="flex items-center justify-between gap-4 mb-5">
            <SectionHeading className="flex-1">Personality</SectionHeading>
            <Link
              to={`/app/personality/${assessmentData.attemptId}/results`}
              className="shrink-0 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              View full results &rarr;
            </Link>
          </div>
          <div className="flex flex-col gap-4">
            {(['O', 'C', 'E', 'A', 'N'] as const).map((domain) => {
              const label = DOMAIN_LABELS[domain];
              const score = assessmentData.domainScores.find((d) => d.domain === domain);
              const scoreVal = score?.domainScore ?? 0;
              const pct = Math.round((scoreVal / 5) * 100);
              return (
                <div key={domain}>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-[12.5px] font-semibold font-sans uppercase tracking-[0.06em] text-gray-700 dark:text-gray-300">
                      {label}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-serif italic text-lg text-gray-900 dark:text-white">
                        {scoreVal.toFixed(1)}
                      </span>
                      <span className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400">
                        {getScoreLevel(scoreVal)}
                      </span>
                    </span>
                  </div>
                  <div
                    className="h-[2px] bg-rule dark:bg-dark-border rounded-full overflow-hidden"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${label} score`}
                  >
                    <div
                      className="h-full bg-primary-500 dark:bg-primary-400 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {assessmentData.completedAt && (
            <p className="text-xs text-gray-400 dark:text-gray-600 mt-4">
              Last assessed {formatDateTime(assessmentData.completedAt)}
            </p>
          )}
        </section>
      ) : !loading && (
        <section className="mb-10 pb-8 border-b border-rule dark:border-dark-border">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <SectionHeading className="mb-2">Personality</SectionHeading>
              <p className="font-serif italic text-gray-600 dark:text-gray-300 mt-3 max-w-md">
                Take the Big Five test to add personality insights to your profile.
              </p>
            </div>
            <Link to="/app/personality" className="btn-primary text-sm whitespace-nowrap shrink-0 text-center">
              Take the assessment
            </Link>
          </div>
        </section>
      )}

      {/* Profile analysis */}
      <section className="mb-10 pb-8 border-b border-rule dark:border-dark-border">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
          <div>
            <SectionHeading>Profile analysis</SectionHeading>
            {hasFacets && facetStaleness && (
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                Based on {facetStaleness.insightCount} verified insight{facetStaleness.insightCount !== 1 ? 's' : ''}
                {' '}&middot; generated {facetStaleness.generatedAt ? formatDateTime(facetStaleness.generatedAt) : 'unknown date'}
                {facetStaleness.verifiedSince > 0 && (
                  <>
                    {' '}&middot; {facetStaleness.verifiedSince} verified since
                  </>
                )}
              </p>
            )}
          </div>
          <Button
            onClick={handleSynthesize}
            disabled={!canSynthesize}
            loading={synthesizing}
            title={synthesizeTitle}
            className="shrink-0"
          >
            {synthesizing ? 'Analyzing…' : hasFacets ? 'Regenerate' : 'Generate analysis'}
          </Button>
        </div>

        {!hasAnyInsights ? (
          <EmptyState
            message="Verify insights to generate a profile analysis."
            className="py-8"
          />
        ) : hasFacets ? (
          <div className="space-y-8">
            {facets.map((facet) => (
              <article key={facet.key} className="pt-6 first:pt-0 border-t first:border-t-0 border-rule dark:border-dark-border">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                  <h3 className="font-serif text-xl text-gray-900 dark:text-white">
                    {facet.title}
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopyFacet(facet)}
                    className="self-start"
                  >
                    <span className="flex flex-col items-start leading-tight">
                      <span>Copy</span>
                      <span className="text-[11px] font-normal text-gray-400 dark:text-gray-500">
                        for an agent prompt
                      </span>
                    </span>
                  </Button>
                </div>
                <SimpleMarkdown content={facet.body} />
              </article>
            ))}
          </div>
        ) : (
          <p className="font-serif italic text-gray-500 dark:text-gray-400">
            Generate an agent-usable analysis from your verified insights.
          </p>
        )}
      </section>

      {/* Empty state when no verified insights */}
      {!hasAnyInsights && (
        <EmptyState
          kicker="No insights yet"
          message="Complete interview sessions and verify the extracted insights to build your personal profile. Each verified insight adds to your profile summary."
          action={
            <div className="flex justify-center gap-3">
              <Link to="/app/topics" className="btn-primary">
                Browse topics
              </Link>
              <Link to="/app/review" className="btn-secondary">
                Verify insights
              </Link>
            </div>
          }
          className="mb-10"
        />
      )}

      {/* Profile sections */}
      {summary && (
        <div className="space-y-10">
          <ProfileSectionBlock
            section={summary.sections.personalPortrait}
            emptyMessage="Complete more interview sessions to generate your personal portrait including values, beliefs, and core traits."
          />
          <ProfileSectionBlock
            section={summary.sections.communicationStyle}
            emptyMessage="Your communication patterns and preferences will appear here after verification."
          />
          <ProfileSectionBlock
            section={summary.sections.decisionMakingPatterns}
            emptyMessage="Your decision frameworks and patterns will be summarized here."
          />
          <ProfileSectionBlock
            section={summary.sections.strengthsAndExpertise}
            emptyMessage="An overview of your strengths and areas of expertise will appear after insights are verified."
          />
          <ProfileSectionBlock
            section={summary.sections.toneOfVoice}
            emptyMessage="Your tone of voice analysis with examples will appear here."
          />
          <ProfileSectionBlock
            section={summary.sections.keyThemes}
            emptyMessage="Key themes and connections across your topics will be visualized here."
          />
        </div>
      )}

      {/* Generated at timestamp */}
      {summary && summary.generatedAt && (
        <p className="mt-10 pt-6 border-t border-rule dark:border-dark-border text-xs text-gray-500 dark:text-gray-400 text-center">
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
