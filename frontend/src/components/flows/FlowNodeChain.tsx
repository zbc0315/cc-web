import { Fragment, useMemo } from 'react';
import { ChevronRight, RotateCcw, CircleDot, CheckCircle2, Circle, User, Bot, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FlowNode, FlowState, NodeKind, RunStatus } from './types';

interface Props {
  nodes: FlowNode[];
  entryNodeId: number;
  mode: 'editor' | 'runtime';
  /** Runtime-only: current node id, history visited set, run status. */
  state?: FlowState | null;
  /** Editor-only: click handler for node chip. */
  onNodeClick?: (nodeId: number) => void;
}

/** Compute display ordering: DFS from entry, append orphans last. Visited
 *  nodes (loop targets) skipped to keep the strip flat. */
function orderNodes(nodes: FlowNode[], entryNodeId: number): number[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const order: number[] = [];
  const visited = new Set<number>();
  const stack = [entryNodeId];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;
    visited.add(id);
    order.push(id);
    const successors: number[] = [];
    if (node.kind === 'user-input' || node.kind === 'llm') {
      if (node.next != null) successors.push(node.next);
    } else if (node.kind === 'system-logic') {
      if (node.defaultGoto != null) successors.push(node.defaultGoto);
      for (const b of node.branches) successors.push(b.goto);
    }
    // Push in reverse so the first successor pops next (DFS preserves order)
    for (let i = successors.length - 1; i >= 0; i--) stack.push(successors[i]);
  }
  // Orphans (unreachable from entry) at the end so they're still visible
  for (const n of nodes) if (!visited.has(n.id)) order.push(n.id);
  return order;
}

function kindIcon(k: NodeKind) {
  if (k === 'user-input') return User;
  if (k === 'llm') return Bot;
  return GitBranch;
}

function runtimeChipState(
  id: number,
  currentNodeId: number | null | undefined,
  visited: Set<number>,
  status: RunStatus | undefined,
): 'completed' | 'current' | 'future' {
  if (status === 'completed' || status === 'failed' || status === 'aborted') {
    return visited.has(id) ? 'completed' : 'future';
  }
  if (currentNodeId === id) return 'current';
  if (visited.has(id)) return 'completed';
  return 'future';
}

export function FlowNodeChain({ nodes, entryNodeId, mode, state, onNodeClick }: Props) {
  const order = useMemo(() => orderNodes(nodes, entryNodeId), [nodes, entryNodeId]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);
  const visitedHistory = useMemo(
    () => new Set((state?.history ?? []).map((h) => h.nodeId)),
    [state?.history],
  );

  if (order.length === 0) {
    return (
      <div className="text-xs text-muted-foreground px-3 py-2">空流，添加节点以构建链路</div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-2 px-3 scrollbar-thin">
      {order.map((id, idx) => {
        const node = byId.get(id);
        if (!node) return null;
        const Icon = kindIcon(node.kind);
        const rstate = mode === 'runtime'
          ? runtimeChipState(id, state?.currentNodeId, visitedHistory, state?.status)
          : null;

        // Detect loop edges: any successor pointing to an already-visited id
        const loopTargets: number[] = [];
        if (node.kind === 'system-logic') {
          for (const b of node.branches) {
            const targetIdx = order.indexOf(b.goto);
            if (targetIdx !== -1 && targetIdx < idx) loopTargets.push(b.goto);
          }
        }

        return (
          <Fragment key={id}>
            <button
              type="button"
              onClick={() => onNodeClick?.(id)}
              disabled={!onNodeClick}
              className={cn(
                'group flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-all',
                mode === 'editor' && [
                  node.kind === 'user-input' && 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
                  node.kind === 'llm' && 'bg-primary/10 border-primary/30 text-primary',
                  node.kind === 'system-logic' && 'bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300',
                  onNodeClick && 'hover:scale-105 cursor-pointer',
                ],
                mode === 'runtime' && [
                  rstate === 'completed' && 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
                  rstate === 'current' && 'bg-primary/15 border-primary text-primary ring-2 ring-primary/30 animate-pulse',
                  rstate === 'future' && 'bg-muted/40 border-border text-muted-foreground',
                ],
              )}
              title={`#${node.id} · ${node.name}`}
            >
              {mode === 'runtime' && rstate === 'completed' && <CheckCircle2 className="h-3 w-3" />}
              {mode === 'runtime' && rstate === 'current' && <CircleDot className="h-3 w-3" />}
              {mode === 'runtime' && rstate === 'future' && <Circle className="h-3 w-3" />}
              {mode === 'editor' && <Icon className="h-3 w-3" />}
              <span className="font-mono opacity-70">#{node.id}</span>
              <span className="max-w-[7rem] truncate">{node.name}</span>
              {loopTargets.length > 0 && (
                <span className="flex items-center gap-0.5 ml-0.5 text-[10px] opacity-70" title={`回边 → ${loopTargets.map((t) => '#' + t).join(', ')}`}>
                  <RotateCcw className="h-2.5 w-2.5" />
                  {loopTargets.map((t) => '#' + t).join('')}
                </span>
              )}
            </button>
            {idx < order.length - 1 && (
              <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
