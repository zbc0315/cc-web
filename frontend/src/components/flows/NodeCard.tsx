import { Plus, X, Trash2 } from 'lucide-react';
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
import type {
  BranchRule,
  FlowConstant,
  FlowNode,
  FlowVariable,
  LlmNode,
  SystemLogicNode,
  UserInputField,
  UserInputNode,
} from './types';

interface Props {
  node: FlowNode;
  allIds: number[];
  /** Flow-level mutable variables — used by every node body for variable
   *  pickers (output/bind/read/write/branch). */
  variables: FlowVariable[];
  /** Flow-level immutable constants — used by user-input bindConstant and
   *  LLM readConstants and system-logic constant branches. */
  constants: FlowConstant[];
  onChange: (n: FlowNode) => void;
  onDelete: () => void;
}

export function NodeCard({ node, allIds, variables, constants, onChange, onDelete }: Props) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground">#{node.id}</span>
        <Input
          value={node.name}
          onChange={(e) => onChange({ ...node, name: e.target.value })}
          className="h-8 flex-1"
          placeholder="节点名称"
        />
        <div className="text-xs px-2 py-0.5 rounded bg-accent">{kindLabel(node.kind)}</div>
        <Button size="sm" variant="ghost" onClick={onDelete} title="删除节点">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {node.kind === 'user-input' && (
        <UserInputBody node={node} allIds={allIds} variables={variables} constants={constants} onChange={onChange} />
      )}
      {node.kind === 'llm' && (
        <LlmBody node={node} allIds={allIds} variables={variables} constants={constants} onChange={onChange} />
      )}
      {node.kind === 'system-logic' && (
        <SystemLogicBody node={node} allIds={allIds} variables={variables} constants={constants} onChange={onChange} />
      )}
    </div>
  );
}

function kindLabel(k: string): string {
  if (k === 'user-input') return '用户输入';
  if (k === 'llm') return 'LLM';
  return '系统逻辑';
}

// ── Shared widget: pick next-node id (or null = terminal) ─────────────────

function NextNodeSelect({
  value,
  allIds,
  selfId,
  onChange,
  label = '下一节点',
}: {
  value: number | null;
  allIds: number[];
  selfId: number;
  onChange: (next: number | null) => void;
  label?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={value === null ? '__null' : String(value)}
        onValueChange={(v) => onChange(v === '__null' ? null : Number(v))}
      >
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__null">— 结束 —</SelectItem>
          {allIds.filter((id) => id !== selfId).map((id) => (
            <SelectItem key={id} value={String(id)}>#{id}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── User-input body ──────────────────────────────────────────────────────

function UserInputBody({
  node,
  allIds,
  variables,
  constants,
  onChange,
}: {
  node: UserInputNode;
  allIds: number[];
  variables: FlowVariable[];
  constants: FlowConstant[];
  onChange: (n: FlowNode) => void;
}) {
  const updateFields = (fields: UserInputField[]) => onChange({ ...node, userInputSchema: { fields } });

  // Three-mode field binding — at most one of outputVariable / bindVariable /
  // bindConstant may be set per field (server enforces XOR).
  const fieldMode = (f: UserInputField): 'none' | 'out' | 'bindVar' | 'bindConst' => {
    if (f.outputVariable) return 'out';
    if (f.bindVariable) return 'bindVar';
    if (f.bindConstant) return 'bindConst';
    return 'none';
  };
  const setFieldBinding = (
    i: number,
    mode: 'none' | 'out' | 'bindVar' | 'bindConst',
    name: string | null,
  ) => {
    const next = [...node.userInputSchema.fields];
    const f = { ...next[i] };
    delete f.outputVariable;
    delete f.bindVariable;
    delete f.bindConstant;
    if (mode === 'out' && name) f.outputVariable = name;
    else if (mode === 'bindVar' && name) f.bindVariable = name;
    else if (mode === 'bindConst' && name) f.bindConstant = name;
    next[i] = f;
    updateFields(next);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">表单字段</Label>
        {node.userInputSchema.fields.map((f, i) => {
          const mode = fieldMode(f);
          const boundName = f.outputVariable ?? f.bindVariable ?? f.bindConstant ?? '';
          const pickerList = (mode === 'bindConst' ? constants : variables).filter((x) => !!x.name);
          return (
            <div key={i} className="space-y-1.5 rounded-md border border-border/60 p-2">
              <div className="flex gap-1.5">
                <Input
                  value={f.key}
                  onChange={(e) => {
                    const next = [...node.userInputSchema.fields];
                    next[i] = { ...f, key: e.target.value };
                    updateFields(next);
                  }}
                  placeholder="key"
                  className="w-32 h-8 font-mono text-xs"
                />
                <Input
                  value={f.label}
                  onChange={(e) => {
                    const next = [...node.userInputSchema.fields];
                    next[i] = { ...f, label: e.target.value };
                    updateFields(next);
                  }}
                  placeholder="显示标签"
                  className="flex-1 h-8 text-xs"
                />
                <Select
                  value={f.type}
                  onValueChange={(v) => {
                    const next = [...node.userInputSchema.fields];
                    next[i] = { ...f, type: v as 'text' | 'textarea' };
                    updateFields(next);
                  }}
                >
                  <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">单行</SelectItem>
                    <SelectItem value="textarea">多行</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" onClick={() => updateFields(node.userInputSchema.fields.filter((_, j) => j !== i))}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              {(variables.length > 0 || constants.length > 0) && (
                <div className="flex gap-1.5 items-center">
                  <span className="text-[11px] text-muted-foreground">绑定</span>
                  <Select
                    value={mode}
                    onValueChange={(v) => {
                      const newMode = v as 'none' | 'out' | 'bindVar' | 'bindConst';
                      const defaultName = newMode === 'bindConst'
                        ? (constants[0]?.name ?? null)
                        : (variables[0]?.name ?? null);
                      setFieldBinding(i, newMode, boundName || defaultName);
                    }}
                  >
                    <SelectTrigger className="w-40 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">无绑定</SelectItem>
                      <SelectItem value="out" disabled={variables.length === 0}>输出到变量</SelectItem>
                      <SelectItem value="bindVar" disabled={variables.length === 0}>显示变量（只读）</SelectItem>
                      <SelectItem value="bindConst" disabled={constants.length === 0}>显示常量（只读）</SelectItem>
                    </SelectContent>
                  </Select>
                  {mode !== 'none' && (
                    <Select
                      value={boundName}
                      onValueChange={(v) => setFieldBinding(i, mode, v)}
                    >
                      <SelectTrigger className="flex-1 h-7 text-xs"><SelectValue placeholder="选择名字" /></SelectTrigger>
                      <SelectContent>
                        {pickerList.map((item) => (
                          <SelectItem key={item.name} value={item.name}>
                            <span className="font-mono">{item.name}</span>
                            <span className="opacity-60 ml-2">{item.description || '(无描述)'}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => updateFields([...node.userInputSchema.fields, { key: '', label: '', type: 'text' }])}
          className="h-7 text-xs"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> 添加字段
        </Button>
      </div>

      <NextNodeSelect
        value={node.next}
        allIds={allIds}
        selfId={node.id}
        onChange={(next) => onChange({ ...node, next })}
      />
    </div>
  );
}

// ── LLM body ─────────────────────────────────────────────────────────────

function LlmBody({
  node,
  allIds,
  variables,
  constants,
  onChange,
}: {
  node: LlmNode;
  allIds: number[];
  variables: FlowVariable[];
  constants: FlowConstant[];
  onChange: (n: FlowNode) => void;
}) {
  const readVars = node.readVariables ?? [];
  const writeVars = node.writeVariables ?? [];
  const readConsts = node.readConstants ?? [];
  const toggle = (key: 'readVariables' | 'writeVariables' | 'readConstants', name: string) => {
    const current = (node[key] ?? []) as string[];
    const has = current.includes(name);
    const next = has ? current.filter((n) => n !== name) : [...current, name];
    onChange({ ...node, [key]: next });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          Prompt 模板 · 插值 <span className="font-mono">{'{{var:name}}'}</span> 或 <span className="font-mono">{'{{const:name}}'}</span>
        </Label>
        <textarea
          value={node.promptTemplate}
          onChange={(e) => onChange({ ...node, promptTemplate: e.target.value })}
          className="w-full min-h-[120px] rounded-md border border-border bg-background px-3 py-2 text-xs font-mono resize-y outline-none focus:ring-2 focus:ring-ring/30"
          placeholder={`例：
根据目标 {{var:goal}} 提取 {{const:max_keywords}} 个关键词，
写入 .ccweb/workflow_data.json 的 variables.keywords 字段。`}
        />
      </div>

      {constants.length > 0 && (
        <VariableChipGroup
          label="读取常量 · prompt 头部附常量值上下文"
          items={constants}
          selected={readConsts}
          onToggle={(name) => toggle('readConstants', name)}
          accent="green"
        />
      )}

      {variables.length > 0 && (
        <>
          <VariableChipGroup
            label="读取变量 · prompt 头部附变量当前值"
            items={variables}
            selected={readVars}
            onToggle={(name) => toggle('readVariables', name)}
            accent="blue"
          />
          <VariableChipGroup
            label="写入变量 · prompt 末尾附 LLM 写盘指令"
            items={variables}
            selected={writeVars}
            onToggle={(name) => toggle('writeVariables', name)}
            accent="primary"
          />
        </>
      )}

      <div className="flex gap-3">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">超时秒数</Label>
          <Input
            type="number"
            min={1}
            value={node.timeoutSec}
            onChange={(e) => onChange({ ...node, timeoutSec: Math.max(1, Number(e.target.value) || 1) })}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex-1">
          <NextNodeSelect
            value={node.next}
            allIds={allIds}
            selfId={node.id}
            onChange={(next) => onChange({ ...node, next })}
          />
        </div>
      </div>
    </div>
  );
}

/** Generic chip toggle group — used by LLM body for the three variable/constant
 *  selection categories. Three accent colors visually distinguish read-const
 *  (绿) vs read-var (蓝) vs write-var (主题色) at a glance. */
function VariableChipGroup({
  label,
  items,
  selected,
  onToggle,
  accent,
}: {
  label: string;
  items: Array<{ name: string; description?: string }>;
  selected: string[];
  onToggle: (name: string) => void;
  accent: 'green' | 'blue' | 'primary';
}) {
  const palette = {
    green: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
    blue: 'bg-blue-500/15 border-blue-500/40 text-blue-600 dark:text-blue-400',
    primary: 'bg-primary/15 border-primary/40 text-primary',
  }[accent];
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const checked = selected.includes(item.name);
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => onToggle(item.name)}
              className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                checked ? palette : 'bg-muted/30 border-border text-muted-foreground hover:text-foreground'
              }`}
              title={item.description || '(无描述)'}
            >
              <span className="font-mono">{item.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── System-logic body ────────────────────────────────────────────────────

function SystemLogicBody({
  node,
  allIds,
  variables,
  constants,
  onChange,
}: {
  node: SystemLogicNode;
  allIds: number[];
  variables: FlowVariable[];
  constants: FlowConstant[];
  onChange: (n: FlowNode) => void;
}) {
  const updateBranches = (branches: BranchRule[]) => onChange({ ...node, branches });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">分支规则 · 按顺序匹配，先命中先生效</Label>
        {node.branches.map((b, i) => {
          const isConstMode = !!b.constant;
          const boundName = b.constant ?? b.variable ?? '';
          const pickerList = (isConstMode ? constants : variables).filter((x) => !!x.name);
          return (
            <div key={i} className="flex gap-1.5 items-center">
              <Select
                value={isConstMode ? 'const' : 'var'}
                onValueChange={(v) => {
                  const next = [...node.branches];
                  if (v === 'const') {
                    next[i] = { constant: constants[0]?.name ?? '', equals: b.equals, goto: b.goto };
                  } else {
                    next[i] = { variable: variables[0]?.name ?? '', equals: b.equals, goto: b.goto };
                  }
                  updateBranches(next);
                }}
              >
                <SelectTrigger className="w-20 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="var" disabled={variables.length === 0}>变量</SelectItem>
                  <SelectItem value="const" disabled={constants.length === 0}>常量</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={boundName}
                onValueChange={(v) => {
                  const next = [...node.branches];
                  next[i] = isConstMode
                    ? { constant: v, equals: b.equals, goto: b.goto }
                    : { variable: v, equals: b.equals, goto: b.goto };
                  updateBranches(next);
                }}
              >
                <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="名字" /></SelectTrigger>
                <SelectContent>
                  {pickerList.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      <span className="font-mono">{p.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">==</span>
              <Input
                value={typeof b.equals === 'string' ? b.equals : JSON.stringify(b.equals)}
                onChange={(e) => {
                  const next = [...node.branches];
                  let parsed: unknown = e.target.value;
                  try { parsed = JSON.parse(e.target.value); } catch { /* keep string */ }
                  next[i] = { ...b, equals: parsed };
                  updateBranches(next);
                }}
                placeholder='值（如 true, 10, "yes"）'
                className="w-32 h-8 font-mono text-xs"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Select
                value={String(b.goto)}
                onValueChange={(v) => {
                  const next = [...node.branches];
                  next[i] = { ...b, goto: Number(v) };
                  updateBranches(next);
                }}
              >
                <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allIds.map((id) => (
                    <SelectItem key={id} value={String(id)}>#{id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" onClick={() => updateBranches(node.branches.filter((_, j) => j !== i))}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const hasVars = variables.length > 0;
            const newBranch: BranchRule = hasVars
              ? { variable: variables[0].name, equals: true, goto: node.id }
              : { constant: constants[0]?.name ?? '', equals: true, goto: node.id };
            updateBranches([...node.branches, newBranch]);
          }}
          className="h-7 text-xs"
          disabled={variables.length === 0 && constants.length === 0}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> 添加分支
        </Button>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">回边上限</Label>
          <Input
            type="number"
            min={0}
            value={node.maxRetries}
            onChange={(e) => onChange({ ...node, maxRetries: Math.max(0, Number(e.target.value) || 0) })}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex-1">
          <NextNodeSelect
            value={node.defaultGoto ?? null}
            allIds={allIds}
            selfId={node.id}
            onChange={(next) => onChange({ ...node, defaultGoto: next })}
            label="默认 (无分支命中)"
          />
        </div>
      </div>
    </div>
  );
}
