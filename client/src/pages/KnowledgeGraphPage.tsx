import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import ApiErrorAlert from '@/components/ApiErrorAlert';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { formatShortDate } from '@/utils/dateFormat';
import { useToast } from '@/contexts/ToastContext';
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

// Color palette for topic categories
const CATEGORY_COLORS: Record<string, string> = {
  identity: '#6366f1',     // indigo
  skills: '#06b6d4',       // cyan
  experiences: '#f59e0b',  // amber
  perspectives: '#8b5cf6', // violet
  goals: '#10b981',        // emerald
  default: '#3b82f6',      // blue
};

// Dimmed versions of category colors for gap nodes
const CATEGORY_COLORS_DIM: Record<string, string> = {
  identity: '#a5b4fc',     // indigo-300
  skills: '#67e8f9',       // cyan-300
  experiences: '#fcd34d',  // amber-300
  perspectives: '#c4b5fd', // violet-300
  goals: '#6ee7b7',        // emerald-300
  default: '#93c5fd',      // blue-300
};

// Colors for Big Five personality domain nodes
const PERSONALITY_DOMAIN_COLORS: Record<string, string> = {
  O: '#3B82F6',   // blue (Openness)
  C: '#8B5CF6',   // purple (Conscientiousness)
  E: '#F59E0B',   // amber (Extraversion)
  A: '#10B981',   // emerald (Agreeableness)
  N: '#F43F5E',   // rose (Neuroticism)
  default: '#ec4899', // pink fallback
};

// Lighter versions for facet nodes
const PERSONALITY_FACET_COLORS: Record<string, string> = {
  O: '#93c5fd',   // blue-300
  C: '#c4b5fd',   // purple-300
  E: '#fcd34d',   // amber-300
  A: '#6ee7b7',   // emerald-300
  N: '#fda4af',   // rose-300
  default: '#f9a8d4', // pink-300
};

const STATUS_COLORS: Record<string, string> = {
  backlog: '#9ca3af',      // gray
  scheduled: '#f59e0b',    // amber
  in_progress: '#3b82f6',  // blue
  extracted: '#10b981',    // green
  refined: '#6366f1',      // indigo
};

function getNodeColor(node: GraphNode): string {
  if (node.type === 'personality_domain') {
    return PERSONALITY_DOMAIN_COLORS[node.domainKey || 'default'] || PERSONALITY_DOMAIN_COLORS.default;
  }
  if (node.type === 'personality_facet') {
    return PERSONALITY_FACET_COLORS[node.domainKey || 'default'] || PERSONALITY_FACET_COLORS.default;
  }
  if (node.type === 'gap') {
    // Dim version of the category color for unexplored nodes
    return CATEGORY_COLORS_DIM[node.category || 'default'] || CATEGORY_COLORS_DIM.default;
  }
  if (node.type === 'concept') {
    // Verified concept nodes get a green color, unverified stay violet
    if (node.verificationStatus === 'verified') return '#10b981'; // emerald-500
    return '#a78bfa'; // violet-400
  }
  if (node.category) return CATEGORY_COLORS[node.category] || CATEGORY_COLORS.default;
  return CATEGORY_COLORS.default;
}

function getNodeRadius(node: GraphNode): number {
  if (node.type === 'personality_domain') return 16 + ((node.domainScore || 3) / 5) * 6; // 16-22, sized by score
  if (node.type === 'personality_facet') return 7 + ((node.facetScore || 3) / 5) * 3; // 7-10, smaller sub-nodes
  if (node.type === 'gap') return 18; // Fixed size for gap placeholder nodes
  if (node.type === 'concept') return 6 + (node.weight || 1) * 2;
  // Topic nodes: base + scaling by weight (sessions + verified insights)
  return 12 + Math.min(node.weight * 3, 24);
}

function getEdgeColor(edge: GraphEdge): string {
  switch (edge.type) {
    case 'contains': return '#d1d5db'; // gray-300
    case 'tag_shared': return '#93c5fd'; // blue-300
    case 'multi_bucket': return '#c4b5fd'; // violet-300
    case 'concept_relation': return '#a5f3fc'; // cyan-200
    case 'personality_contains': return '#f9a8d4'; // pink-300
    case 'personality_related': return '#fbcfe8'; // pink-200
    default: return '#9ca3af'; // gray-400
  }
}

export default function KnowledgeGraphPage() {
  const { user } = useUser();
  const db = useDatabase();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [exportingImage, setExportingImage] = useState(false);
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
      .attr('stroke', (d: any) => getEdgeColor(d))
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
      .attr('fill', (d: GraphNode) => getNodeColor(d))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('opacity', 0.95);

    // Personality facet nodes: diamond shape
    node.filter((d: GraphNode) => d.type === 'personality_facet')
      .append('path')
      .attr('d', (d: GraphNode) => diamondPath(getNodeRadius(d)))
      .attr('fill', (d: GraphNode) => getNodeColor(d))
      .attr('stroke', (d: GraphNode) => PERSONALITY_DOMAIN_COLORS[d.domainKey || 'default'] || PERSONALITY_DOMAIN_COLORS.default)
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.85);

    // Non-personality node circles - explored nodes are fully opaque, gap nodes are dim
    node.filter((d: GraphNode) => d.type !== 'personality_domain' && d.type !== 'personality_facet')
      .append('circle')
      .attr('r', (d: GraphNode) => getNodeRadius(d))
      .attr('fill', (d: GraphNode) => {
        if (d.type === 'gap') return getNodeColor(d);
        return getNodeColor(d);
      })
      .attr('stroke', (d: GraphNode) => {
        if (d.type === 'gap') return CATEGORY_COLORS[d.category || 'default'] || CATEGORY_COLORS.default;
        return '#fff';
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
      });

    // Score text inside personality domain nodes
    node.filter((d: GraphNode) => d.type === 'personality_domain')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .attr('fill', '#fff')
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
      .attr('fill', (d: GraphNode) => CATEGORY_COLORS[d.category || 'default'] || CATEGORY_COLORS.default)
      .attr('opacity', 0.6)
      .text('?');

    // Status ring for topic nodes (not gap)
    node.filter((d: GraphNode) => d.type === 'topic')
      .append('circle')
      .attr('r', (d: GraphNode) => getNodeRadius(d) + 3)
      .attr('fill', 'none')
      .attr('stroke', (d: GraphNode) => STATUS_COLORS[d.status || 'backlog'] || '#9ca3af')
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
      .attr('fill', '#10b981')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5);

    node.filter((d: GraphNode) => d.type === 'topic' && (d.verifiedInsightCount || 0) > 0)
      .append('text')
      .attr('x', (d: GraphNode) => getNodeRadius(d) * 0.6)
      .attr('y', (d: GraphNode) => -getNodeRadius(d) * 0.6 + 3)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-weight', 'bold')
      .attr('fill', '#fff')
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
      .attr('stroke', '#10b981') // emerald-500
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.8);

    // Small checkmark badge on verified concept nodes
    node.filter((d: GraphNode) => d.type === 'concept' && d.verificationStatus === 'verified')
      .append('circle')
      .attr('cx', (d: GraphNode) => getNodeRadius(d) * 0.5)
      .attr('cy', (d: GraphNode) => -getNodeRadius(d) * 0.5)
      .attr('r', 5)
      .attr('fill', '#10b981')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1);

    node.filter((d: GraphNode) => d.type === 'concept' && d.verificationStatus === 'verified')
      .append('text')
      .attr('x', (d: GraphNode) => getNodeRadius(d) * 0.5)
      .attr('y', (d: GraphNode) => -getNodeRadius(d) * 0.5 + 3)
      .attr('text-anchor', 'middle')
      .attr('font-size', '7px')
      .attr('font-weight', 'bold')
      .attr('fill', '#fff')
      .text('\u2713');

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
        navigate('/app/assessment');
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
  }, [graphData, showConcepts, showGaps, showPersonality, navigate]);

  // Empty state
  if (!loading && graphData && graphData.nodes.length === 0) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Knowledge Graph</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-300">
            Visualize connections between your topics and insights
          </p>
        </div>
        <div className="card" style={{ minHeight: '500px' }}>
          <div className="flex flex-col items-center justify-center h-96">
            <span className="text-5xl block mb-4">🔗</span>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Your Knowledge Graph
            </h2>
            <p className="text-gray-600 dark:text-gray-300 text-center max-w-md">
              Complete interview sessions and verify insights to see your knowledge graph grow.
              Topics and concepts will appear as connected nodes.
            </p>
            <button
              onClick={() => navigate('/app/topics')}
              className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Create Your First Topic
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleExportAsPng = useCallback(async () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    setExportingImage(true);
    try {
      const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
      const width = svgEl.clientWidth || 1200;
      const height = svgEl.clientHeight || 800;
      svgClone.setAttribute('width', String(width * 2));
      svgClone.setAttribute('height', String(height * 2));
      svgClone.setAttribute('viewBox', svgEl.getAttribute('viewBox') || `0 0 ${width} ${height}`);
      // Set background
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('width', '100%');
      bg.setAttribute('height', '100%');
      bg.setAttribute('fill', document.documentElement.classList.contains('dark') ? '#111827' : '#ffffff');
      svgClone.insertBefore(bg, svgClone.firstChild);
      // Add watermark
      const watermark = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      watermark.setAttribute('x', String(width - 10));
      watermark.setAttribute('y', String(height - 10));
      watermark.setAttribute('text-anchor', 'end');
      watermark.setAttribute('font-size', '12');
      watermark.setAttribute('fill', document.documentElement.classList.contains('dark') ? '#6b7280' : '#9ca3af');
      watermark.textContent = 'Generated by me.md';
      svgClone.appendChild(watermark);

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgClone);
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
          if (!pngBlob) { setExportingImage(false); return; }
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement('a');
          a.href = pngUrl;
          a.download = `knowledge-graph-${new Date().toISOString().slice(0, 10)}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(pngUrl);
          setExportingImage(false);
          addToast('Knowledge graph exported as PNG', 'success');
        }, 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        setExportingImage(false);
        addToast('Failed to export graph image', 'error');
      };
      img.src = url;
    } catch {
      setExportingImage(false);
      addToast('Failed to export graph image', 'error');
    }
  }, [addToast]);

  return (
    <div className="max-w-full mx-auto px-1 sm:px-2" role="region" aria-label="Knowledge Graph visualization">
      {/* Header */}
      <div className="mb-3 sm:mb-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Knowledge Graph</h1>
          <p className="mt-0.5 sm:mt-1 text-sm text-gray-600 dark:text-gray-300 hidden sm:block">
            Visualize connections between your topics and insights
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Toggle gap nodes */}
          <label className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showGaps}
              onChange={(e) => setShowGaps(e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            <span className="hidden sm:inline">Show </span>Gaps
          </label>
          {/* Toggle concepts */}
          <label className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showConcepts}
              onChange={(e) => setShowConcepts(e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            <span className="hidden sm:inline">Show </span>Concepts
          </label>
          {/* Toggle personality nodes */}
          {(graphData?.stats?.personalityNodeCount || 0) > 0 && (
            <label className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showPersonality}
                onChange={(e) => setShowPersonality(e.target.checked)}
                className="w-4 h-4 text-pink-600 border-gray-300 rounded focus:ring-pink-500"
              />
              <span className="hidden sm:inline">Show </span>Personality
            </label>
          )}
          <button
            onClick={handleExportAsPng}
            disabled={exportingImage}
            className="px-3 py-1.5 text-xs sm:text-sm bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors min-h-[36px] border border-indigo-200 dark:border-indigo-700"
            aria-label="Export graph as PNG image"
          >
            {exportingImage ? 'Exporting...' : 'Export PNG'}
          </button>
          <button
            onClick={handleRefreshGraph}
            className="px-3 py-1.5 text-xs sm:text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors min-h-[36px]"
            aria-label="Refresh knowledge graph"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {graphData && graphData.stats && (
        <div className="mb-3 flex gap-2 sm:gap-4 flex-wrap text-xs sm:text-sm text-gray-600 dark:text-gray-300">
          <span>{graphData.stats.topicCount} topics</span>
          <span>{graphData.stats.conceptCount} concepts</span>
          {(graphData.stats.personalityNodeCount || 0) > 0 && (
            <span className="text-pink-600 dark:text-pink-400">{graphData.stats.personalityNodeCount} personality</span>
          )}
          <span>{graphData.stats.insightCount} insights</span>
          <span className="text-green-600 dark:text-green-400">{graphData.stats.verifiedInsightCount} verified</span>
          <span>{graphData.stats.edgeCount} connections</span>
          {(graphData.stats.unexploredCategories || 0) > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
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
          className="relative bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
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
              className="absolute z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg p-3 pointer-events-none max-w-xs"
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
                      ? (CATEGORY_COLORS[hoveredNode.category || 'default'] || CATEGORY_COLORS.default)
                      : getNodeColor(hoveredNode),
                    opacity: hoveredNode.type === 'gap' ? 0.5 : 1,
                    borderRadius: hoveredNode.type === 'personality_domain' ? '2px' : undefined,
                  }}
                />
                <span className="font-semibold text-sm text-gray-900 dark:text-white">
                  {hoveredNode.label}
                </span>
                <span className="text-xs text-gray-500 capitalize">
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
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
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
                    <span className="text-green-600">{hoveredNode.verifiedInsightCount || 0} verified</span>
                    <span>{hoveredNode.sessionCount || 0} sessions</span>
                  </div>
                  {hoveredNode.status && (
                    <div className="mt-1 flex items-center gap-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[hoveredNode.status] || '#9ca3af' }}
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
                        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Verified
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-gray-300">
                          {hoveredNode.verificationStatus === 'unverified' ? 'Pending verification' : hoveredNode.verificationStatus}
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
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Score</span>
                        <span className="text-sm font-bold text-gray-900 dark:text-white">
                          {hoveredNode.domainScore?.toFixed(1)}<span className="text-xs text-gray-400 font-normal">/5</span>
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            width: `${((hoveredNode.domainScore || 0) / 5) * 100}%`,
                            backgroundColor: getNodeColor(hoveredNode),
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  {hoveredNode.scoreLevel && (
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      hoveredNode.scoreLevel === 'High' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                      hoveredNode.scoreLevel === 'Above Average' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                      hoveredNode.scoreLevel === 'Average' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                      'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    }`}>
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
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-pink-600 dark:text-pink-400">
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
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Score</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                      {hoveredNode.facetScore?.toFixed(1)}<span className="text-xs text-gray-400 font-normal">/5</span>
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${((hoveredNode.facetScore || 0) / 5) * 100}%`,
                        backgroundColor: PERSONALITY_DOMAIN_COLORS[hoveredNode.domainKey || 'default'] || PERSONALITY_DOMAIN_COLORS.default,
                      }}
                    />
                  </div>
                  {hoveredNode.scoreLevel && (
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      hoveredNode.scoreLevel === 'High' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                      hoveredNode.scoreLevel === 'Moderate-High' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                      hoveredNode.scoreLevel === 'Average' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                      'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    }`}>
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
          <div className="absolute bottom-3 left-3 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg border border-gray-200 dark:border-gray-700 p-2 text-xs max-w-[160px] sm:max-w-none">
            <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Legend</div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-blue-500" />
                <span className="text-gray-600 dark:text-gray-300">Topic (explored)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full border-2 border-dashed border-amber-400 opacity-50" style={{ backgroundColor: '#fcd34d' }} />
                <span className="text-gray-600 dark:text-gray-300">Unexplored area</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-violet-400" />
                <span className="text-gray-600 dark:text-gray-300">Concept</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 14 14">
                  <polygon points="7,1 13,5.5 10.7,12.5 3.3,12.5 1,5.5" fill="#ec4899" stroke="#fff" strokeWidth="1" />
                </svg>
                <span className="text-gray-600 dark:text-gray-300">Personality domain</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12">
                  <polygon points="6,1 11,6 6,11 1,6" fill="#f9a8d4" stroke="#ec4899" strokeWidth="1" />
                </svg>
                <span className="text-gray-600 dark:text-gray-300">Personality facet</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-green-500 text-white flex items-center justify-center text-[7px] font-bold">3</span>
                <span className="text-gray-600 dark:text-gray-300">Verified insights</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 border-t border-gray-400" />
                <span className="text-gray-600 dark:text-gray-300">Connection</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 border-t border-dashed border-blue-300" />
                <span className="text-gray-600 dark:text-gray-300">Shared tag</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 border-t border-pink-300" />
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
              className="w-11 h-11 sm:w-8 sm:h-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-lg font-bold shadow-sm"
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
              className="w-11 h-11 sm:w-8 sm:h-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-lg font-bold shadow-sm"
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
              className="w-11 h-11 sm:w-8 sm:h-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm shadow-sm"
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
