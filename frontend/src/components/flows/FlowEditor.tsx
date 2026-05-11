import { useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NodeCard } from './NodeCard';
import { FlowNodeChain } from './FlowNodeChain';
import { NodeCreationDialog } from './NodeCreationDialog';
import type { FlowDef, FlowNode, NodeKind } from './types';

interface Props {
  def: FlowDef;
  onCancel: () => void;
  onSave: (def: FlowDef) => void;
}

function makeBlankNode(kind: NodeKind, id: number, name: string): FlowNode {
  if (kind === 'user-input') {
    return {
      id, name, kind: 'user-input',
      userInputSchema: { fields: [{ key: '', label: '', type: 'text' }] },
      outputs: [{ path: '', provider: 'system' }],
      next: null,
    };
  }
  if (kind === 'llm') {
    return {
      id, name, kind: 'llm',
      inputs: [], promptTemplate: '', outputs: [],
      timeoutSec: 600, next: null,
    };
  }
  return {
    id, name, kind: 'system-logic',
    inputs: [{ path: '', provider: 'llm' }],
    branches: [], maxRetries: 3, defaultGoto: null,
  };
}

/** Node ids whose `next` (or defaultGoto for system-logic) is currently null
 *  — these are candidate predecessors to auto-wire a new node onto. */
function findDanglingPredecessors(nodes: FlowNode[]): number[] {
  return nodes
    .filter((n) => {
      if (n.kind === 'user-input' || n.kind === 'llm') return n.next === null;
      // system-logic: dangling if defaultGoto is null AND no branches
      return n.defaultGoto == null && n.branches.length === 0;
    })
    .map((n) => n.id);
}

export function FlowEditor({ def, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState<FlowDef>(def);
  const [creationOpen, setCreationOpen] = useState(false);
  const nodeRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const allIds = useMemo(() => draft.nodes.map((n) => n.id), [draft.nodes]);
  const dangling = useMemo(() => findDanglingPredecessors(draft.nodes), [draft.nodes]);

  const updateNode = (id: number, next: FlowNode) => {
    setDraft({ ...draft, nodes: draft.nodes.map((n) => (n.id === id ? next : n)) });
  };
  const deleteNode = (id: number) => {
    if (draft.nodes.length <= 1) return;
    const remaining: FlowNode[] = draft.nodes
      .filter((n) => n.id !== id)
      .map((n) => {
        if (n.kind === 'user-input') return n.next === id ? { ...n, next: null } : n;
        if (n.kind === 'llm') return n.next === id ? { ...n, next: null } : n;
        return {
          ...n,
          branches: n.branches.filter((b) => b.goto !== id),
          defaultGoto: n.defaultGoto === id ? null : (n.defaultGoto ?? null),
        };
      });
    setDraft({
      ...draft,
      nodes: remaining,
      entryNodeId: draft.entryNodeId === id ? remaining[0].id : draft.entryNodeId,
    });
  };

  const createNode = ({ name, kind, wireFrom }: { name: string; kind: NodeKind; wireFrom: number | null }) => {
    const nextId = (Math.max(0, ...allIds) || 0) + 1;
    const newNode = makeBlankNode(kind, nextId, name);
    let nodes = [...draft.nodes, newNode];
    if (wireFrom != null) {
      // Wire the chosen predecessor's next to point to the new node. For
      // system-logic, we set defaultGoto (the "no branch matched" path)
      // since branches need explicit field/value config.
      nodes = nodes.map((n) => {
        if (n.id !== wireFrom) return n;
        if (n.kind === 'user-input' || n.kind === 'llm') return { ...n, next: nextId };
        return { ...n, defaultGoto: nextId };
      });
    }
    setDraft({ ...draft, nodes });
    // Scroll the new card into view after React commits
    setTimeout(() => {
      nodeRefs.current[nextId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const handleChipClick = (id: number) => {
    nodeRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-3">
      {/* Header — flow-level metadata */}
      <div className="grid grid-cols-2 gap-3 flex-shrink-0">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">流名称</Label>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="h-8"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">入口节点</Label>
          <Select
            value={String(draft.entryNodeId)}
            onValueChange={(v) => setDraft({ ...draft, entryNodeId: Number(v) })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {allIds.map((id) => (
                <SelectItem key={id} value={String(id)}>#{id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs text-muted-foreground">描述（可选）</Label>
          <Input
            value={draft.description ?? ''}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="h-8"
          />
        </div>
      </div>

      {/* Horizontal node chain — global structure overview, click to focus */}
      <div className="flex-shrink-0 border border-border rounded-xl bg-muted/30">
        <FlowNodeChain
          nodes={draft.nodes}
          entryNodeId={draft.entryNodeId}
          mode="editor"
          onNodeClick={handleChipClick}
        />
      </div>

      {/* Node detail cards — scroll target for chain clicks */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
        {draft.nodes.map((n) => (
          <div
            key={n.id}
            ref={(el) => { nodeRefs.current[n.id] = el; }}
          >
            <NodeCard
              node={n}
              allIds={allIds}
              onChange={(next) => updateNode(n.id, next)}
              onDelete={() => deleteNode(n.id)}
            />
          </div>
        ))}
      </div>

      {/* Footer — add node + save/cancel */}
      <div className="flex-shrink-0 flex items-center gap-2 pt-2 border-t border-border">
        <Button size="sm" variant="outline" onClick={() => setCreationOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> 添加节点
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
        <Button size="sm" onClick={() => onSave(draft)}>保存</Button>
      </div>

      <NodeCreationDialog
        open={creationOpen}
        onOpenChange={setCreationOpen}
        allIds={allIds}
        danglingPredecessors={dangling}
        onCreate={createNode}
      />
    </div>
  );
}
