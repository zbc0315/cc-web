// frontend/src/components/TaskTree.tsx
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import type { PlanTreeNode } from '@/lib/api';

const NODE_W = 140;
const NODE_H = 36;
const H_GAP = 20;
const V_GAP = 16;
const PAD_X = 40;
const PAD_Y = 20;

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: PlanTreeNode['type'];
  label: string;
  status?: PlanTreeNode['status'];
  node_id?: string;
  line: number;
  children: LayoutNode[];
}

interface Edge {
  x1: number; y1: number; x2: number; y2: number;
  dashed?: boolean;
}

const STATUS_COLORS: Record<string, { fill: string; stroke: string }> = {
  pending:  { fill: '#71717a20', stroke: '#71717a' },
  running:  { fill: '#3b82f633', stroke: '#3b82f6' },
  success:  { fill: '#22c55e26', stroke: '#22c55e' },
  failed:   { fill: '#ef444426', stroke: '#ef4444' },
  blocked:  { fill: '#eab30826', stroke: '#eab308' },
  skipped:  { fill: '#71717a14', stroke: '#71717a' },
};
const DEFAULT_COLOR = { fill: '#71717a15', stroke: '#52525b' };

interface TaskTreeProps {
  tree: PlanTreeNode[];
  currentLine: number | null;
}

export function TaskTree({ tree, currentLine }: TaskTreeProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<LayoutNode | null>(null);

  // Layout computation
  const { layoutNodes, edges, bounds } = useMemo(() => {
    const lNodes: LayoutNode[] = [];
    const lEdges: Edge[] = [];

    function layoutChildren(children: PlanTreeNode[], _parentX: number, startY: number, depth: number): { nodes: LayoutNode[]; height: number } {
      const nodes: LayoutNode[] = [];
      let y = startY;

      for (const child of children) {
        const x = PAD_X + depth * (NODE_W + H_GAP);
        const node: LayoutNode = {
          id: child.id,
          x, y, w: NODE_W, h: NODE_H,
          type: child.type,
          label: child.label,
          status: child.status,
          node_id: child.node_id,
          line: child.line,
          children: [],
        };

        if (child.children.length > 0) {
          const childResult = layoutChildren(child.children, x, y + NODE_H + V_GAP, depth + 1);
          node.children = childResult.nodes;
          y = Math.max(y + NODE_H + V_GAP, y + NODE_H + V_GAP + childResult.height);

          // Draw edges from parent to children
          for (const c of childResult.nodes) {
            lEdges.push({
              x1: node.x + NODE_W / 2, y1: node.y + NODE_H,
              x2: c.x + NODE_W / 2, y2: c.y,
              dashed: child.type === 'call',
            });
          }
        } else {
          y += NODE_H + V_GAP;
        }

        nodes.push(node);
        lNodes.push(node);
      }

      return { nodes, height: y - startY };
    }

    const result = layoutChildren(tree, 0, PAD_Y, 0);

    // Connect sequential siblings with edges
    for (let i = 1; i < result.nodes.length; i++) {
      const prev = result.nodes[i - 1];
      const curr = result.nodes[i];
      if (prev.x === curr.x) {
        const prevBottom = getBottomY(prev);
        lEdges.push({
          x1: prev.x + NODE_W / 2, y1: prevBottom,
          x2: curr.x + NODE_W / 2, y2: curr.y,
        });
      }
    }

    // Compute bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of lNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }

    return {
      layoutNodes: lNodes,
      edges: lEdges,
      bounds: { minX, minY, maxX: maxX + PAD_X, maxY: maxY + PAD_Y },
    };
  }, [tree]);

  const fitView = useCallback(() => {
    if (!svgRef.current || layoutNodes.length === 0) return;
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    if (w === 0 || h === 0) return;
    const scale = Math.min(rect.width / w, rect.height / h, 2) * 0.9;
    setZoom(scale);
    setPan({
      x: (rect.width - w * scale) / 2 - bounds.minX * scale,
      y: (rect.height - h * scale) / 2 - bounds.minY * scale,
    });
  }, [layoutNodes, bounds]);

  // Auto-fit on load
  useEffect(() => {
    fitView();
  }, [tree, fitView]);

  // Scroll current line into view
  useEffect(() => {
    if (currentLine === null) return;
    const node = layoutNodes.find(n => n.line === currentLine);
    if (!node || !svgRef.current) return;
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const cx = node.x + NODE_W / 2;
    const cy = node.y + NODE_H / 2;
    setPan({ x: rect.width / 2 - cx * zoom, y: rect.height / 2 - cy * zoom });
  }, [currentLine, layoutNodes, zoom]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.2, Math.min(3, z + (e.deltaY > 0 ? -0.1 : 0.1))));
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

  const handleMouseUp = useCallback(() => setDragging(false), []);

  return (
    <div className="relative w-full h-full">
      {/* Toolbar */}
      <div className="absolute top-1 right-1 z-10 flex gap-0.5">
        <button className="p-1 rounded bg-muted/50 hover:bg-muted" onClick={() => setZoom(z => Math.min(3, z + 0.2))}>
          <ZoomIn className="h-3 w-3" />
        </button>
        <button className="p-1 rounded bg-muted/50 hover:bg-muted" onClick={() => setZoom(z => Math.max(0.2, z - 0.2))}>
          <ZoomOut className="h-3 w-3" />
        </button>
        <button className="p-1 rounded bg-muted/50 hover:bg-muted" onClick={fitView}>
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        className="w-full h-full"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#71717a" />
          </marker>
        </defs>

        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {edges.map((e, i) => (
            <line
              key={`e${i}`}
              x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
              stroke="#71717a" strokeWidth={1}
              strokeDasharray={e.dashed ? '4,2' : undefined}
              markerEnd="url(#arrow)"
            />
          ))}

          {/* Nodes */}
          {layoutNodes.map(node => {
            const colors = STATUS_COLORS[node.status ?? ''] ?? DEFAULT_COLOR;
            const isCurrent = currentLine === node.line;

            return (
              <g key={node.id} onClick={() => setSelectedNode(node)} style={{ cursor: 'pointer' }}>
                <rect
                  x={node.x} y={node.y}
                  width={node.w} height={node.h}
                  rx={6}
                  fill={colors.fill}
                  stroke={isCurrent ? '#60a5fa' : colors.stroke}
                  strokeWidth={isCurrent ? 2 : 1}
                  strokeDasharray={node.status === 'skipped' ? '4,2' : undefined}
                />
                {/* Running pulse */}
                {node.status === 'running' && (
                  <rect
                    x={node.x} y={node.y}
                    width={node.w} height={node.h}
                    rx={6}
                    fill="none" stroke="#3b82f6" strokeWidth={2}
                    opacity={0.5}
                  >
                    <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
                  </rect>
                )}
                {/* Type tag */}
                <text
                  x={node.x + 6} y={node.y + 13}
                  fontSize={9} fill="#a1a1aa" fontFamily="monospace"
                >
                  {node.type}
                </text>
                {/* Label */}
                <text
                  x={node.x + 6} y={node.y + 26}
                  fontSize={10} fill="#e4e4e7"
                  clipPath={`inset(0 0 0 0)`}
                >
                  {node.label.length > 16 ? node.label.slice(0, 16) + '…' : node.label}
                </text>
                {/* Node ID badge */}
                {node.node_id && (
                  <text
                    x={node.x + node.w - 4} y={node.y + 10}
                    fontSize={7} fill="#71717a" textAnchor="end"
                  >
                    #{node.node_id}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Node detail popover */}
      {selectedNode && (
        <div
          className="absolute bottom-2 left-2 right-2 bg-background/95 border border-border rounded-lg p-3 text-xs shadow-lg z-20"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-start mb-1">
            <span className="font-mono text-muted-foreground">{selectedNode.type} L{selectedNode.line}</span>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => setSelectedNode(null)}>✕</button>
          </div>
          <div className="text-foreground mb-1">{selectedNode.label}</div>
          {selectedNode.status && (
            <div className="text-muted-foreground">状态: {selectedNode.status}</div>
          )}
          {selectedNode.node_id && (
            <div className="text-muted-foreground">节点 ID: #{selectedNode.node_id}</div>
          )}
        </div>
      )}
    </div>
  );
}

function getBottomY(node: LayoutNode): number {
  if (node.children.length === 0) return node.y + node.h;
  return Math.max(node.y + node.h, ...node.children.map(getBottomY));
}
