import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import type { NodeKind } from './types';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Existing node ids — used to suggest auto-wire predecessor. */
  allIds: number[];
  /** Predecessors with `next === null` (terminal-leaf) suitable for auto-wire.
   *  First entry is the default pick. */
  danglingPredecessors: number[];
  onCreate: (params: { name: string; kind: NodeKind; wireFrom: number | null }) => void;
}

const KIND_LABELS: Record<NodeKind, string> = {
  'user-input': '用户输入',
  'llm': 'LLM',
  'system-logic': '系统逻辑',
};

const KIND_HINTS: Record<NodeKind, string> = {
  'user-input': '弹框收集用户填写的字段，系统写入到输出文件',
  'llm': '把 prompt 模板（含 {{file:...}} 插值）通过 chat 注入 agent',
  'system-logic': '读 JSON 文件按字段值分支跳转，支持回边循环',
};

export function NodeCreationDialog({ open, onOpenChange, allIds, danglingPredecessors, onCreate }: Props) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<NodeKind>('llm');
  // Auto-wire default: first dangling predecessor if any, else null.
  const [wireFrom, setWireFrom] = useState<number | null>(
    danglingPredecessors[0] ?? null,
  );

  const handleSubmit = () => {
    const finalName = name.trim() || `新${KIND_LABELS[kind]}节点`;
    onCreate({ name: finalName, kind, wireFrom });
    // Reset and close
    setName('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>添加节点</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">节点名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`新${KIND_LABELS[kind]}节点`}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">类型</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as NodeKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['user-input', 'llm', 'system-logic'] as NodeKind[]).map((k) => (
                  <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground pt-0.5">{KIND_HINTS[kind]}</p>
          </div>

          {allIds.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                自动接到哪个节点之后？
                {danglingPredecessors[0] != null && (
                  <span className="ml-1 opacity-60">（默认接「#{danglingPredecessors[0]}」未连出口的尾节点）</span>
                )}
              </Label>
              <Select
                value={wireFrom == null ? 'none' : String(wireFrom)}
                onValueChange={(v) => setWireFrom(v === 'none' ? null : Number(v))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不自动连接（之后手动配 next）</SelectItem>
                  {allIds.map((id) => (
                    <SelectItem key={id} value={String(id)}>
                      接到 #{id} 之后
                      {danglingPredecessors.includes(id) && '（推荐）'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button size="sm" onClick={handleSubmit}>创建</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
