import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, RefreshCw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { readFile } from '@/lib/api';
import * as yaml from 'js-yaml';

interface GraphPage {
  id: string;
  title: string;
  file: string;
  parent?: string | null;
}

interface GraphRelation {
  from: string;
  to: string;
  label?: string;
}

interface GraphData {
  pages: GraphPage[];
  relations: GraphRelation[];
}

interface LayoutNode {
  id: string;
  title: string;
  x: number;
  y: number;
  layer: number;
}

interface LayoutEdge {
  from: string;
  to: string;
  label?: string;
}

// ── Layout algorithm: layered DAG ─────────────────────────────────────────────

function computeLayout(data: GraphData): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const pages = data.pages || [];
  const relations = data.relations || [];

  if (pages.length === 0) return { nodes: [], edges: [] };

  // Build adjacency (from → [to])
  const outEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const p of pages) {
    outEdges.set(p.id, []);
    inDegree.set(p.id, 0);
  }
  for (const r of relations) {
    outEdges.get(r.from)?.push(r.to);
    inDegree.set(r.to, (inDegree.get(r.to) || 0) + 1);
  }

  // Topological sort → assign layers (longest path from root)
  const layer = new Map<string, number>();
  const queue: string[] = [];

  for (const p of pages) {
    if ((inDegree.get(p.id) || 0) === 0) {
      queue.push(p.id);
      layer.set(p.id, 0);
    }
  }

  // BFS to assign layers
  let maxLayer = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    const currentLayer = layer.get(id) || 0;
    for (const to of outEdges.get(id) || []) {
      const newLayer = currentLayer + 1;
      if (newLayer > (layer.get(to) || 0)) {
        layer.set(to, newLayer);
        if (newLayer > maxLayer) maxLayer = newLayer;
      }
      const remaining = (inDegree.get(to) || 1) - 1;
      inDegree.set(to, remaining);
      if (remaining <= 0) {
        queue.push(to);
      }
    }
  }

  // Assign any unvisited nodes (cycles or disconnected)
  for (const p of pages) {
    if (!layer.has(p.id)) {
      layer.set(p.id, maxLayer + 1);
    }
  }

  // Group by layer
  const layerGroups = new Map<number, string[]>();
  for (const p of pages) {
    const l = layer.get(p.id) || 0;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(p.id);
  }

  // Position nodes
  const NODE_W = 160;
  const NODE_H = 50;
  const H_GAP = 60;
  const V_GAP = 80;

  const nodes: LayoutNode[] = [];
  const pageMap = new Map(pages.map((p) => [p.id, p]));

  for (const [l, ids] of layerGroups) {
    const totalWidth = ids.length * NODE_W + (ids.length - 1) * H_GAP;
    const startX = -totalWidth / 2;
    ids.forEach((id, i) => {
      const page = pageMap.get(id);
      nodes.push({
        id,
        title: page?.title || id,
        x: startX + i * (NODE_W + H_GAP) + NODE_W / 2,
        y: l * (NODE_H + V_GAP),
        layer: l,
      });
    });
  }

  const edges: LayoutEdge[] = relations.map((r) => ({
    from: r.from,
    to: r.to,
    label: r.label,
  }));

  return { nodes, edges };
}

// ── Colors ────────────────────────────────────────────────────────────────────

const LAYER_COLORS = [
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#f97316', // orange
  '#6366f1', // indigo
];

// ── Component ─────────────────────────────────────────────────────────────────

interface GraphPreviewProps {
  folderPath: string;
}

export function GraphPreview({ folderPath }: GraphPreviewProps) {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const graphPath = `${folderPath}/.notebook/graph.yaml`;

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const file = await readFile(graphPath);
      if (!file.content) {
        setError('graph.yaml is empty');
        setData(null);
        return;
      }
      const parsed = yaml.load(file.content) as GraphData;
      setData(parsed);
      // Reset view
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } catch {
      setError('Cannot read .notebook/graph.yaml');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [graphPath]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.max(0.2, Math.min(3, z + delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const fitView = useCallback(() => {
    if (!data || !containerRef.current) return;
    const { nodes } = computeLayout(data);
    if (nodes.length === 0) return;

    const minX = Math.min(...nodes.map((n) => n.x)) - 100;
    const maxX = Math.max(...nodes.map((n) => n.x)) + 100;
    const minY = Math.min(...nodes.map((n) => n.y)) - 40;
    const maxY = Math.max(...nodes.map((n) => n.y)) + 60;

    const graphW = maxX - minX;
    const graphH = maxY - minY;
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;

    const newZoom = Math.min(containerW / graphW, containerH / graphH, 1.5) * 0.9;
    setZoom(newZoom);
    setPan({
      x: containerW / 2 - ((minX + maxX) / 2) * newZoom,
      y: containerH / 2 - ((minY + maxY) / 2) * newZoom,
    });
  }, [data]);

  const { nodes, edges } = useMemo(() => data ? computeLayout(data) : { nodes: [], edges: [] }, [data]);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  useEffect(() => {
    if (data && !loading) {
      const timer = setTimeout(fitView, 50);
      return () => clearTimeout(timer);
    }
  }, [data, loading, fitView]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm px-4 text-center">
        <p>{error || 'No graph data'}</p>
        <Button variant="ghost" size="sm" onClick={() => void loadGraph()}>
          <RefreshCw className="h-3 w-3 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b shrink-0">
        <span className="text-xs text-muted-foreground mr-auto">
          {nodes.length} pages, {edges.length} relations
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom((z) => Math.min(3, z + 0.2))}>
          <ZoomIn className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom((z) => Math.max(0.2, z - 0.2))}>
          <ZoomOut className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fitView}>
          <Maximize2 className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void loadGraph()}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* Graph canvas */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing bg-muted/30"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ userSelect: 'none' }}
        >
          <defs>
            <marker
              id="arrowhead"
              viewBox="0 0 10 7"
              refX="10"
              refY="3.5"
              markerWidth="8"
              markerHeight="6"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" className="fill-muted-foreground/60" />
            </marker>
          </defs>

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Edges */}
            {edges.map((edge, i) => {
              const from = nodeMap.get(edge.from);
              const to = nodeMap.get(edge.to);
              if (!from || !to) return null;

              const fromY = from.y + 20;
              const toY = to.y - 20;
              const midY = (fromY + toY) / 2;

              return (
                <g key={`edge-${i}`}>
                  <path
                    d={`M ${from.x} ${fromY} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${toY}`}
                    fill="none"
                    className="stroke-muted-foreground/40"
                    strokeWidth={1.5}
                    markerEnd="url(#arrowhead)"
                  />
                  {edge.label && (
                    <text
                      x={(from.x + to.x) / 2}
                      y={midY - 4}
                      textAnchor="middle"
                      className="fill-muted-foreground/60"
                      fontSize={9}
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => {
              const color = LAYER_COLORS[node.layer % LAYER_COLORS.length];
              const w = 140;
              const h = 36;

              return (
                <g key={node.id} transform={`translate(${node.x - w / 2}, ${node.y - h / 2})`}>
                  <rect
                    width={w}
                    height={h}
                    rx={8}
                    fill={color}
                    fillOpacity={0.15}
                    stroke={color}
                    strokeWidth={1.5}
                  />
                  <text
                    x={w / 2}
                    y={h / 2 + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-foreground"
                    fontSize={11}
                    fontWeight={500}
                  >
                    {node.title.length > 14 ? node.title.slice(0, 13) + '…' : node.title}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
