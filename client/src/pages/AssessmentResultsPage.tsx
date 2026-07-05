import PageTabs from '@/components/ui/PageTabs';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { getAttemptResults, generateInsightsForAttempt } from '@/services/assessment';

// ============================================
// Types
// ============================================

interface FacetResult {
  facet: number;
  title: string;
  text: string;
  score: number;
  count: number;
  scoreText: string;
}

interface DomainResult {
  domain: string;
  title: string;
  shortDescription: string;
  description: string;
  scoreText: string;
  count: number;
  score: number;
  facets: FacetResult[];
  text: string;
}

interface DomainScoreData {
  domain: string;
  domainScore: number;
  facetScores: {
    facet1: number | null;
    facet2: number | null;
    facet3: number | null;
    facet4: number | null;
    facet5: number | null;
    facet6: number | null;
  };
}

interface AIInsight {
  id: string;
  content: string;
  confidenceScore: number;
  verificationStatus: string;
  extractionMethod: string;
}

interface AIAnalysisData {
  insights: AIInsight[];
  agreements: string[];
  contradictions: string[];
  generated: boolean;
}

interface AssessmentResultsData {
  attemptId: string;
  status: string;
  startedAt: string;
  completedAt: string;
  domainScores: DomainScoreData[];
  results: DomainResult[];
  aiAnalysis?: AIAnalysisData;
}

// ============================================
// Constants
// ============================================

const DOMAIN_ORDER = ['O', 'C', 'E', 'A', 'N'];

const DOMAIN_META: Record<string, { label: string; icon: string; color: string; bgClass: string; textClass: string; barClass: string; borderClass: string; ringClass: string }> = {
  O: {
    label: 'Openness',
    icon: '\uD83C\uDFA8',
    color: '#3B82F6',
    bgClass: 'bg-blue-100 dark:bg-blue-900/30',
    textClass: 'text-blue-800 dark:text-blue-300',
    barClass: 'bg-blue-500',
    borderClass: 'border-blue-200 dark:border-blue-700',
    ringClass: 'ring-blue-500',
  },
  C: {
    label: 'Conscientiousness',
    icon: '\uD83D\uDCCB',
    color: '#8B5CF6',
    bgClass: 'bg-purple-100 dark:bg-purple-900/30',
    textClass: 'text-purple-800 dark:text-purple-300',
    barClass: 'bg-purple-500',
    borderClass: 'border-purple-200 dark:border-purple-700',
    ringClass: 'ring-purple-500',
  },
  E: {
    label: 'Extraversion',
    icon: '\uD83D\uDDE3\uFE0F',
    color: '#F59E0B',
    bgClass: 'bg-amber-100 dark:bg-amber-900/30',
    textClass: 'text-amber-800 dark:text-amber-300',
    barClass: 'bg-amber-500',
    borderClass: 'border-amber-200 dark:border-amber-700',
    ringClass: 'ring-amber-500',
  },
  A: {
    label: 'Agreeableness',
    icon: '\uD83E\uDD1D',
    color: '#10B981',
    bgClass: 'bg-emerald-100 dark:bg-emerald-900/30',
    textClass: 'text-emerald-800 dark:text-emerald-300',
    barClass: 'bg-emerald-500',
    borderClass: 'border-emerald-200 dark:border-emerald-700',
    ringClass: 'ring-emerald-500',
  },
  N: {
    label: 'Neuroticism',
    icon: '\uD83E\uDDE0',
    color: '#F43F5E',
    bgClass: 'bg-rose-100 dark:bg-rose-900/30',
    textClass: 'text-rose-800 dark:text-rose-300',
    barClass: 'bg-rose-500',
    borderClass: 'border-rose-200 dark:border-rose-700',
    ringClass: 'ring-rose-500',
  },
};

// Facet labels for each domain (from IPIP NEO-PI-R)
const FACET_LABELS: Record<string, string[]> = {
  N: ['Anxiety', 'Anger', 'Depression', 'Self-Consciousness', 'Immoderation', 'Vulnerability'],
  E: ['Friendliness', 'Gregariousness', 'Assertiveness', 'Activity Level', 'Excitement-Seeking', 'Cheerfulness'],
  O: ['Imagination', 'Artistic Interests', 'Emotionality', 'Adventurousness', 'Intellect', 'Liberalism'],
  A: ['Trust', 'Morality', 'Altruism', 'Cooperation', 'Modesty', 'Sympathy'],
  C: ['Self-Efficacy', 'Orderliness', 'Dutifulness', 'Achievement-Striving', 'Self-Discipline', 'Cautiousness'],
};

function getScoreLevel(score: number): { label: string; colorClass: string } {
  if (score >= 4) return { label: 'High', colorClass: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20' };
  if (score >= 3.5) return { label: 'Above Average', colorClass: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' };
  if (score >= 2.5) return { label: 'Average', colorClass: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20' };
  if (score >= 2) return { label: 'Below Average', colorClass: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20' };
  return { label: 'Low', colorClass: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20' };
}

// ============================================
// Radar Chart Component (SVG-based, no D3 dependency needed)
// ============================================

interface RadarChartProps {
  domainScores: Record<string, number>;
}

function RadarChart({ domainScores }: RadarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 300);
    return () => clearTimeout(timer);
  }, []);

  const size = 300;
  const center = size / 2;
  const maxRadius = size / 2 - 40;
  const levels = 5; // 5 concentric rings for scores 1-5
  const domains = DOMAIN_ORDER;
  const angleStep = (2 * Math.PI) / domains.length;
  // Start from top (12 o'clock position) by offsetting by -90 degrees
  const startAngle = -Math.PI / 2;

  const getPoint = (domainIndex: number, value: number): { x: number; y: number } => {
    const angle = startAngle + domainIndex * angleStep;
    const radius = (value / 5) * maxRadius;
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    };
  };

  // Generate polygon points for the score shape
  const scorePoints = domains.map((d, i) => {
    const score = domainScores[d] || 0;
    return getPoint(i, animated ? score : 0);
  });
  const scorePolygon = scorePoints.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div className="flex justify-center">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size} ${size}`}
        className="w-full max-w-[300px] h-auto"
        role="img"
        aria-label="Radar chart showing Big Five personality scores"
      >
        {/* Background grid rings */}
        {Array.from({ length: levels }, (_, i) => {
          const levelRadius = ((i + 1) / levels) * maxRadius;
          const points = domains.map((_, di) => {
            const angle = startAngle + di * angleStep;
            return `${center + levelRadius * Math.cos(angle)},${center + levelRadius * Math.sin(angle)}`;
          }).join(' ');
          return (
            <polygon
              key={`ring-${i}`}
              points={points}
              fill="none"
              stroke="currentColor"
              className="text-gray-200 dark:text-gray-700"
              strokeWidth={i === levels - 1 ? 1.5 : 0.8}
            />
          );
        })}

        {/* Axis lines from center to each vertex */}
        {domains.map((_, i) => {
          const outerPoint = getPoint(i, 5);
          return (
            <line
              key={`axis-${i}`}
              x1={center}
              y1={center}
              x2={outerPoint.x}
              y2={outerPoint.y}
              stroke="currentColor"
              className="text-gray-200 dark:text-gray-700"
              strokeWidth={0.8}
            />
          );
        })}

        {/* Score polygon (filled area) */}
        <polygon
          points={scorePolygon}
          fill="rgba(99, 102, 241, 0.2)"
          stroke="rgb(99, 102, 241)"
          strokeWidth={2}
          className="transition-all duration-1000 ease-out"
        />

        {/* Score dots */}
        {scorePoints.map((p, i) => (
          <circle
            key={`dot-${i}`}
            cx={p.x}
            cy={p.y}
            r={4}
            fill={DOMAIN_META[domains[i]]?.color || '#6366F1'}
            stroke="white"
            strokeWidth={2}
            className="transition-all duration-1000 ease-out"
          />
        ))}

        {/* Domain labels */}
        {domains.map((d, i) => {
          const labelPoint = getPoint(i, 5.8);
          const meta = DOMAIN_META[d];
          return (
            <text
              key={`label-${d}`}
              x={labelPoint.x}
              y={labelPoint.y}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-gray-700 dark:fill-gray-300 text-[10px] font-semibold"
            >
              {meta?.icon} {meta?.label || d}
            </text>
          );
        })}

        {/* Score values near dots */}
        {domains.map((d, i) => {
          const score = domainScores[d] || 0;
          const valuePoint = getPoint(i, animated ? Math.min(score + 0.7, 5.3) : 0.7);
          return (
            <text
              key={`value-${d}`}
              x={valuePoint.x}
              y={valuePoint.y}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-gray-600 dark:fill-gray-400 text-[9px] font-bold transition-all duration-1000"
            >
              {animated ? score.toFixed(1) : ''}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ============================================
// Domain Card Component
// ============================================

interface DomainCardProps {
  domainScoreData: DomainScoreData;
  domainResult?: DomainResult;
  animationDelay: number;
}

function DomainCard({ domainScoreData, domainResult, animationDelay }: DomainCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const domain = domainScoreData.domain;
  const meta = DOMAIN_META[domain];
  const score = domainScoreData.domainScore;
  const scorePercent = Math.round((score / 5) * 100);
  const level = getScoreLevel(score);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), animationDelay);
    return () => clearTimeout(timer);
  }, [animationDelay]);

  // Build facet data
  const facetScoresRaw = domainScoreData.facetScores;
  const facetScoresArr = [
    facetScoresRaw.facet1,
    facetScoresRaw.facet2,
    facetScoresRaw.facet3,
    facetScoresRaw.facet4,
    facetScoresRaw.facet5,
    facetScoresRaw.facet6,
  ];
  const facetLabels = FACET_LABELS[domain] || [];
  const resultFacets = domainResult?.facets || [];

  if (!meta) return null;

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      {/* Domain Header */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${meta.bgClass} ${meta.textClass}`}>
              {meta.icon} {domainResult?.title || meta.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${level.colorClass}`}>
              {domainResult?.scoreText || level.label}
            </span>
            <span className="text-xl font-bold text-gray-900 dark:text-white">
              {score.toFixed(1)}<span className="text-sm text-gray-400 font-normal">/5</span>
            </span>
          </div>
        </div>

        {/* Score bar */}
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-3">
          <div
            className={`${meta.barClass} h-2.5 rounded-full transition-all duration-1000 ease-out`}
            style={{ width: visible ? `${scorePercent}%` : '0%' }}
          />
        </div>

        {/* Short description */}
        {domainResult?.shortDescription && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            {domainResult.shortDescription}
          </p>
        )}

        {/* Detailed description */}
        {domainResult?.text && (
          <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
            {domainResult.text}
          </p>
        )}

        {/* Expand facets button */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
        >
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {expanded ? 'Hide' : 'Show'} Facet Breakdown ({facetScoresArr.filter(s => s !== null).length} facets)
        </button>
      </div>

      {/* Expandable Facet Breakdown */}
      {expanded && (
        <div className={`border-t ${meta.borderClass} bg-gray-50 dark:bg-gray-800/50 px-5 py-4`}>
          <div className="space-y-3">
            {facetScoresArr.map((facetScore, idx) => {
              if (facetScore === null || facetScore === undefined) return null;
              const facetLabel = facetLabels[idx] || `Facet ${idx + 1}`;
              const facetPercent = Math.round((facetScore / 5) * 100);
              const facetLevel = getScoreLevel(facetScore);
              const resultFacet = resultFacets.find(f => f.facet === idx + 1);

              return (
                <div key={idx}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {resultFacet?.title || facetLabel}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${facetLevel.colorClass}`}>
                        {resultFacet?.scoreText || facetLevel.label}
                      </span>
                      <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">
                        {facetScore.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                    <div
                      className={`${meta.barClass} h-1.5 rounded-full transition-all duration-700 ease-out`}
                      style={{ width: `${facetPercent}%`, opacity: 0.7 }}
                    />
                  </div>
                  {resultFacet?.text && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                      {resultFacet.text}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Results Page Component
// ============================================

export default function AssessmentResultsPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const { user } = useUser();
  const db = useDatabase();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AssessmentResultsData | null>(null);
  const [generatingInsights, setGeneratingInsights] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  // ============================================
  // Fetch results
  // ============================================

  const fetchResults = useCallback(async () => {
    if (!user || !attemptId) return;
    setLoading(true);
    setError(null);

    try {
      const resultData = getAttemptResults(db, attemptId) as AssessmentResultsData;
      setData(resultData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, attemptId, db]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  // ============================================
  // Generate AI Insights (manual trigger)
  // ============================================

  const handleGenerateInsights = useCallback(async () => {
    if (!user || !attemptId) return;
    setGeneratingInsights(true);
    setInsightError(null);

    try {
      await generateInsightsForAttempt(db, attemptId);

      // Refresh results to pick up new insights
      await fetchResults();
    } catch (err: any) {
      setInsightError(err.message);
    } finally {
      setGeneratingInsights(false);
    }
  }, [user, attemptId, db, fetchResults]);

  // ============================================
  // Print handler
  // ============================================

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // ============================================
  // Render: Loading
  // ============================================

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400">Loading your results...</p>
        </div>
      </div>
    );
  }

  // ============================================
  // Render: Error
  // ============================================

  if (error || !data) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
            <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Could Not Load Results
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {error || 'No results data available'}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/app/personality"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-xl transition-colors"
            >
              Go to Assessment
            </Link>
            <button
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium rounded-xl transition-colors"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // Build domain scores map for radar chart
  // ============================================

  const domainScoresMap: Record<string, number> = {};
  for (const ds of data.domainScores) {
    domainScoresMap[ds.domain] = ds.domainScore;
  }

  // Sort domain scores in OCEAN order
  const sortedDomainScores = DOMAIN_ORDER
    .map(d => data.domainScores.find(ds => ds.domain === d))
    .filter((ds): ds is DomainScoreData => ds !== undefined);

  // Map results by domain for easy lookup
  const resultsByDomain: Record<string, DomainResult> = {};
  for (const r of data.results) {
    resultsByDomain[r.domain] = r;
  }

  const completedDate = data.completedAt
    ? new Date(data.completedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Unknown';

  // ============================================
  // Render: Results Dashboard
  // ============================================

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 print:py-2 print:px-0">
      {/* Header */}
      <div className="mb-8 print:mb-4">
        <div className="flex items-center justify-between mb-4 print:hidden">
          <Link
            to="/app/personality"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Assessment
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="Print results"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print
            </button>
          </div>
        </div>

      <div className="print:hidden">
      <PageTabs
        tabs={[
          { to: '/app/personality', label: 'Take the test', end: true },
          { to: '/app/personality/history', label: 'History' },
        ]}
      />
      </div>
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 mb-4 print:mb-2">
            <svg className="w-8 h-8 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Your Big Five Personality Profile
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Completed on {completedDate}
          </p>
        </div>
      </div>

      {/* Radar Chart Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-8 print:mb-4 print:shadow-none print:border-gray-300">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-4">
          Personality Overview
        </h2>
        <RadarChart domainScores={domainScoresMap} />

        {/* Quick score summary below chart */}
        <div className="grid grid-cols-5 gap-2 mt-6">
          {DOMAIN_ORDER.map(d => {
            const meta = DOMAIN_META[d];
            const score = domainScoresMap[d] || 0;
            return (
              <div key={d} className="text-center">
                <div className="text-lg">{meta.icon}</div>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">
                  {meta.label}
                </div>
                <div className="text-lg font-bold text-gray-900 dark:text-white">
                  {score.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Domain Cards */}
      <div className="space-y-4 mb-8 print:mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Detailed Domain Breakdown
        </h2>
        {sortedDomainScores.map((ds, index) => (
          <DomainCard
            key={ds.domain}
            domainScoreData={ds}
            domainResult={resultsByDomain[ds.domain]}
            animationDelay={200 + index * 150}
          />
        ))}
      </div>

      {/* AI Analysis Section */}
      <div className="mb-8 print:mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI Analysis
          </h2>
          {(!data.aiAnalysis || !data.aiAnalysis.generated || data.aiAnalysis.insights.length === 0) && (
            <button
              onClick={handleGenerateInsights}
              disabled={generatingInsights}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed print:hidden"
            >
              {generatingInsights ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate AI Insights
                </>
              )}
            </button>
          )}
        </div>

        {insightError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
            {insightError}
          </div>
        )}

        {data.aiAnalysis && data.aiAnalysis.generated && data.aiAnalysis.insights.length > 0 ? (
          <div className="space-y-4">
            {/* Insight Cards */}
            <div className="grid gap-3">
              {data.aiAnalysis.insights.map((insight, idx) => (
                <div
                  key={insight.id || idx}
                  className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed flex-1">
                      {insight.content}
                    </p>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        insight.confidenceScore >= 85 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                        insight.confidenceScore >= 70 ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                        'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                      }`}>
                        {insight.confidenceScore}%
                      </span>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        insight.verificationStatus === 'verified' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                        insight.verificationStatus === 'rejected' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                        'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}>
                        {insight.verificationStatus === 'unverified' ? 'Pending' : insight.verificationStatus}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Agreements */}
            {data.aiAnalysis.agreements.length > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800 p-4">
                <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 mb-2 flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Agreements with Interview Insights
                </h3>
                <ul className="space-y-1.5">
                  {data.aiAnalysis.agreements.map((agreement, idx) => (
                    <li key={idx} className="text-sm text-emerald-700 dark:text-emerald-300/80 flex items-start gap-2">
                      <span className="text-emerald-500 mt-0.5 flex-shrink-0">&#8226;</span>
                      {agreement}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Contradictions */}
            {data.aiAnalysis.contradictions.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-4">
                <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2 flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Potential Contradictions
                </h3>
                <ul className="space-y-1.5">
                  {data.aiAnalysis.contradictions.map((contradiction, idx) => (
                    <li key={idx} className="text-sm text-amber-700 dark:text-amber-300/80 flex items-start gap-2">
                      <span className="text-amber-500 mt-0.5 flex-shrink-0">&#8226;</span>
                      {contradiction}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Verification CTA */}
            {data.aiAnalysis.insights.some(i => i.verificationStatus === 'unverified') && (
              <div className="flex justify-center print:hidden">
                <Link
                  to="/app/review"
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Review &amp; Verify These Insights
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-center">
            <svg className="w-10 h-10 text-gray-400 dark:text-gray-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              {generatingInsights
                ? 'Generating personality insights…'
                : 'AI personality insights have not been generated yet.'}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {generatingInsights
                ? 'This may take a moment while Claude analyzes your scores.'
                : 'Choose "Generate AI Insights" for an analysis of your Big Five results.'}
            </p>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 print:hidden">
        <Link
          to="/app/personality"
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-xl transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Take Again
        </Link>
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-2 px-6 py-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium rounded-xl border border-gray-300 dark:border-gray-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Print Results
        </button>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .print\\:mb-2 { margin-bottom: 0.5rem !important; }
          .print\\:mb-4 { margin-bottom: 1rem !important; }
          .print\\:py-2 { padding-top: 0.5rem !important; padding-bottom: 0.5rem !important; }
          .print\\:px-0 { padding-left: 0 !important; padding-right: 0 !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          .print\\:border-gray-300 { border-color: #d1d5db !important; }
        }
      `}</style>
    </div>
  );
}
