import { useMemo, useRef, useState } from 'react';
import { Plus, X, AlertTriangle } from 'lucide-react';
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
import { DEFAULT_VAR_FILE, type FlowDef, type FlowNode, type FlowVariable, type NodeKind } from './types';

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

      {/* Variables card — flow-level shared variables */}
      <VariablesCard
        variables={draft.variables ?? []}
        onChange={(variables) => setDraft({ ...draft, variables })}
        onDelete={(name) => {
          // Drop the variable AND scrub references from every node so the
          // backend validator doesn't reject the save with a generic message
          // (mirrors deleteNode's reference cleanup).
          setDraft((prev) => ({
            ...prev,
            variables: (prev.variables ?? []).filter((v) => v.name !== name),
            nodes: prev.nodes.map((n) => {
              if (n.kind === 'llm') {
                const filtered = (n.initVariables ?? []).filter((vn) => vn !== name);
                return filtered.length === (n.initVariables?.length ?? 0)
                  ? n
                  : { ...n, initVariables: filtered };
              }
              if (n.kind === 'system-logic') {
                const filtered = n.branches.filter((b) => b.variable !== name);
                return filtered.length === n.branches.length
                  ? n
                  : { ...n, branches: filtered };
              }
              return n;
            }),
          }));
        }}
      />

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
              variables={draft.variables ?? []}
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
        <Button size="sm" onClick={() => {
          // Backfill blank variable files with the default — saves the user
          // from typing the same path on every variable they add.
          const normalized: FlowDef = {
            ...draft,
            variables: (draft.variables ?? []).map((v) => ({
              ...v,
              file: v.file.trim() || DEFAULT_VAR_FILE,
            })),
          };
          onSave(normalized);
        }}>保存</Button>
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

/** Flow-level variables editor — inline list with add/remove/edit.
 *  Names enforced unique (UI badge on collision, save still allowed but
 *  backend validator will reject). Blank file → DEFAULT_VAR_FILE on save. */
function VariablesCard({
  variables,
  onChange,
  onDelete,
}: {
  variables: FlowVariable[];
  onChange: (next: FlowVariable[]) => void;
  /** Called when the user removes a variable. Parent uses this to scrub
   *  dangling references from nodes (initVariables / branch.variable). */
  onDelete: (name: string) => void;
}) {
  // Detect duplicate names so we can mark the offending row(s) inline
  const nameCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const v of variables) c.set(v.name, (c.get(v.name) ?? 0) + 1);
    return c;
  }, [variables]);

  const updateAt = (i: number, patch: Partial<FlowVariable>) => {
    onChange(variables.map((v, j) => (i === j ? { ...v, ...patch } : v)));
  };
  const remove = (i: number) => {
    const v = variables[i];
    if (v.name) {
      // Delegate to parent so references get cleaned in one transaction
      onDelete(v.name);
    } else {
      // Unnamed row — just drop it without traversing nodes
      onChange(variables.filter((_, j) => j !== i));
    }
  };
  const add = () => onChange([...variables, { name: '', file: DEFAULT_VAR_FILE, description: '' }]);

  return (
    <div className="flex-shrink-0 border border-border rounded-xl bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">变量</Label>
        <span className="text-xs text-muted-foreground">
          流级共享变量；LLM 节点可声明初始化、判断节点可按变量分支
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={add} className="h-7 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" /> 添加变量
        </Button>
      </div>
      {variables.length === 0 && (
        <p className="text-xs text-muted-foreground italic px-1">暂无变量。点"添加变量"创建。</p>
      )}
      {variables.map((v, i) => {
        const duplicate = !!v.name && (nameCounts.get(v.name) ?? 0) > 1;
        return (
          <div key={i} className="flex gap-1.5 items-center">
            <Input
              value={v.name}
              onChange={(e) => updateAt(i, { name: e.target.value.trim() })}
              placeholder="变量名"
              className={`w-32 h-8 font-mono text-xs ${duplicate ? 'border-destructive' : ''}`}
            />
            <Input
              value={v.file}
              onChange={(e) => updateAt(i, { file: e.target.value })}
              placeholder={DEFAULT_VAR_FILE}
              className="w-56 h-8 font-mono text-xs"
            />
            <Input
              value={v.description}
              onChange={(e) => updateAt(i, { description: e.target.value })}
              placeholder="含义（喂给 LLM 用于判断）"
              className="flex-1 h-8 text-xs"
            />
            {duplicate && (
              <span title="变量名重复" className="text-destructive flex items-center">
                <AlertTriangle className="h-4 w-4" />
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => remove(i)} className="h-8 w-8 p-0">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
