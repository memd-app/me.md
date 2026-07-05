import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useTheme } from '@/contexts/ThemeContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { Button, EmptyState, SectionHeading } from '@/components/ui';
import { formatShortDate } from '@/utils/dateFormat';
import * as d3 from 'd3';
import { getGraphData } from '@/services/graph';

interface GraphNode {
  id: string;
  entityId: string;
  type: 'topic' | 'concept' | 'gap' | 'personality_domain' | 'personality_facet';
  label: string;
  description?: string;
  status?: string;
  category?: string | null;
  tags?: string[];
  weight: number;
  insightCount?: number;
  verifiedInsightCount?: number;
  sessionCount?: number;
  parentTopicId?: string;
  verificationStatus?: string; // For concept nodes: verification status of linked insight
  lastUpdated?: string;
  isUnexplored?: boolean;
  // Personality node fields
  domainScore?: number;
  facetScore?: number;
  scoreLevel?: string;
  domainKey?: string;
  parentDomainId?: string;
  completedAt?: string;
  // D3 simulation properties
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
}

interface GraphEdge {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  weight: number;
  relationship?: string;
  tag?: string;
}

interface GraphStats {
  topicCount: number;
  conceptCount: number;
  personalityNodeCount?: number;
  edgeCount: number;
  insightCount: number;
  verifiedInsightCount: number;
  unexploredCategories?: number;
  exploredCategories?: number;
  totalCategories?: number;
}

// ---------------------------------------------------------------------------
// GRAPH_PALETTE — the single source of truth for every color the knowledge
// graph renders, in both themes. Nothing outside this object should contain a
// hex literal; the graph is DESIGN.md's one deliberately theatrical element
// ("luminous nodes on paper"), so it earns its own tightly-scoped palette
// rather than reusing UI chrome tokens directly.
// ---------------------------------------------------------------------------
interface GraphPalette {
  /** The page/canvas background this theme paints under the SVG. Doubles as
   * node strokes and "cutout" badge marks so shapes read as sitting ON the
   * canvas rather than floating with a stark white ring. */
  canvasBg: string;
  accent: string;
  rule: string;
  panel: string;
  /** Topic category fills. */
  categories: Record<string, string>;
  /** Paler/desaturated companions used for unexplored ("gap") nodes. */
  categoriesDim: Record<string, string>;
  /** Big Five domain node fills (pentagons). */
  personalityDomain: Record<string, string>;
  /** Big Five facet node fills (diamonds) — tints within the domain family. */
  personalityFacet: Record<string, string>;
  /** Topic status ring colors. */
  status: Record<string, string>;
  concept: { verified: string; unverified: string };
  edge: {
    contains: string;
    tagShared: string;
    multiBucket: string;
    conceptRelation: string;
    personalityContains: string;
    personalityRelated: string;
    default: string;
  };
  /** Generic "unexplored area" accent used by the legend swatch (not tied to
   * any single category, unlike categoriesDim). */
  gapAccent: string;
}

const GRAPH_PALETTE: { light: GraphPalette; dark: GraphPalette } = {
  light: {
    canvasBg: '#FBF9F4',
    accent: '#C77B21',
    rule: '#E7DFD0',
    panel: '#F4EDDF',
    categories: {
      identity: '#B4552D',
      skills: '#8C6D1F',
      experiences: '#5F7161',
      perspectives: '#2E6B65',
      goals: '#7D5A7A',
      default: '#857B69',
    },
    categoriesDim: {
      identity: '#DDAF9B',
      skills: '#D3C08C',
      experiences: '#B7C2B1',
      perspectives: '#9FC5C0',
      goals: '#C4AEC2',
      default: '#D2CABB',
    },
    personalityDomain: {
      O: '#2E6B65', // Openness — deep teal (perspective-taking)
      C: '#8C6D1F', // Conscientiousness — ochre (discipline)
      E: '#B4552D', // Extraversion — terracotta (outward energy)
      A: '#5F7161', // Agreeableness — olive-sage (harmony)
      N: '#7D5A7A', // Neuroticism — muted plum
      default: '#857B69',
    },
    personalityFacet: {
      O: '#7FAFA9',
      C: '#C9A94A',
      E: '#D89A78',
      A: '#9DAE97',
      N: '#B092AF',
      default: '#B3AA97',
    },
    status: {
      backlog: '#C7BEB0',
      in_progress: '#C77B21', // active
      extracted: '#857B69', // completed
      refined: '#857B69', // completed
    },
    concept: {
      verified: '#C77B21', // amber — matches DESIGN.md's "verified = amber"
      unverified: '#A99E8A', // warm gray
    },
    edge: {
      contains: '#D5CAB6',
      tagShared: '#C2B392',
      multiBucket: '#A8916B', // stronger relationship, darker warm tan
      conceptRelation: '#B99B6B', // amber-tinted honey
      personalityContains: '#9A7C97', // plum-gray, ties to the N domain
      personalityRelated: '#C2ACC0',
      default: '#9C9284',
    },
    gapAccent: '#D89A48',
  },
  dark: {
    canvasBg: '#17130D',
    accent: '#E09A3E',
    rule: '#3A3226',
    panel: '#241D14',
    categories: {
      identity: '#D9754A',
      skills: '#C79A3D',
      experiences: '#7E9483',
      perspectives: '#4B948C',
      goals: '#A17CA0',
      default: '#A99E8A',
    },
    categoriesDim: {
      identity: '#5A3D2E',
      skills: '#4F4425',
      experiences: '#3A4238',
      perspectives: '#293F3D',
      goals: '#3E323D',
      default: '#3A362E',
    },
    personalityDomain: {
      O: '#4B948C',
      C: '#C79A3D',
      E: '#D9754A',
      A: '#7E9483',
      N: '#A17CA0',
      default: '#A99E8A',
    },
    personalityFacet: {
      O: '#7CB3AC',
      C: '#D9BC72',
      E: '#E39B79',
      A: '#A3B4A0',
      N: '#BC9FBB',
      default: '#C2BAAA',
    },
    status: {
      backlog: '#4A4234',
      in_progress: '#E09A3E', // active
      extracted: '#A99E8A', // completed
      refined: '#A99E8A', // completed
    },
    concept: {
      verified: '#E09A3E', // amber
      unverified: '#A99E8A', // warm gray
    },
    edge: {
      contains: '#4A4234',
      tagShared: '#5C5138',
      multiBucket: '#6B5B3E',
      conceptRelation: '#7A5C2E',
      personalityContains: '#5C4A5A',
      personalityRelated: '#4A3D48',
      default: '#443C30',
    },
    gapAccent: '#E3AE66',
  },
};

function getNodeColor(node: GraphNode, pal: GraphPalette): string {
  if (node.type === 'personality_domain') {
    return pal.personalityDomain[node.domainKey || 'default'] || pal.personalityDomain.default;
  }
  if (node.type === 'personality_facet') {
    return pal.personalityFacet[node.domainKey || 'default'] || pal.personalityFacet.default;
  }
  if (node.type === 'gap') {
    // Dim version of the category color for unexplored nodes
    return pal.categoriesDim[node.category || 'default'] || pal.categoriesDim.default;
  }
  if (node.type === 'concept') {
    // Verified concept nodes get the amber accent; unverified stay warm gray
    if (node.verificationStatus === 'verified') return pal.concept.verified;
    return pal.concept.unverified;
  }
  if (node.category) return pal.categories[node.category] || pal.categories.default;
  return pal.categories.default;
}

function getNodeRadius(node: GraphNode): number {
  if (node.type === 'personality_domain') return 16 + ((node.domainScore || 3) / 5) * 6; // 16-22, sized by score
  if (node.type === 'personality_facet') return 7 + ((node.facetScore || 3) / 5) * 3; // 7-10, smaller sub-nodes
  if (node.type === 'gap') return 18; // Fixed size for gap placeholder nodes
  if (node.type === 'concept') return 6 + (node.weight || 1) * 2;
  // Topic nodes: base + scaling by weight (sessions + verified insights)
  return 12 + Math.min(node.weight * 3, 24);
}

function getEdgeColor(edge: GraphEdge, pal: GraphPalette): string {
  switch (edge.type) {
    case 'contains': return pal.edge.contains;
    case 'tag_shared': return pal.edge.tagShared;
    case 'multi_bucket': return pal.edge.multiBucket;
    case 'concept_relation': return pal.edge.conceptRelation;
    case 'personality_contains': return pal.edge.personalityContains;
    case 'personality_related': return pal.edge.personalityRelated;
    default: return pal.edge.default;
  }
}

// Small-caps chrome label, shared by toggles/legend/meta text (DESIGN.md
// "small caps everywhere chrome speaks").
const SMALL_CAPS = 'uppercase tracking-[0.08em] font-medium font-sans';

const SCORE_LEVEL_ACCENT_CLASS = 'text-primary-600 dark:text-primary-400';
const SCORE_LEVEL_MUTED_CLASS = 'text-gray-500 dark:text-gray-400';
const SCORE_LEVEL_FAINT_CLASS = 'text-gray-400 dark:text-gray-500';
const SCORE_LEVEL_CLASS: Record<string, string> = {
  High: SCORE_LEVEL_ACCENT_CLASS,
  'Above Average': SCORE_LEVEL_ACCENT_CLASS,
  'Moderate-High': SCORE_LEVEL_ACCENT_CLASS,
  Average: SCORE_LEVEL_MUTED_CLASS,
};

export default function KnowledgeGraphPage() {
  const { user } = useUser();
  const db = useDatabase();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const pal = GRAPH_PALETTE[isDark ? 'dark' : 'light'];
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; stats: GraphStats } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showConcepts, setShowConcepts] = useState(true);
  const [showGaps, setShowGaps] = useState(true);
  const [showPersonality, setShowPersonality] = useState(true);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);

  // Fetch graph data
  const fetchGraph = useCallback(async (_signal?: AbortSignal) => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const data = getGraphData(db);
      setGraphData(data as any);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, [user, db]);

  useEffect(() => {
    const controller = new AbortController();
    fetchGraph(controller.signal);
    return () => controller.abort();
  }, [fetchGraph]);

  // Wrapper for click handlers (fetchGraph with signal conflicts with MouseEvent type)
  const handleRefreshGraph = () => { fetchGraph(); };

  // Auto-refresh graph when page becomes visible (e.g., returning from Verification tab)
  // This ensures the graph reflects real-time changes when insights are verified
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user) {
        fetchGraph();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchGraph, user]);

  // Also auto-refresh when the window regains focus (covers same-tab navigation back)
  useEffect(() => {
    const handleFocus = () => {
      if (user) {
        fetchGraph();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchGraph, user]);

  // Render D3 graph
  useEffect(() => {
    if (!graphData || !svgRef.current || !containerRef.current) return;
    if (graphData.nodes.length === 0) return;

    // Filter nodes/edges based on toggles
    let nodes = graphData.nodes;
    let edges = graphData.edges;

    // Filter out gap nodes if showGaps is off
    if (!showGaps) {
      nodes = nodes.filter(n => n.type !== 'gap');
    }

    // Filter out personality nodes if showPersonality is off
    if (!showPersonality) {
      nodes = nodes.filter(n => n.type !== 'personality_domain' && n.type !== 'personality_facet');
    }

    if (!showConcepts) {
      const keepTypes = new Set(['topic', 'gap', 'personality_domain', 'personality_facet']);
      const keepNodeIds = new Set(nodes.filter(n => keepTypes.has(n.type)).map(n => n.id));
      nodes = nodes.filter(n => keepTypes.has(n.type));
      edges = edges.filter(e => {
        const srcId = typeof e.source === 'string' ? e.source : e.source.id;
        const tgtId = typeof e.target === 'string' ? e.target : e.target.id;
        return keepNodeIds.has(srcId) && keepNodeIds.has(tgtId);
      });
    }

    // Final pass: ensure all edges reference nodes that exist after filtering
    const finalNodeIds = new Set(nodes.map(n => n.id));
    edges = edges.filter(e => {
      const srcId = typeof e.source === 'string' ? e.source : e.source.id;
      const tgtId = typeof e.target === 'string' ? e.target : e.target.id;
      return finalNodeIds.has(srcId) && finalNodeIds.has(tgtId);
    });

    // Deep clone nodes and edges for D3 mutation
    const simNodes: GraphNode[] = nodes.map(n => ({ ...n }));
    const simEdges: GraphEdge[] = edges.map(e => ({
      ...e,
      source: typeof e.source === 'string' ? e.source : e.source.id,
      target: typeof e.target === 'string' ? e.target : e.target.id,
    }));

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const width = rect.width || 900;
    const height = rect.height || 600;

    // Clear previous
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg.attr('width', width).attr('height', height);

    // Luminosity: a single shared glow filter for node shapes — "luminous
    // nodes on paper". One <filter> definition, applied via .attr('filter',
    // ...) to whole selections (never created per-node or inside the tick
    // loop), restrained in light mode and a touch stronger in dark ("lamplight").
    const defs = svg.append('defs');
    const glow = defs.append('filter')
      .attr('id', 'graph-node-glow')
      .attr('x', '-75%')
      .attr('y', '-75%')
      .attr('width', '250%')
      .attr('height', '250%');
    glow.append('feGaussianBlur')
      .attr('in', 'SourceGraphic')
      .attr('stdDeviation', isDark ? 3.2 : 1.6)
      .attr('result', 'glowBlur');
    const glowMerge = glow.append('feMerge');
    glowMerge.append('feMergeNode').attr('in', 'glowBlur');
    glowMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Create zoom group
    const g = svg.append('g');

    // Setup zoom behavior (supports mouse wheel, touch pinch-to-zoom, and touch pan)
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .touchable(() => true) // Explicitly enable touch support
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom)
      .on('dblclick.zoom', null); // Disable double-click zoom (interferes with touch)

    // Center the initial view
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8));

    // Edge force: distance based on edge type
    function linkDistance(d: any): number {
      if (d.type === 'contains') return 40;
      if (d.type === 'tag_shared') return 150;
      if (d.type === 'multi_bucket') return 120;
      return 100;
    }

    // Performance: scale simulation params based on node count
    const nodeCount = simNodes.length;
    const isLargeGraph = nodeCount > 40;
    const alphaDecay = isLargeGraph ? 0.04 : 0.02;
    const velocityDecay = isLargeGraph ? 0.4 : 0.3;
    const chargeStrength = isLargeGraph
      ? ((d: any) => {
          if (d.type === 'concept' || d.type === 'personality_facet') return -20;
          if (d.type === 'gap') return -60;
          if (d.type === 'personality_domain') return -70;
          return -80;
        })
      : ((d: any) => {
          if (d.type === 'concept' || d.type === 'personality_facet') return -30;
          if (d.type === 'gap') return -80;
          if (d.type === 'personality_domain') return -100;
          return -120;
        });

    // Create simulation with performance-tuned parameters
    const simulation = d3.forceSimulation<GraphNode>(simNodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(simEdges)
        .id((d: GraphNode) => d.id)
        .distance(linkDistance)
        .strength((d: any) => d.weight * 0.3)
      )
      .force('charge', d3.forceManyBody()
        .strength(chargeStrength)
        .theta(isLargeGraph ? 0.9 : 0.8)
        .distanceMax(isLargeGraph ? 300 : 500)
      )
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide<GraphNode>()
        .radius((d: GraphNode) => getNodeRadius(d) + (isLargeGraph ? 2 : 4))
        .iterations(isLargeGraph ? 1 : 2)
      )
      .alphaDecay(alphaDecay)
      .velocityDecay(velocityDecay);

    simulationRef.current = simulation;

    // Draw edges
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(simEdges)
      .join('line')
      .attr('stroke', (d: any) => getEdgeColor(d, pal))
      .attr('stroke-opacity', (d: any) => d.type === 'contains' ? 0.3 : 0.5)
      .attr('stroke-width', (d: any) => {
        if (d.type === 'contains') return 1;
        return 1 + d.weight;
      })
      .attr('stroke-dasharray', (d: any) => d.type === 'tag_shared' ? '4,4' : null);

    // Draw nodes
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(simNodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      );

    // Helper: generate pentagon path string centered at (0,0)
    function pentagonPath(radius: number): string {
      const points: string[] = [];
      for (let i = 0; i < 5; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / 5;
        points.push(`${radius * Math.cos(angle)},${radius * Math.sin(angle)}`);
      }
      return `M${points.join('L')}Z`;
    }

    // Helper: generate diamond (rotated square) path string
    function diamondPath(radius: number): string {
      return `M0,${-radius} L${radius * 0.7},0 L0,${radius} L${-radius * 0.7},0 Z`;
    }

    // Personality domain nodes: pentagon shape
    node.filter((d: GraphNode) => d.type === 'personality_domain')
      .append('path')
      .attr('d', (d: GraphNode) => pentagonPath(getNodeRadius(d)))
      .attr('fill', (d: GraphNode) => getNodeColor(d, pal))
      .attr('stroke', pal.canvasBg)
      .attr('stroke-width', 2)
      .attr('opacity', 0.95)
      .attr('filter', 'url(#graph-node-glow)');

    // Personality facet nodes: diamond shape
    node.filter((d: GraphNode) => d.type === 'personality_facet')
      .append('path')
      .attr('d', (d: GraphNode) => diamondPath(getNodeRadius(d)))
      .attr('fill', (d: GraphNode) => getNodeColor(d, pal))
      .attr('stroke', (d: GraphNode) => pal.personalityDomain[d.domainKey || 'default'] || pal.personalityDomain.default)
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.85)
      .attr('filter', 'url(#graph-node-glow)');

    // Non-personality node circles - explored nodes are fully opaque, gap nodes are dim
    node.filter((d: GraphNode) => d.type !== 'personality_domain' && d.type !== 'personality_facet')
      .append('circle')
      .attr('r', (d: GraphNode) => getNodeRadius(d))
      .attr('fill', (d: GraphNode) => getNodeColor(d, pal))
      .attr('stroke', (d: GraphNode) => {
        if (d.type === 'gap') return pal.categories[d.category || 'default'] || pal.categories.default;
        return pal.canvasBg;
      })
      .attr('stroke-width', (d: GraphNode) => {
        if (d.type === 'gap') return 2;
        return d.type === 'topic' ? 2 : 1;
      })
      .attr('stroke-dasharray', (d: GraphNode) => {
        if (d.type === 'gap') return '4,3'; // Dashed border for unexplored
        return null;
      })
      .attr('opacity', (d: GraphNode) => {
        if (d.type === 'gap') return 0.35; // Very dim for unexplored
        if (d.type === 'concept') return 0.8;
        return 1;
      })
      .attr('filter', 'url(#graph-node-glow)');

    // Score text inside personality domain nodes
    node.filter((d: GraphNode) => d.type === 'personality_domain')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .attr('fill', pal.canvasBg)
      .style('pointer-events', 'none')
      .text((d: GraphNode) => d.domainScore ? d.domainScore.toFixed(1) : '');

    // Labels for personality domain nodes
    node.filter((d: GraphNode) => d.type === 'personality_domain')
      .append('text')
      .attr('dy', (d: GraphNode) => getNodeRadius(d) + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('fill', 'currentColor')
      .attr('class', 'text-gray-900 dark:text-gray-100')
      .style('pointer-events', 'none')
      .text((d: GraphNode) => d.label || '');

    // Labels for personality facet nodes (small, compact)
    node.filter((d: GraphNode) => d.type === 'personality_facet')
      .append('text')
      .attr('dy', (d: GraphNode) => getNodeRadius(d) + 10)
      .attr('text-anchor', 'middle')
      .attr('font-size', '8px')
      .attr('font-weight', '500')
      .attr('fill', 'currentColor')
      .attr('class', 'text-gray-600 dark:text-gray-300')
      .attr('opacity', 0.8)
      .style('pointer-events', 'none')
      .text((d: GraphNode) => {
        const label = d.label || '';
        return label.length > 14 ? label.substring(0, 12) + '..' : label;
      });

    // "?" icon inside gap nodes to indicate unexplored
    node.filter((d: GraphNode) => d.type === 'gap')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', '14px')
      .attr('font-weight', 'bold')
      .attr('fill', (d: GraphNode) => pal.categories[d.category || 'default'] || pal.categories.default)
      .attr('opacity', 0.6)
      .text('?');

    // Status ring for topic nodes (not gap)
    node.filter((d: GraphNode) => d.type === 'topic')
      .append('circle')
      .attr('r', (d: GraphNode) => getNodeRadius(d) + 3)
      .attr('fill', 'none')
      .attr('stroke', (d: GraphNode) => pal.status[d.status || 'backlog'] || pal.status.backlog)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', (d: GraphNode) => {
        if (d.status === 'refined' || d.status === 'extracted') return 'none';
        return '3,3';
      })
      .attr('opacity', 0.6);

    // Verified insight count badge for topics with verified insights
    node.filter((d: GraphNode) => d.type === 'topic' && (d.verifiedInsightCount || 0) > 0)
      .append('circle')
      .attr('cx', (d: GraphNode) => getNodeRadius(d) * 0.6)
      .attr('cy', (d: GraphNode) => -getNodeRadius(d) * 0.6)
      .attr('r', 8)
      .attr('fill', pal.accent)
      .attr('stroke', pal.canvasBg)
      .attr('stroke-width', 1.5);

    node.filter((d: GraphNode) => d.type === 'topic' && (d.verifiedInsightCount || 0) > 0)
      .append('text')
      .attr('x', (d: GraphNode) => getNodeRadius(d) * 0.6)
      .attr('y', (d: GraphNode) => -getNodeRadius(d) * 0.6 + 3)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-weight', 'bold')
      .attr('fill', pal.canvasBg)
      .text((d: GraphNode) => d.verifiedInsightCount || 0);

    // Labels for topic nodes
    node.filter((d: GraphNode) => d.type === 'topic')
      .append('text')
      .attr('dy', (d: GraphNode) => getNodeRadius(d) + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('fill', 'currentColor')
      .attr('class', 'text-gray-900 dark:text-gray-100')
      .style('pointer-events', 'none')
      .text((d: GraphNode) => {
        const label = d.label || '';
        return label.length > 20 ? label.substring(0, 18) + '...' : label;
      });

    // Labels for gap (unexplored) nodes
    node.filter((d: GraphNode) => d.type === 'gap')
      .append('text')
      .attr('dy', (d: GraphNode) => getNodeRadius(d) + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-weight', '500')
      .attr('font-style', 'italic')
      .attr('fill', 'currentColor')
      .attr('class', 'text-gray-500 dark:text-gray-300')
      .attr('opacity', 0.7)
      .style('pointer-events', 'none')
      .text((d: GraphNode) => d.label || '');

    // Verified checkmark ring for verified concept nodes
    node.filter((d: GraphNode) => d.type === 'concept' && d.verificationStatus === 'verified')
      .append('circle')
      .attr('r', (d: GraphNode) => getNodeRadius(d) + 2)
      .attr('fill', 'none')
      .attr('stroke', pal.concept.verified)
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.8);

    // Small checkmark badge on verified concept nodes
    node.filter((d: GraphNode) => d.type === 'concept' && d.verificationStatus === 'verified')
      .append('circle')
      .attr('cx', (d: GraphNode) => getNodeRadius(d) * 0.5)
      .attr('cy', (d: GraphNode) => -getNodeRadius(d) * 0.5)
      .attr('r', 5)
      .attr('fill', pal.concept.verified)
      .attr('stroke', pal.canvasBg)
      .attr('stroke-width', 1);

    node.filter((d: GraphNode) => d.type === 'concept' && d.verificationStatus === 'verified')
      .append('text')
      .attr('x', (d: GraphNode) => getNodeRadius(d) * 0.5)
      .attr('y', (d: GraphNode) => -getNodeRadius(d) * 0.5 + 3)
      .attr('text-anchor', 'middle')
      .attr('font-size', '7px')
      .attr('font-weight', 'bold')
      .attr('fill', pal.canvasBg)
      .text('✓');

    // Labels for concept nodes (smaller, only visible on hover)
    node.filter((d: GraphNode) => d.type === 'concept')
      .append('text')
      .attr('dy', (d: GraphNode) => getNodeRadius(d) + 10)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('fill', 'currentColor')
      .attr('class', 'text-gray-600 dark:text-gray-300')
      .attr('opacity', 0.7)
      .style('pointer-events', 'none')
      .text((d: GraphNode) => {
        const label = d.label || '';
        return label.length > 16 ? label.substring(0, 14) + '...' : label;
      });

    // Mouse/touch events for tooltips
    node.on('mouseenter', (event: MouseEvent, d: GraphNode) => {
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (svgRect) {
        setHoveredNode(d);
        setTooltipPos({
          x: event.clientX - svgRect.left + 15,
          y: event.clientY - svgRect.top - 10,
        });
      }
    });

    node.on('mousemove', (event: MouseEvent) => {
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (svgRect) {
        setTooltipPos({
          x: event.clientX - svgRect.left + 15,
          y: event.clientY - svgRect.top - 10,
        });
      }
    });

    node.on('mouseleave', () => {
      setHoveredNode(null);
    });

    // Touch support: show tooltip on long press, tap to navigate
    node.on('touchstart', (event: TouchEvent, d: GraphNode) => {
      // Show tooltip for touch devices
      const touch = event.touches[0];
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (svgRect && touch) {
        setHoveredNode(d);
        setTooltipPos({
          x: touch.clientX - svgRect.left + 15,
          y: touch.clientY - svgRect.top - 40,
        });
      }
    }, { passive: true });

    node.on('touchend', () => {
      // Clear tooltip after a delay to allow reading
      setTimeout(() => setHoveredNode(null), 2000);
    });

    // Click to navigate
    node.on('click', (_event: MouseEvent, d: GraphNode) => {
      if (d.type === 'topic') {
        navigate(`/app/topics/${d.entityId}`);
      } else if (d.type === 'concept') {
        // Clicking a concept node navigates to its parent topic detail page
        const topicId = d.parentTopicId?.replace('topic-', '');
        if (topicId) {
          navigate(`/app/topics/${topicId}`);
        }
      } else if (d.type === 'gap') {
        // Clicking an unexplored node navigates to topics page with preset category filter
        navigate(`/app/topics?explore=${d.entityId}`);
      } else if (d.type === 'personality_domain' || d.type === 'personality_facet') {
        // Clicking a personality node navigates to the assessment page
        navigate('/app/personality');
      }
    });

    // Simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    // Cleanup
    return () => {
      simulation.stop();
      simulationRef.current = null;
    };
  }, [graphData, showConcepts, showGaps, showPersonality, navigate, isDark, pal]);

  // Empty state
  if (!loading && graphData && graphData.nodes.length === 0) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="font-serif text-2xl text-gray-900 dark:text-white">Knowledge Graph</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-300">
            Visualize connections between your topics and insights
          </p>
        </div>
        <div className="card" style={{ minHeight: '500px' }}>
          <EmptyState
            kicker="Your knowledge graph"
            message="Complete interview sessions and verify insights to see your knowledge graph grow. Topics and concepts will appear as connected nodes."
            action={
              <Button onClick={() => navigate('/app/topics')}>
                Create your first topic
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto px-1 sm:px-2" role="region" aria-label="Knowledge Graph visualization">
      {/* Header */}
      <div className="mb-3 sm:mb-4 pb-3 border-b border-rule dark:border-dark-border flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className={`${SMALL_CAPS} text-[10px] text-primary-600 dark:text-primary-400 mb-0.5`}>Explore</p>
          <h1 className="font-serif italic text-xl sm:text-2xl text-gray-900 dark:text-white">Knowledge Graph</h1>
          <p className="mt-0.5 sm:mt-1 text-sm font-serif italic text-gray-600 dark:text-gray-300 hidden sm:block">
            Visualize connections between your topics and insights
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Toggle gap nodes */}
          <label className={`flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs ${SMALL_CAPS} text-gray-600 dark:text-gray-300 cursor-pointer`}>
            <input
              type="checkbox"
              checked={showGaps}
              onChange={(e) => setShowGaps(e.target.checked)}
              className="w-4 h-4 accent-primary-500 rounded"
            />
            <span className="hidden sm:inline">Show </span>Gaps
          </label>
          {/* Toggle concepts */}
          <label className={`flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs ${SMALL_CAPS} text-gray-600 dark:text-gray-300 cursor-pointer`}>
            <input
              type="checkbox"
              checked={showConcepts}
              onChange={(e) => setShowConcepts(e.target.checked)}
              className="w-4 h-4 accent-primary-500 rounded"
            />
            <span className="hidden sm:inline">Show </span>Concepts
          </label>
          {/* Toggle personality nodes */}
          {(graphData?.stats?.personalityNodeCount || 0) > 0 && (
            <label className={`flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs ${SMALL_CAPS} text-gray-600 dark:text-gray-300 cursor-pointer`}>
              <input
                type="checkbox"
                checked={showPersonality}
                onChange={(e) => setShowPersonality(e.target.checked)}
                className="w-4 h-4 accent-primary-500 rounded"
              />
              <span className="hidden sm:inline">Show </span>Personality
            </label>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefreshGraph}
            className={`${SMALL_CAPS} min-h-[36px]`}
            aria-label="Refresh knowledge graph"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      {graphData && graphData.stats && (
        <div className="mb-3 flex gap-2 sm:gap-4 flex-wrap text-xs sm:text-sm text-gray-600 dark:text-gray-300">
          <span>{graphData.stats.topicCount} topics</span>
          <span>{graphData.stats.conceptCount} concepts</span>
          {(graphData.stats.personalityNodeCount || 0) > 0 && (
            <span>{graphData.stats.personalityNodeCount} personality</span>
          )}
          <span>{graphData.stats.insightCount} insights</span>
          <span className="text-primary-600 dark:text-primary-400">{graphData.stats.verifiedInsightCount} verified</span>
          <span>{graphData.stats.edgeCount} connections</span>
          {(graphData.stats.unexploredCategories || 0) > 0 && (
            <span className="text-primary-600 dark:text-primary-400">
              {graphData.stats.unexploredCategories} unexplored {graphData.stats.unexploredCategories === 1 ? 'area' : 'areas'}
            </span>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <ApiErrorAlert
          message={error}
          onRetry={handleRefreshGraph}
          onDismiss={() => setError(null)}
          className="mb-4"
        />
      )}

      {/* Loading state */}
      {loading && (
        <div className="card" style={{ minHeight: '600px' }}>
          <div className="flex items-center justify-center h-96">
            <LoadingSpinner size="lg" message="Loading knowledge graph..." />
          </div>
        </div>
      )}

      {/* Graph */}
      {!loading && graphData && graphData.nodes.length > 0 && (
        <div
          ref={containerRef}
          className="relative bg-paper dark:bg-dark-bg rounded-md border border-rule dark:border-dark-border overflow-hidden"
          style={{ height: 'calc(100vh - 220px)', minHeight: '300px', touchAction: 'none' }}
        >
          <svg
            ref={svgRef}
            className="w-full h-full"
            style={{ width: '100%', height: '100%', touchAction: 'none' }}
            role="img"
            aria-label={`Knowledge graph with ${graphData?.stats?.topicCount || 0} topics, ${graphData?.stats?.conceptCount || 0} concepts, and ${graphData?.stats?.edgeCount || 0} connections`}
          />

          {/* Tooltip */}
          {hoveredNode && (
            <div
              className="absolute z-50 bg-panel dark:bg-dark-card border border-rule dark:border-dark-border rounded-md shadow-sm p-3 pointer-events-none max-w-xs"
              style={{
                left: tooltipPos.x,
                top: tooltipPos.y,
                transform: tooltipPos.x > (containerRef.current?.clientWidth || 0) - 200 ? 'translateX(-110%)' : 'none',
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`w-3 h-3 inline-block ${hoveredNode.type === 'personality_domain' ? 'rotate-45' : 'rounded-full'}`}
                  style={{
                    backgroundColor: hoveredNode.type === 'gap'
                      ? (pal.categories[hoveredNode.category || 'default'] || pal.categories.default)
                      : getNodeColor(hoveredNode, pal),
                    opacity: hoveredNode.type === 'gap' ? 0.5 : 1,
                    borderRadius: hoveredNode.type === 'personality_domain' ? '2px' : undefined,
                  }}
                />
                <span className="font-semibold text-sm text-gray-900 dark:text-white">
                  {hoveredNode.label}
                </span>
                <span className={`${SMALL_CAPS} text-[10px] text-gray-500 dark:text-gray-400`}>
                  ({hoveredNode.type === 'gap' ? 'unexplored'
                    : hoveredNode.type === 'personality_domain' ? 'Big Five domain'
                    : hoveredNode.type === 'personality_facet' ? 'personality facet'
                    : hoveredNode.type})
                </span>
              </div>

              {hoveredNode.type === 'gap' && (
                <div className="mt-1 space-y-1.5">
                  {hoveredNode.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-300">
                      {hoveredNode.description}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    <span className="font-medium">Click to start exploring this area</span>
                  </div>
                </div>
              )}

              {hoveredNode.type === 'topic' && (
                <>
                  {hoveredNode.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">
                      {hoveredNode.description}
                    </p>
                  )}
                  <div className="mt-2 flex gap-3 text-xs text-gray-500 dark:text-gray-300">
                    <span>{hoveredNode.insightCount || 0} insights</span>
                    <span className="text-primary-600 dark:text-primary-400">{hoveredNode.verifiedInsightCount || 0} verified</span>
                    <span>{hoveredNode.sessionCount || 0} sessions</span>
                  </div>
                  {hoveredNode.status && (
                    <div className="mt-1 flex items-center gap-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: pal.status[hoveredNode.status] || pal.status.backlog }}
                      />
                      <span className="text-xs text-gray-500 dark:text-gray-300 capitalize">
                        {hoveredNode.status.replace('_', ' ')}
                      </span>
                    </div>
                  )}
                  {hoveredNode.tags && hoveredNode.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {hoveredNode.tags.slice(0, 5).map((tag: string) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {hoveredNode.lastUpdated && (
                    <p className="text-xs text-gray-400 mt-1">
                      Updated: {formatShortDate(hoveredNode.lastUpdated)}
                    </p>
                  )}
                </>
              )}

              {hoveredNode.type === 'concept' && (
                <div className="mt-1 space-y-1">
                  <p className="text-xs text-gray-500">
                    Weight: {hoveredNode.weight?.toFixed(1)}
                  </p>
                  {hoveredNode.verificationStatus && (
                    <div className="flex items-center gap-1">
                      {hoveredNode.verificationStatus === 'verified' ? (
                        <span className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Verified
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-gray-300">
                          {hoveredNode.verificationStatus === 'unverified' ? 'Awaiting review' : hoveredNode.verificationStatus}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Personality domain node tooltip */}
              {hoveredNode.type === 'personality_domain' && (
                <div className="mt-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`${SMALL_CAPS} text-[10px] text-gray-600 dark:text-gray-300`}>Score</span>
                        <span className="text-sm font-bold text-gray-900 dark:text-white">
                          {hoveredNode.domainScore?.toFixed(1)}<span className="text-xs text-gray-400 font-normal">/5</span>
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            width: `${((hoveredNode.domainScore || 0) / 5) * 100}%`,
                            backgroundColor: getNodeColor(hoveredNode, pal),
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  {hoveredNode.scoreLevel && (
                    <span className={`inline-flex ${SMALL_CAPS} text-[10px] ${SCORE_LEVEL_CLASS[hoveredNode.scoreLevel] || SCORE_LEVEL_FAINT_CLASS}`}>
                      {hoveredNode.scoreLevel}
                    </span>
                  )}
                  {hoveredNode.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-300">{hoveredNode.description}</p>
                  )}
                  {hoveredNode.completedAt && (
                    <p className="text-xs text-gray-400">
                      Assessed: {formatShortDate(hoveredNode.completedAt)}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span className="font-medium">Click to view assessment details</span>
                  </div>
                </div>
              )}

              {/* Personality facet node tooltip */}
              {hoveredNode.type === 'personality_facet' && (
                <div className="mt-1 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className={`${SMALL_CAPS} text-[10px] text-gray-600 dark:text-gray-300`}>Score</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                      {hoveredNode.facetScore?.toFixed(1)}<span className="text-xs text-gray-400 font-normal">/5</span>
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${((hoveredNode.facetScore || 0) / 5) * 100}%`,
                        backgroundColor: pal.personalityDomain[hoveredNode.domainKey || 'default'] || pal.personalityDomain.default,
                      }}
                    />
                  </div>
                  {hoveredNode.scoreLevel && (
                    <span className={`inline-flex ${SMALL_CAPS} text-[10px] ${SCORE_LEVEL_CLASS[hoveredNode.scoreLevel] || SCORE_LEVEL_FAINT_CLASS}`}>
                      {hoveredNode.scoreLevel}
                    </span>
                  )}
                  {hoveredNode.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-300">{hoveredNode.description}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Legend - collapsible on mobile */}
          <div className="absolute bottom-3 left-3 bg-panel/90 dark:bg-dark-card/90 backdrop-blur-sm rounded-md border border-rule dark:border-dark-border p-2 text-xs max-w-[160px] sm:max-w-none">
            <SectionHeading className="mb-1.5">Legend</SectionHeading>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: pal.categories.default }} />
                <span className="text-gray-600 dark:text-gray-300">Topic (explored)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-full border-2 border-dashed opacity-50"
                  style={{ borderColor: pal.gapAccent, backgroundColor: pal.gapAccent }}
                />
                <span className="text-gray-600 dark:text-gray-300">Unexplored area</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pal.concept.unverified }} />
                <span className="text-gray-600 dark:text-gray-300">Concept</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 14 14">
                  <polygon points="7,1 13,5.5 10.7,12.5 3.3,12.5 1,5.5" fill={pal.personalityDomain.default} stroke={pal.canvasBg} strokeWidth="1" />
                </svg>
                <span className="text-gray-600 dark:text-gray-300">Personality domain</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12">
                  <polygon points="6,1 11,6 6,11 1,6" fill={pal.personalityFacet.default} stroke={pal.personalityDomain.default} strokeWidth="1" />
                </svg>
                <span className="text-gray-600 dark:text-gray-300">Personality facet</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-full flex items-center justify-center text-[7px] font-bold"
                  style={{ backgroundColor: pal.accent, color: pal.canvasBg }}
                >
                  3
                </span>
                <span className="text-gray-600 dark:text-gray-300">Verified insights</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 border-t" style={{ borderColor: pal.edge.default }} />
                <span className="text-gray-600 dark:text-gray-300">Connection</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 border-t border-dashed" style={{ borderColor: pal.edge.tagShared }} />
                <span className="text-gray-600 dark:text-gray-300">Shared tag</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 border-t" style={{ borderColor: pal.edge.personalityContains }} />
                <span className="text-gray-600 dark:text-gray-300">Personality link</span>
              </div>
            </div>
          </div>

          {/* Zoom controls - touch-friendly 44px buttons on mobile */}
          <div className="absolute top-3 right-3 flex flex-col gap-1.5">
            <button
              onClick={() => {
                const svg = d3.select(svgRef.current!);
                svg.transition().duration(300).call(
                  d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.1, 4]).on('zoom', () => {}).scaleBy,
                  1.3
                );
              }}
              className="w-11 h-11 sm:w-8 sm:h-8 bg-paper dark:bg-dark-card border border-rule dark:border-dark-border rounded-md flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-panel dark:hover:bg-gray-700 text-lg font-bold"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => {
                const svg = d3.select(svgRef.current!);
                svg.transition().duration(300).call(
                  d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.1, 4]).on('zoom', () => {}).scaleBy,
                  0.7
                );
              }}
              className="w-11 h-11 sm:w-8 sm:h-8 bg-paper dark:bg-dark-card border border-rule dark:border-dark-border rounded-md flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-panel dark:hover:bg-gray-700 text-lg font-bold"
              aria-label="Zoom out"
            >
              -
            </button>
            <button
              onClick={() => {
                const svg = d3.select(svgRef.current!);
                const width = containerRef.current?.clientWidth || 900;
                const height = containerRef.current?.clientHeight || 600;
                svg.transition().duration(500).call(
                  d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.1, 4]).on('zoom', (event) => {
                    svg.select('g').attr('transform', event.transform);
                  }).transform,
                  d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8)
                );
              }}
              className="w-11 h-11 sm:w-8 sm:h-8 bg-paper dark:bg-dark-card border border-rule dark:border-dark-border rounded-md flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-panel dark:hover:bg-gray-700 text-sm"
              title="Reset view"
              aria-label="Reset graph view"
            >
              ↺
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
