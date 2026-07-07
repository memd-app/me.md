import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useToast } from '@/contexts/ToastContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import { Button, EmptyState, SectionHeading, SimpleMarkdown } from '@/components/ui';
import { isApiKeyConfigured } from '@/services/anthropic';
import {
  extractStandfirst,
  getShowcaseSourceInsights,
  selectShowcase,
  splitFacetBody,
  type ShowcaseSelection,
} from '@/services/insightShowcase';
import { getPersonalityExportData, type PersonalityExportData } from '@/services/profile';
import { getRiasecExportData } from '@/services/riasec';
import { getValuesExportData } from '@/services/values';
import {
  getFacetStaleness,
  getProfileFacets,
  synthesizeFacets,
  type FacetRecord,
} from '@/services/profileSynthesis';
import { formatDateTime } from '@/utils/dateFormat';

type FacetStaleness = NonNullable<ReturnType<typeof getFacetStaleness>>;

const EMPTY_SHOWCASE: ShowcaseSelection = { quotes: [], tensionPair: null };
const DOMAIN_ORDER = ['O', 'C', 'E', 'A', 'N'] as const;

const KIND_CAPTION_LABELS: Record<string, string> = {
  belief: 'Belief',
  value: 'Value',
  trait: 'Trait',
  habit: 'Habit',
  preference: 'Preference',
  goal: 'Goal',
  motivation: 'Motivation',
  relationship_pattern: 'Relationship pattern',
  self_assessment: 'Self-assessment',
};

function kindLabel(kind: string | null): string {
  return kind ? KIND_CAPTION_LABELS[kind] ?? 'Insight' : 'Insight';
}

function MetaDot() {
  return <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">&middot;</span>;
}

function AboutLoading() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="animate-pulse space-y-8" aria-hidden="true">
        <div className="space-y-4">
          <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-16" />
          <div className="h-12 bg-gray-100 dark:bg-gray-800 rounded w-2/3" />
          <div className="h-6 bg-gray-100 dark:bg-gray-800 rounded w-3/4" />
        </div>
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-3">
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/4" />
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-5/6" />
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyInsightLoop() {
  const steps = [
    { text: 'Sit for an interview.', to: '/app/topics', label: 'Interviews' },
    { text: 'Review what it surfaced.', to: '/app/review', label: 'Review' },
    { text: 'Return here to read the portrait.', to: null, label: null },
  ];

  return (
    <section className="py-12 border-b border-rule dark:border-dark-border">
      <p className="font-serif italic text-xl text-gray-600 dark:text-gray-300 max-w-md">
        This page writes itself from what you verify. It starts with a conversation.
      </p>
      <ol className="mt-8 space-y-5">
        {steps.map((step, index) => (
          <li key={step.text} className="flex items-baseline gap-4">
            <span className="font-sans text-xs text-gray-400 dark:text-gray-600 tabular-nums" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <p className="font-serif text-[17px] leading-relaxed text-gray-700 dark:text-gray-300">
              {step.text}
              {step.to && step.label && (
                <>
                  {' '}
                  <Link
                    to={step.to}
                    className="font-sans text-[11px] uppercase tracking-[0.08em] font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                  >
                    {step.label} &rarr;
                  </Link>
                </>
              )}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ShowcaseSection({ showcase }: { showcase: ShowcaseSelection }) {
  if (showcase.quotes.length === 0 && !showcase.tensionPair) return null;

  return (
    <section aria-label="In their own words" className="py-10 border-b border-rule dark:border-dark-border">
      <SectionHeading className="mb-8">In their own words</SectionHeading>

      {showcase.quotes.map((quote) => (
        <figure
          key={quote.id}
          className="border-l-2 border-primary-400/60 dark:border-primary-500/60 pl-5 sm:pl-6 py-1 my-8 first:mt-0 last:mb-0 print:break-inside-avoid"
        >
          <blockquote className="font-serif italic text-xl sm:text-2xl leading-[1.45] text-gray-900 dark:text-white">
            “{quote.content.trim()}”
          </blockquote>
          <figcaption className="mt-3 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400">
            {kindLabel(quote.kind)} &middot; verified &middot; {quote.confidenceScore}
            {quote.topicTitle && <> &middot; {quote.topicTitle}</>}
          </figcaption>
        </figure>
      ))}

      {showcase.tensionPair && (
        <div className="mt-10 bg-panel dark:bg-dark-card rounded-md px-5 py-5 sm:px-6 print:break-inside-avoid">
          <p className="uppercase text-[11px] tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400 mb-4">
            Held in tension
          </p>
          <blockquote className="font-serif italic text-lg leading-snug text-gray-900 dark:text-white">
            “{showcase.tensionPair.tension.content.trim()}”
          </blockquote>
          {showcase.tensionPair.counterpart && (
            <>
              <p className="my-3 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-400 dark:text-gray-600">
                and yet
              </p>
              <blockquote className="font-serif italic text-lg leading-snug text-gray-700 dark:text-gray-300">
                “{showcase.tensionPair.counterpart.content.trim()}”
              </blockquote>
            </>
          )}
          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            Both verified. Contradictions are material, not errors.
          </p>
        </div>
      )}
    </section>
  );
}

type RiasecExportData = ReturnType<typeof getRiasecExportData>;
type ValuesExportData = ReturnType<typeof getValuesExportData>;

function BigFiveBand({
  personality,
  riasec,
  values,
}: {
  personality: PersonalityExportData | null;
  riasec: RiasecExportData | null;
  values: ValuesExportData | null;
}) {
  const hasAssessment = personality?.hasAssessment ?? false;
  const domainScores = DOMAIN_ORDER
    .map(domain => personality?.domainScores.find(score => score.domain === domain))
    .filter((score): score is PersonalityExportData['domainScores'][number] => Boolean(score));
  const attemptId = personality?.latestAttempt?.attemptId;
  const completedAt = personality?.latestAttempt?.completedAt;

  return (
    <section aria-label="Big Five" className="py-10 border-b border-rule dark:border-dark-border">
      <div className="flex items-center justify-between gap-4 mb-6">
        <SectionHeading className="flex-1">By the numbers</SectionHeading>
        {hasAssessment && attemptId && (
          <Link
            to={`/app/personality/${attemptId}/results`}
            className="shrink-0 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            Full assessment &rarr;
          </Link>
        )}
      </div>

      {hasAssessment && domainScores.length > 0 ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-8 gap-y-6">
            {domainScores.map((d) => {
              const pct = Math.round((d.score / 5) * 100);
              return (
                <div key={d.domain}>
                  <p className="font-serif italic text-2xl leading-none text-gray-900 dark:text-white">
                    {d.score.toFixed(1)}
                  </p>
                  <p className="mt-1.5 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-700 dark:text-gray-300">
                    {d.domainLabel === 'Openness to Experience' ? 'Openness' : d.domainLabel}
                  </p>
                  <p className="text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-400 dark:text-gray-600">
                    {d.level}
                  </p>
                  <div
                    className="mt-2 h-[2px] bg-rule dark:bg-dark-border rounded-full overflow-hidden"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${d.domainLabel} score`}
                  >
                    <div
                      className="h-full bg-primary-500 dark:bg-primary-400 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {completedAt && (
            <p className="mt-5 text-xs text-gray-400 dark:text-gray-600">
              IPIP-NEO &middot; 120 questions &middot; last assessed {formatDateTime(completedAt)}
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="font-serif italic text-gray-500 dark:text-gray-400">
            A measured baseline is missing — the Big Five assessment takes about 15 minutes.
          </p>
          <Link
            to="/app/personality"
            className="shrink-0 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            Take the assessment
          </Link>
        </div>
      )}

      {(riasec?.hasRiasec || values?.hasValues) && (
        <div className="mt-8 space-y-4 border-t border-rule dark:border-dark-border pt-6">
          {riasec?.hasRiasec && riasec.attemptId && (
            <Link
              to={`/app/personality/${riasec.attemptId}/results`}
              className="block text-sm text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              <span className="font-serif italic text-xl text-gray-900 dark:text-white">{riasec.code}</span>
              {' '}— {riasec.code.split('').map(domain => riasec.scales.find(scale => scale.domain === domain)?.label).filter(Boolean).join(' · ')}
            </Link>
          )}

          {values?.hasValues && values.attemptId && (
            <Link
              to={`/app/personality/${values.attemptId}/results`}
              className="block text-sm text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              <span className="font-serif italic text-xl text-gray-900 dark:text-white">
                {values.dominant.map(value => value.label).join(' · ')}
              </span>
              {values.least_active.length > 0 && (
                <span className="text-gray-500 dark:text-gray-500">
                  {' '}— least active: {values.least_active.map(value => value.label.toLowerCase()).join(', ')}
                </span>
              )}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

export default function AboutMePage() {
  const { user } = useUser();
  const db = useDatabase();
  const location = useLocation();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [facets, setFacets] = useState<FacetRecord[]>([]);
  const [facetStaleness, setFacetStaleness] = useState<FacetStaleness | null>(null);
  const [showcase, setShowcase] = useState<ShowcaseSelection>(EMPTY_SHOWCASE);
  const [personality, setPersonality] = useState<PersonalityExportData | null>(null);
  const [riasec, setRiasec] = useState<RiasecExportData | null>(null);
  const [values, setValues] = useState<ValuesExportData | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const isMounted = useRef(true);

  const refreshAbout = useCallback((showLoadingState = true, signal?: AbortSignal) => {
    if (!user) {
      if (showLoadingState) setLoading(false);
      return;
    }

    try {
      if (showLoadingState) setLoading(true);
      setError(null);
      const sourceInsights = getShowcaseSourceInsights(db);
      const nextFacets = getProfileFacets(db);
      const nextPersonality = getPersonalityExportData(db, 'exportable');
      const nextRiasec = getRiasecExportData(db);
      const nextValues = getValuesExportData(db);

      if (isMounted.current && !signal?.aborted) {
        setVerifiedCount(sourceInsights.length);
        setFacets(nextFacets);
        setFacetStaleness(getFacetStaleness(db));
        setShowcase(selectShowcase(sourceInsights));
        setPersonality(nextPersonality);
        setRiasec(nextRiasec);
        setValues(nextValues);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : 'Failed to load About me');
      }
    } finally {
      if (isMounted.current && showLoadingState && !signal?.aborted) {
        setLoading(false);
      }
    }
  }, [db, user]);

  useEffect(() => {
    isMounted.current = true;
    const controller = new AbortController();
    refreshAbout(true, controller.signal);
    return () => {
      isMounted.current = false;
      controller.abort();
    };
  }, [refreshAbout, location.key]);

  useEffect(() => {
    const refresh = () => {
      if (user) refreshAbout(false);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', refresh);
    };
  }, [refreshAbout, user]);

  const identityFacet = facets.find(facet => facet.key === 'identity_values');
  const standfirst = extractStandfirst(identityFacet?.body);
  const hasFacets = facets.length > 0;
  const hasVerifiedInsights = verifiedCount > 0;
  const hasAssessment = personality?.hasAssessment ?? false;
  const canSynthesize = hasVerifiedInsights && isApiKeyConfigured();
  const synthesizeTitle = !hasVerifiedInsights
    ? 'Verify insights to generate a profile analysis.'
    : !canSynthesize
      ? 'Add your Anthropic API key in Settings to generate the analysis.'
      : hasFacets
        ? 'Rewrite the portrait'
        : 'Write the portrait';

  const facetBodies = useMemo(
    () => facets.map(facet => ({ facet, ...splitFacetBody(facet.body) })),
    [facets],
  );

  const handleSynthesize = async () => {
    if (!user || !hasVerifiedInsights) return;
    if (!isApiKeyConfigured()) {
      addToast('Add your Anthropic API key in Settings to generate the analysis.', 'warning');
      return;
    }

    try {
      setSynthesizing(true);
      const nextFacets = await synthesizeFacets(db);
      if (isMounted.current) {
        setFacets(nextFacets);
        setFacetStaleness(getFacetStaleness(db));
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not generate the analysis', 'error');
    } finally {
      if (isMounted.current) setSynthesizing(false);
    }
  };

  if (loading) return <AboutLoading />;

  if (error) {
    return (
      <div className="max-w-3xl mx-auto">
        <ApiErrorAlert
          message={error}
          onRetry={() => refreshAbout()}
          onDismiss={() => setError(null)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <header className="pt-2 pb-10 border-b border-rule dark:border-dark-border">
        <p className="uppercase text-[11px] tracking-[0.16em] font-sans font-bold text-primary-600 dark:text-primary-400 mb-3">
          About
        </p>
        <h1 className="font-serif font-medium text-4xl sm:text-5xl md:text-[52px] leading-[1.05] tracking-tight text-gray-900 dark:text-white">
          {user?.name || 'You'}
        </h1>
        {standfirst ? (
          <p className="mt-4 font-serif italic text-xl sm:text-2xl leading-snug text-gray-600 dark:text-gray-300 max-w-[40ch]">
            {standfirst}
          </p>
        ) : (
          <p className="mt-4 font-serif italic text-lg text-gray-400 dark:text-gray-500">
            A portrait, drawn from what you verify.
          </p>
        )}
        <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase tracking-[0.08em] font-sans font-semibold text-gray-500 dark:text-gray-400">
          <span>{verifiedCount} verified insight{verifiedCount === 1 ? '' : 's'}</span>
          <MetaDot />
          <span>{hasAssessment ? 'Big Five taken' : 'Big Five not taken'}</span>
          {facetStaleness?.generatedAt && (
            <>
              <MetaDot />
              <span>Updated {formatDateTime(facetStaleness.generatedAt)}</span>
            </>
          )}
        </p>
      </header>

      {hasVerifiedInsights ? (
        <>
          <ShowcaseSection showcase={showcase} />

          <div className="pt-10 pb-2 flex flex-wrap items-center justify-between gap-4">
            <SectionHeading className="flex-1 min-w-[200px]">The portrait</SectionHeading>
            {hasFacets && (
              <div className="flex items-center gap-4 print:hidden">
                {facetStaleness && facetStaleness.verifiedSince > 0 && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {facetStaleness.verifiedSince} verified since this was written
                  </span>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSynthesize}
                  disabled={!canSynthesize}
                  loading={synthesizing}
                  title={synthesizeTitle}
                >
                  {synthesizing ? 'Rewriting…' : 'Rewrite the portrait'}
                </Button>
              </div>
            )}
          </div>

          {hasFacets ? (
            facetBodies.map(({ facet, main, tensions }, index) => (
              <article key={facet.key} className="py-10 border-b border-rule dark:border-dark-border print:break-inside-avoid">
                <div className="flex items-baseline gap-4 mb-5">
                  <span className="font-sans text-xs text-gray-400 dark:text-gray-600 tabular-nums" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h2 className="font-serif text-2xl sm:text-[28px] leading-tight text-gray-900 dark:text-white">
                    {facet.title}
                  </h2>
                </div>

                <SimpleMarkdown content={main} />

                {tensions && (
                  <aside className="mt-6 border-l-2 border-primary-400/40 dark:border-primary-500/40 pl-5">
                    <p className="uppercase text-[11px] tracking-[0.08em] font-sans font-semibold text-primary-600 dark:text-primary-400 mb-2">
                      Tensions &amp; open questions
                    </p>
                    <div className="font-serif italic text-[16px] leading-[1.65] text-gray-600 dark:text-gray-300 max-w-[65ch] [&_p]:my-1.5 [&_strong]:font-semibold">
                      <SimpleMarkdown content={tensions} />
                    </div>
                  </aside>
                )}
              </article>
            ))
          ) : (
            <section className="pb-10 border-b border-rule dark:border-dark-border">
              <EmptyState
                message="The interviews are done; the portrait isn't written yet."
                action={
                  <Button
                    onClick={handleSynthesize}
                    disabled={!canSynthesize}
                    loading={synthesizing}
                    title={synthesizeTitle}
                    className="print:hidden"
                  >
                    {synthesizing ? 'Rewriting…' : 'Write the portrait'}
                  </Button>
                }
              />
            </section>
          )}
        </>
      ) : (
        <EmptyInsightLoop />
      )}

      <BigFiveBand personality={personality} riasec={riasec} values={values} />

      <footer className="py-8 text-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Drawn entirely from insights you verified &middot; nothing here was written without your sign-off
        </p>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-600 print:hidden">
          <Link to="/app/profile" className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
            Export and agent copies live on your profile &rarr;
          </Link>
        </p>
      </footer>
    </div>
  );
}
