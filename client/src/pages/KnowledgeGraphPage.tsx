import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import * as d3 from 'd3';

interface GraphNode {
  id: string;
  entityId: string;
  type: 'topic' | 'concept';
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
  lastUpdated?: string;
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
  edgeCount: number;
  insightCount: number;
  verifiedInsightCount: number;
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

const STATUS_COLORS: Record<string, string> = {
  backlog: '#9ca3af',      // gray
  scheduled: '#f59e0b',    // amber
  in_progress: '#3b82f6',  // blue
  extracted: '#10b981',    // green
  refined: '#6366f1',      // indigo
};

function getNodeColor(node: GraphNode): string {
  if (node.type === 'concept') return '#a78bfa'; // violet-400
  if (node.category) return CATEGORY_COLORS[node.category] || CATEGORY_COLORS.default;
  return CATEGORY_COLORS.default;
}

function getNodeRadius(node: GraphNode): number {
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
    default: return '#9ca3af'; // gray-400
  }
}

export default function KnowledgeGraphPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; stats: GraphStats } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showConcepts, setShowConcepts] = useState(true);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);

  // Fetch graph data
  const fetchGraph = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/graph', {
        headers: { 'x-user-id': user.id },
      });
      if (!res.ok) throw new Error('Failed to load graph data');
      const data = await res.json();
      setGraphData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Render D3 graph
  useEffect(() => {
    if (!graphData || !svgRef.current || !containerRef.current) return;
    if (graphData.nodes.length === 0) return;

    // Filter nodes/edges based on showConcepts toggle
    let nodes = graphData.nodes;
    let edges = graphData.edges;
    if (!showConcepts) {
      const topicNodeIds = new Set(nodes.filter(n => n.type === 'topic').map(n => n.id));
      nodes = nodes.filter(n => n.type === 'topic');
      edges = edges.filter(e => {
        const srcId = typeof e.source === 'string' ? e.source : e.source.id;
        const tgtId = typeof e.target === 'string' ? e.target : e.target.id;
        return topicNodeIds.has(srcId) && topicNodeIds.has(tgtId);
      });
    }

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

    // Setup zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Center the initial view
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8));

    // Edge force: distance based on edge type
    function linkDistance(d: any): number {
      if (d.type === 'contains') return 40;
      if (d.type === 'tag_shared') return 150;
      if (d.type === 'multi_bucket') return 120;
      return 100;
    }

    // Create simulation
    const simulation = d3.forceSimulation<GraphNode>(simNodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(simEdges)
        .id((d: GraphNode) => d.id)
        .distance(linkDistance)
        .strength((d: any) => d.weight * 0.3)
      )
      .force('charge', d3.forceManyBody()
        .strength((d: any) => d.type === 'concept' ? -30 : -120)
      )
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide<GraphNode>()
        .radius((d: GraphNode) => getNodeRadius(d) + 4)
      )
      .alphaDecay(0.02)
      .velocityDecay(0.3);

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

    // Node circles
    node.append('circle')
      .attr('r', (d: GraphNode) => getNodeRadius(d))
      .attr('fill', (d: GraphNode) => getNodeColor(d))
      .attr('stroke', '#fff')
      .attr('stroke-width', (d: GraphNode) => d.type === 'topic' ? 2 : 1)
      .attr('opacity', (d: GraphNode) => {
        if (d.type === 'concept') return 0.8;
        return 1;
      });

    // Status ring for topics
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

    // Labels for concept nodes (smaller, only visible on hover)
    node.filter((d: GraphNode) => d.type === 'concept')
      .append('text')
      .attr('dy', (d: GraphNode) => getNodeRadius(d) + 10)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('fill', 'currentColor')
      .attr('class', 'text-gray-600 dark:text-gray-400')
      .attr('opacity', 0.7)
      .style('pointer-events', 'none')
      .text((d: GraphNode) => {
        const label = d.label || '';
        return label.length > 16 ? label.substring(0, 14) + '...' : label;
      });

    // Mouse events for tooltips
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

    // Click to navigate
    node.on('click', (_event: MouseEvent, d: GraphNode) => {
      if (d.type === 'topic') {
        navigate(`/app/topics/${d.entityId}`);
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
  }, [graphData, showConcepts, navigate]);

  // Empty state
  if (!loading && graphData && graphData.nodes.length === 0) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Knowledge Graph</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Visualize connections between your topics and insights
          </p>
        </div>
        <div className="card" style={{ minHeight: '500px' }}>
          <div className="flex flex-col items-center justify-center h-96">
            <span className="text-5xl block mb-4">🔗</span>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Your Knowledge Graph
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-center max-w-md">
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

  return (
    <div className="max-w-full mx-auto px-2">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Knowledge Graph</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Visualize connections between your topics and insights
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Toggle concepts */}
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showConcepts}
              onChange={(e) => setShowConcepts(e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            Show Concepts
          </label>
          <button
            onClick={fetchGraph}
            className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {graphData && graphData.stats && (
        <div className="mb-3 flex gap-4 flex-wrap text-sm text-gray-600 dark:text-gray-400">
          <span>{graphData.stats.topicCount} topics</span>
          <span>{graphData.stats.conceptCount} concepts</span>
          <span>{graphData.stats.insightCount} insights</span>
          <span className="text-green-600 dark:text-green-400">{graphData.stats.verifiedInsightCount} verified</span>
          <span>{graphData.stats.edgeCount} connections</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
          <button onClick={fetchGraph} className="ml-2 underline">Retry</button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="card" style={{ minHeight: '600px' }}>
          <div className="flex flex-col items-center justify-center h-96">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading knowledge graph...</p>
          </div>
        </div>
      )}

      {/* Graph */}
      {!loading && graphData && graphData.nodes.length > 0 && (
        <div
          ref={containerRef}
          className="relative bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
          style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}
        >
          <svg
            ref={svgRef}
            className="w-full h-full"
            style={{ width: '100%', height: '100%' }}
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
                  className="w-3 h-3 rounded-full inline-block"
                  style={{ backgroundColor: getNodeColor(hoveredNode) }}
                />
                <span className="font-semibold text-sm text-gray-900 dark:text-white">
                  {hoveredNode.label}
                </span>
                <span className="text-xs text-gray-500 capitalize">
                  ({hoveredNode.type})
                </span>
              </div>

              {hoveredNode.type === 'topic' && (
                <>
                  {hoveredNode.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                      {hoveredNode.description}
                    </p>
                  )}
                  <div className="mt-2 flex gap-3 text-xs text-gray-500 dark:text-gray-400">
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
                      <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                        {hoveredNode.status.replace('_', ' ')}
                      </span>
                    </div>
                  )}
                  {hoveredNode.tags && hoveredNode.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {hoveredNode.tags.slice(0, 5).map((tag: string) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {hoveredNode.lastUpdated && (
                    <p className="text-xs text-gray-400 mt-1">
                      Updated: {new Date(hoveredNode.lastUpdated).toLocaleDateString()}
                    </p>
                  )}
                </>
              )}

              {hoveredNode.type === 'concept' && (
                <p className="text-xs text-gray-500 mt-1">
                  Weight: {hoveredNode.weight?.toFixed(1)}
                </p>
              )}
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-3 left-3 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg border border-gray-200 dark:border-gray-700 p-2 text-xs">
            <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Legend</div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-blue-500" />
                <span className="text-gray-600 dark:text-gray-400">Topic</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-violet-400" />
                <span className="text-gray-600 dark:text-gray-400">Concept</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-green-500 text-white flex items-center justify-center text-[7px] font-bold">3</span>
                <span className="text-gray-600 dark:text-gray-400">Verified insights</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 border-t border-gray-400" />
                <span className="text-gray-600 dark:text-gray-400">Connection</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 border-t border-dashed border-blue-300" />
                <span className="text-gray-600 dark:text-gray-400">Shared tag</span>
              </div>
            </div>
          </div>

          {/* Zoom controls */}
          <div className="absolute top-3 right-3 flex flex-col gap-1">
            <button
              onClick={() => {
                const svg = d3.select(svgRef.current!);
                svg.transition().duration(300).call(
                  d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.1, 4]).on('zoom', () => {}).scaleBy,
                  1.3
                );
              }}
              className="w-8 h-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 text-lg font-bold"
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
              className="w-8 h-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 text-lg font-bold"
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
              className="w-8 h-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 text-xs"
              title="Reset view"
            >
              ↺
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
