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
import {
  SCHEMA_VERSION,
  type FlowConstant,
  type FlowDef,
  type FlowNode,
  type FlowVariable,
  type NodeKind,
} from './types';

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
      next: null,
    };
  }
  if (kind === 'llm') {
    return {
      id, name, kind: 'llm',
      promptTemplate: '',
      timeoutSec: 600,
      next: null,
    };
  }
  return {
    id, name, kind: 'system-logic',
    branches: [],
    maxRetries: 3,
    defaultGoto: null,
  };
}

/** Node ids whose `next` (or defaultGoto for system-logic) is currently null
 *  — these are candidate predecessors to auto-wire a new node onto. */
function findDanglingPredecessors(nodes: FlowNode[]): number[] {
  return nodes
    .filter((n) => {
      if (n.kind === 'user-input' || n.kind === 'llm') return n.next === null;
      return n.defaultGoto == null && n.branches.length === 0;
    })
    .map((n) => n.id);
}

export function FlowEditor({ def, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState<FlowDef>(() => ({
    ...def,
    schemaVersion: SCHEMA_VERSION, // ensure version stamp on load (migrators bump here)
  }));
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
      nodes = nodes.map((n) => {
        if (n.id !== wireFrom) return n;
        if (n.kind === 'user-input' || n.kind === 'llm') return { ...n, next: nextId };
        return { ...n, defaultGoto: nextId };
      });
    }
    setDraft({ ...draft, nodes });
    setTimeout(() => {
      nodeRefs.current[nextId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const handleChipClick = (id: number) => {
    nodeRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /** Remove dangling references to a variable/constant after a deletion.
   *  Scrubs node fields so the backend validator doesn't reject the save with
   *  a generic message. */
  const scrubReferences = (name: string, kind: 'variable' | 'constant') => {
    setDraft((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.kind === 'user-input') {
          return {
            ...n,
            userInputSchema: {
              fields: n.userInputSchema.fields.map((f) => {
                if (kind === 'variable' && (f.outputVariable === name || f.bindVariable === name)) {
                  const { outputVariable: _o, bindVariable: _b, ...rest } = f;
                  return rest;
                }
                if (kind === 'constant' && f.bindConstant === name) {
                  const { bindConstant: _c, ...rest } = f;
                  return rest;
                }
                return f;
              }),
            },
          };
        }
        if (n.kind === 'llm') {
          const next = { ...n };
          if (kind === 'variable') {
            if (next.readVariables) next.readVariables = next.readVariables.filter((v) => v !== name);
            if (next.writeVariables) next.writeVariables = next.writeVariables.filter((v) => v !== name);
          } else {
            if (next.readConstants) next.readConstants = next.readConstants.filter((c) => c !== name);
          }
          return next;
        }
        if (n.kind === 'system-logic') {
          return {
            ...n,
            branches: n.branches.filter((b) => {
              if (kind === 'variable') return b.variable !== name;
              return b.constant !== name;
            }),
          };
        }
        return n;
      }),
    }));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-3">
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

      <ConstantsCard
        constants={draft.constants ?? []}
        onChange={(constants) => setDraft({ ...draft, constants })}
        onDelete={(name) => {
          setDraft((prev) => ({
            ...prev,
            constants: (prev.constants ?? []).filter((c) => c.name !== name),
          }));
          scrubReferences(name, 'constant');
        }}
      />

      <VariablesCard
        variables={draft.variables ?? []}
        constants={draft.constants ?? []}
        onChange={(variables) => setDraft({ ...draft, variables })}
        onDelete={(name) => {
          setDraft((prev) => ({
            ...prev,
            variables: (prev.variables ?? []).filter((v) => v.name !== name),
          }));
          scrubReferences(name, 'variable');
        }}
      />

      <div className="flex-shrink-0 border border-border rounded-xl bg-muted/30">
        <FlowNodeChain
          nodes={draft.nodes}
          entryNodeId={draft.entryNodeId}
          mode="editor"
          onNodeClick={handleChipClick}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
        {draft.nodes.map((n) => (
          <div key={n.id} ref={(el) => { nodeRefs.current[n.id] = el; }}>
            <NodeCard
              node={n}
              allIds={allIds}
              variables={draft.variables ?? []}
              constants={draft.constants ?? []}
              onChange={(next) => updateNode(n.id, next)}
              onDelete={() => deleteNode(n.id)}
            />
          </div>
        ))}
      </div>

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

// ── Constants card ────────────────────────────────────────────────────────

/** Flow-level constants editor. value is an arbitrary JSON literal — we keep
 *  the user's raw text in local state and parse on blur so partial input
 *  (e.g. typing `[1,` mid-edit) doesn't get rejected. Invalid JSON shows an
 *  inline warning but saves the raw string anyway; backend validator gates
 *  on JSON.stringify being able to round-trip. */
function ConstantsCard({
  constants,
  onChange,
  onDelete,
}: {
  constants: FlowConstant[];
  onChange: (next: FlowConstant[]) => void;
  onDelete: (name: string) => void;
}) {
  const nameCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const v of constants) c.set(v.name, (c.get(v.name) ?? 0) + 1);
    return c;
  }, [constants]);

  const updateAt = (i: number, patch: Partial<FlowConstant>) => {
    onChange(constants.map((v, j) => (i === j ? { ...v, ...patch } : v)));
  };
  const add = () => onChange([...constants, { name: '', value: '', description: '' }]);
  const remove = (i: number) => {
    const c = constants[i];
    if (c.name) onDelete(c.name);
    else onChange(constants.filter((_, j) => j !== i));
  };

  return (
    <div className="flex-shrink-0 border border-border rounded-xl bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">常量</Label>
        <span className="text-xs text-muted-foreground">
          流定义时固定，运行时不可写。任意 JSON（字符串/数字/布尔/数组/对象）
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={add} className="h-7 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" /> 添加常量
        </Button>
      </div>
      {constants.length === 0 && (
        <p className="text-xs text-muted-foreground italic px-1">暂无常量。</p>
      )}
      {constants.map((c, i) => {
        const duplicate = !!c.name && (nameCounts.get(c.name) ?? 0) > 1;
        return (
          <JsonValueRow
            key={i}
            name={c.name}
            value={c.value}
            description={c.description ?? ''}
            duplicate={duplicate}
            onChangeName={(name) => updateAt(i, { name: name.trim() })}
            onChangeValue={(value) => updateAt(i, { value })}
            onChangeDescription={(description) => updateAt(i, { description })}
            onRemove={() => remove(i)}
          />
        );
      })}
    </div>
  );
}

// ── Variables card ────────────────────────────────────────────────────────

/** Flow-level mutable variables. Same shape as constants but with description
 *  required (LLM reads it) and value treated as `initialValue` (optional). */
function VariablesCard({
  variables,
  constants,
  onChange,
  onDelete,
}: {
  variables: FlowVariable[];
  constants: FlowConstant[];
  onChange: (next: FlowVariable[]) => void;
  onDelete: (name: string) => void;
}) {
  const declaredNames = useMemo(() => {
    const c = new Map<string, number>();
    for (const v of variables) c.set(v.name, (c.get(v.name) ?? 0) + 1);
    return c;
  }, [variables]);
  const constNames = useMemo(() => new Set(constants.map((c) => c.name)), [constants]);

  const updateAt = (i: number, patch: Partial<FlowVariable>) => {
    onChange(variables.map((v, j) => (i === j ? { ...v, ...patch } : v)));
  };
  const add = () => onChange([...variables, { name: '', description: '', initialValue: undefined }]);
  const remove = (i: number) => {
    const v = variables[i];
    if (v.name) onDelete(v.name);
    else onChange(variables.filter((_, j) => j !== i));
  };

  return (
    <div className="flex-shrink-0 border border-border rounded-xl bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">变量</Label>
        <span className="text-xs text-muted-foreground">
          运行时可写。user-input 字段或 LLM 节点产出；任意 JSON
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={add} className="h-7 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" /> 添加变量
        </Button>
      </div>
      {variables.length === 0 && (
        <p className="text-xs text-muted-foreground italic px-1">暂无变量。</p>
      )}
      {variables.map((v, i) => {
        const duplicate = (!!v.name && (declaredNames.get(v.name) ?? 0) > 1) || constNames.has(v.name);
        return (
          <JsonValueRow
            key={i}
            name={v.name}
            value={v.initialValue}
            description={v.description}
            duplicate={duplicate}
            valuePlaceholder='初始值（可选，留空 = undefined）'
            onChangeName={(name) => updateAt(i, { name: name.trim() })}
            onChangeValue={(initialValue) => updateAt(i, { initialValue })}
            onChangeDescription={(description) => updateAt(i, { description })}
            onRemove={() => remove(i)}
          />
        );
      })}
    </div>
  );
}

// ── Shared row component for constants + variables ────────────────────────

function JsonValueRow({
  name,
  value,
  description,
  duplicate,
  valuePlaceholder,
  onChangeName,
  onChangeValue,
  onChangeDescription,
  onRemove,
}: {
  name: string;
  value: unknown;
  description: string;
  duplicate: boolean;
  valuePlaceholder?: string;
  onChangeName: (n: string) => void;
  onChangeValue: (v: unknown) => void;
  onChangeDescription: (d: string) => void;
  onRemove: () => void;
}) {
  // Local text state so partial JSON during typing doesn't get nuked. Parse
  // on blur; on parse failure, fall back to string literal so the user's
  // text isn't lost.
  const [text, setText] = useState<string>(() =>
    value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  );
  const [parseError, setParseError] = useState(false);

  const commitValue = () => {
    if (text.trim() === '') {
      onChangeValue(undefined);
      setParseError(false);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      onChangeValue(parsed);
      setParseError(false);
    } catch {
      // Fallback: treat as string literal so users don't need to wrap simple
      // strings in quotes manually.
      onChangeValue(text);
      setParseError(true);
    }
  };

  return (
    <div className="space-y-1.5 rounded-md border border-border/60 p-2">
      <div className="flex gap-1.5 items-start">
        <div className="flex flex-col gap-1.5 w-32">
          <Input
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="名字"
            className={`h-8 font-mono text-xs ${duplicate ? 'border-destructive' : ''}`}
          />
          {duplicate && (
            <span title="名字冲突（与常量/变量重名）" className="text-destructive flex items-center text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />重名
            </span>
          )}
        </div>
        <div className="flex-1 space-y-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitValue}
            placeholder={valuePlaceholder ?? 'JSON 值（如 10, "hi", [1,2], {"k":"v"}）'}
            className="w-full min-h-[32px] rounded-md border border-border bg-background px-2 py-1 text-xs font-mono resize-y outline-none focus:ring-2 focus:ring-ring/30"
            rows={1}
          />
          {parseError && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              非合法 JSON — 已按字符串字面量保存
            </span>
          )}
        </div>
        <Input
          value={description}
          onChange={(e) => onChangeDescription(e.target.value)}
          placeholder="含义（LLM 引用时使用）"
          className="flex-1 h-8 text-xs"
        />
        <Button size="sm" variant="ghost" onClick={onRemove} className="h-8 w-8 p-0">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
