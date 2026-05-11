import { Trash2, X, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  FlowNode,
  UserInputNode,
  LlmNode,
  SystemLogicNode,
  FileRef,
  BranchRule,
  UserInputField,
  FileProvider,
} from './types';

interface Props {
  node: FlowNode;
  allIds: number[];
  onChange: (next: FlowNode) => void;
  onDelete: () => void;
}

const providerOptions: FileProvider[] = ['user', 'llm', 'system'];

export function NodeCard({ node, allIds, onChange, onDelete }: Props) {
  return (
    <div className="border border-border rounded-xl p-4 space-y-3 bg-card">
      <div className="flex items-center gap-2">
        <div className="text-xs font-mono px-2 py-0.5 rounded bg-muted">#{node.id}</div>
        <Input
          value={node.name}
          onChange={(e) => onChange({ ...node, name: e.target.value })}
          className="flex-1 h-8"
          placeholder="节点名称"
        />
        <div className="text-xs px-2 py-0.5 rounded bg-accent">{kindLabel(node.kind)}</div>
        <Button size="sm" variant="ghost" onClick={onDelete} title="删除节点">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {node.kind === 'user-input' && (
        <UserInputBody node={node} allIds={allIds} onChange={onChange} />
      )}
      {node.kind === 'llm' && <LlmBody node={node} allIds={allIds} onChange={onChange} />}
      {node.kind === 'system-logic' && (
        <SystemLogicBody node={node} allIds={allIds} onChange={onChange} />
      )}
    </div>
  );
}

function kindLabel(k: string): string {
  if (k === 'user-input') return '用户输入';
  if (k === 'llm') return 'LLM';
  return '系统逻辑';
}

// ── Shared editors ───────────────────────────────────────────────────────

function FileRefList({
  label,
  refs,
  onChange,
  hint,
}: {
  label: string;
  refs: FileRef[];
  onChange: (refs: FileRef[]) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label} {hint && <span className="opacity-60">· {hint}</span>}</Label>
      {refs.map((r, i) => (
        <div key={i} className="flex gap-1.5">
          <Input
            value={r.path}
            onChange={(e) => {
              const next = [...refs];
              next[i] = { ...r, path: e.target.value };
              onChange(next);
            }}
            placeholder="相对路径，如 init.json"
            className="flex-1 h-8 font-mono text-xs"
          />
          <Select
            value={r.provider}
            onValueChange={(v) => {
              const next = [...refs];
              next[i] = { ...r, provider: v as FileProvider };
              onChange(next);
            }}
          >
            <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {providerOptions.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={() => onChange(refs.filter((_, j) => j !== i))}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onChange([...refs, { path: '', provider: 'llm' }])}
        className="h-7 text-xs"
      >
        <Plus className="h-3.5 w-3.5 mr-1" /> 添加文件
      </Button>
    </div>
  );
}

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
  onChange: (v: number | null) => void;
  label?: string;
}) {
  const sentinel = value === null ? 'end' : String(value);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={sentinel}
        onValueChange={(v) => onChange(v === 'end' ? null : Number(v))}
      >
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="end">（终止）</SelectItem>
          {allIds.filter((id) => id !== selfId).map((id) => (
            <SelectItem key={id} value={String(id)}>#{id}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Per-kind bodies ──────────────────────────────────────────────────────

function UserInputBody({
  node,
  allIds,
  onChange,
}: {
  node: UserInputNode;
  allIds: number[];
  onChange: (n: FlowNode) => void;
}) {
  const updateFields = (fields: UserInputField[]) => onChange({ ...node, userInputSchema: { fields } });
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">表单字段</Label>
        {node.userInputSchema.fields.map((f, i) => (
          <div key={i} className="flex gap-1.5">
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
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => updateFields([...node.userInputSchema.fields, { key: '', label: '', type: 'text' }])}
          className="h-7 text-xs"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> 添加字段
        </Button>
      </div>

      <FileRefList
        label="输出文件"
        refs={node.outputs}
        onChange={(outputs) => onChange({ ...node, outputs })}
        hint="provider 通常选 system"
      />

      <NextNodeSelect
        value={node.next}
        allIds={allIds}
        selfId={node.id}
        onChange={(next) => onChange({ ...node, next })}
      />
    </div>
  );
}

function LlmBody({
  node,
  allIds,
  onChange,
}: {
  node: LlmNode;
  allIds: number[];
  onChange: (n: FlowNode) => void;
}) {
  return (
    <div className="space-y-3">
      <FileRefList
        label="输入文件"
        refs={node.inputs}
        onChange={(inputs) => onChange({ ...node, inputs })}
        hint="provider 区分错误回流到 用户 / LLM"
      />

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          Prompt 模板 · 支持 {'{{file:相对路径}}'} 插值
        </Label>
        <textarea
          value={node.promptTemplate}
          onChange={(e) => onChange({ ...node, promptTemplate: e.target.value })}
          className="w-full min-h-[120px] rounded-md border border-border bg-background px-3 py-2 text-xs font-mono resize-y outline-none focus:ring-2 focus:ring-ring/30"
          placeholder={`例：
根据下面项目初始化内容生成 10 个学术检索关键词：
{{file:init.json}}
请把结果写到 keywords.json，并把关键词合并到 init.json 的 keywords 字段。`}
        />
      </div>

      <FileRefList
        label="输出文件（声明性）"
        refs={node.outputs}
        onChange={(outputs) => onChange({ ...node, outputs })}
        hint="LLM 实际写盘；这里只标记 provider 给下游判错"
      />

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

function SystemLogicBody({
  node,
  allIds,
  onChange,
}: {
  node: SystemLogicNode;
  allIds: number[];
  onChange: (n: FlowNode) => void;
}) {
  const updateBranches = (branches: BranchRule[]) => onChange({ ...node, branches });
  return (
    <div className="space-y-3">
      <FileRefList
        label="输入文件 · 第一个文件用于解析"
        refs={node.inputs}
        onChange={(inputs) => onChange({ ...node, inputs })}
      />

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">分支规则 · 顺序匹配第一条命中</Label>
        {node.branches.map((b, i) => (
          <div key={i} className="flex gap-1.5">
            <Input
              value={b.field}
              onChange={(e) => {
                const next = [...node.branches];
                next[i] = { ...b, field: e.target.value };
                updateBranches(next);
              }}
              placeholder="JSON 字段"
              className="w-32 h-8 font-mono text-xs"
            />
            <Input
              value={String(b.equals ?? '')}
              onChange={(e) => {
                const next = [...node.branches];
                next[i] = { ...b, equals: parseEqualsValue(e.target.value) };
                updateBranches(next);
              }}
              placeholder="== 值（true/false/数字/字串）"
              className="flex-1 h-8 font-mono text-xs"
            />
            <Select
              value={String(b.goto)}
              onValueChange={(v) => {
                const next = [...node.branches];
                next[i] = { ...b, goto: Number(v) };
                updateBranches(next);
              }}
            >
              <SelectTrigger className="w-20 h-8 text-xs"><SelectValue placeholder="→" /></SelectTrigger>
              <SelectContent>
                {allIds.map((id) => (
                  <SelectItem key={id} value={String(id)}>→ #{id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" onClick={() => updateBranches(node.branches.filter((_, j) => j !== i))}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => updateBranches([...node.branches, { field: '', equals: true, goto: allIds[0] ?? 1 }])}
          className="h-7 text-xs"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> 添加分支
        </Button>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">maxRetries（回边上限）</Label>
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
            onChange={(v) => onChange({ ...node, defaultGoto: v })}
            label="默认分支（无命中时）"
          />
        </div>
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function parseEqualsValue(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}
