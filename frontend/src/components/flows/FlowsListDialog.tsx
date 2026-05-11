import { useEffect, useState } from 'react';
import { Plus, Play, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ConfirmProvider';
import { listFlows, getFlow, saveFlow, deleteFlow, runFlow } from './api';
import { FlowEditor } from './FlowEditor';
import type { FlowDef } from './types';

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function emptyFlow(name: string): FlowDef {
  return {
    id: crypto.randomUUID(),
    name,
    description: '',
    entryNodeId: 1,
    nodes: [
      {
        id: 1,
        name: '初始化',
        kind: 'user-input',
        userInputSchema: { fields: [{ key: 'goal', label: '研究目标', type: 'text' }] },
        outputs: [{ path: 'init.json', provider: 'system' }],
        next: null,
      },
    ],
  };
}

export function FlowsListDialog({ projectId, open, onOpenChange }: Props) {
  const confirm = useConfirm();
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ filename: string; def: FlowDef } | null>(null);
  const [newName, setNewName] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await listFlows(projectId);
      setFiles(r.files);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) {
      toast.error('请输入流名称');
      return;
    }
    const filename = name.endsWith('.json') ? name : `${name}.json`;
    setEditing({ filename, def: emptyFlow(name.replace(/\.json$/, '')) });
    setNewName('');
  };

  const handleEdit = async (filename: string) => {
    try {
      const def = await getFlow(projectId, filename);
      setEditing({ filename, def });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取失败');
    }
  };

  const handleSave = async (filename: string, def: FlowDef) => {
    try {
      await saveFlow(projectId, filename, def);
      toast.success('已保存');
      setEditing(null);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const handleDelete = async (filename: string) => {
    const ok = await confirm({
      description: `删除任务流 ${filename}？此操作不可恢复。`,
      confirmLabel: '删除',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFlow(projectId, filename);
      toast.success('已删除');
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleRun = async (filename: string) => {
    try {
      await runFlow(projectId, filename);
      toast.success('任务流已启动');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '启动失败');
    }
  };

  if (editing) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>编辑任务流 · {editing.filename}</DialogTitle>
          </DialogHeader>
          <FlowEditor
            def={editing.def}
            onCancel={() => setEditing(null)}
            onSave={(d) => handleSave(editing.filename, d)}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">任务流</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 items-center">
          <Input
            placeholder="新流名称（例：research）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            className="flex-1"
          />
          <Button onClick={handleCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> 新建
          </Button>
          <Button onClick={refresh} size="sm" variant="ghost" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="space-y-1 max-h-[55vh] overflow-y-auto">
          {files.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              暂无任务流。新建一个开始。
            </p>
          )}
          {files.map((f) => (
            <div
              key={f}
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:bg-accent transition-colors"
            >
              <span className="flex-1 text-sm font-mono truncate" title={f}>{f}</span>
              <Button size="sm" variant="ghost" onClick={() => handleRun(f)} title="运行">
                <Play className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleEdit(f)} title="编辑">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleDelete(f)} title="删除">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
