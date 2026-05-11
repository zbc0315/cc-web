import { useMemo, useState } from 'react';
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
import type { FlowDef, FlowNode, NodeKind } from './types';

interface Props {
  def: FlowDef;
  onCancel: () => void;
  onSave: (def: FlowDef) => void;
}

function makeBlankNode(kind: NodeKind, id: number): FlowNode {
  if (kind === 'user-input') {
    return {
      id, name: '新节点', kind: 'user-input',
      userInputSchema: { fields: [{ key: '', label: '', type: 'text' }] },
      outputs: [{ path: '', provider: 'system' }],
      next: null,
    };
  }
  if (kind === 'llm') {
    return {
      id, name: '新节点', kind: 'llm',
      inputs: [], promptTemplate: '', outputs: [],
      timeoutSec: 600, next: null,
    };
  }
  return {
    id, name: '新节点', kind: 'system-logic',
    inputs: [{ path: '', provider: 'llm' }],
    branches: [], maxRetries: 3, defaultGoto: null,
  };
}

export function FlowEditor({ def, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState<FlowDef>(def);
  const [newKind, setNewKind] = useState<NodeKind>('llm');

  const allIds = useMemo(() => draft.nodes.map((n) => n.id), [draft.nodes]);

  const updateNode = (id: number, next: FlowNode) => {
    setDraft({ ...draft, nodes: draft.nodes.map((n) => (n.id === id ? next : n)) });
  };
  const deleteNode = (id: number) => {
    if (draft.nodes.length <= 1) return;
    setDraft({
      ...draft,
      nodes: draft.nodes.filter((n) => n.id !== id),
      entryNodeId: draft.entryNodeId === id ? draft.nodes.find((n) => n.id !== id)!.id : draft.entryNodeId,
    });
  };
  const addNode = () => {
    const nextId = (Math.max(0, ...allIds) || 0) + 1;
    setDraft({ ...draft, nodes: [...draft.nodes, makeBlankNode(newKind, nextId)] });
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

      {/* Node list */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
        {draft.nodes.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            allIds={allIds}
            onChange={(next) => updateNode(n.id, next)}
            onDelete={() => deleteNode(n.id)}
          />
        ))}
      </div>

      {/* Footer — add node + save/cancel */}
      <div className="flex-shrink-0 flex items-center gap-2 pt-2 border-t border-border">
        <Select value={newKind} onValueChange={(v) => setNewKind(v as NodeKind)}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="user-input">用户输入</SelectItem>
            <SelectItem value="llm">LLM</SelectItem>
            <SelectItem value="system-logic">系统逻辑</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={addNode}>
          <Plus className="h-4 w-4 mr-1" /> 添加节点
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
        <Button size="sm" onClick={() => onSave(draft)}>保存</Button>
      </div>
    </div>
  );
}
