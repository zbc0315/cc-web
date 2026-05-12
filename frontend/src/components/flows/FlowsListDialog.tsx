import { useEffect, useState } from 'react';
import { Plus, Play, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ConfirmProvider';
import { uuidV4 } from '@/lib/uuid';
import {
  listFlows, getFlow, saveFlow, deleteFlow, runFlow,
  listGlobalFlows, getGlobalFlow, saveGlobalFlow, deleteGlobalFlow,
  type FlowSource,
} from './api';
import { FlowEditor } from './FlowEditor';
import type { FlowDef } from './types';

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function emptyFlow(name: string): FlowDef {
  return {
    id: uuidV4(),
    name,
    description: '',
    entryNodeId: 1,
    variables: [],
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
  const [source, setSource] = useState<FlowSource>('project');
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ filename: string; def: FlowDef; source: FlowSource } | null>(null);
  const [newName, setNewName] = useState('');

  const refresh = async (s: FlowSource = source) => {
    setLoading(true);
    try {
      const r = s === 'global' ? await listGlobalFlows() : await listFlows(projectId);
      setFiles(r.files);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, source]);

  // Reset newName when switching tabs so a name typed under project tab
  // doesn't carry over and accidentally create a global flow under that
  // unrelated name (codex P1-F).
  useEffect(() => {
    setNewName('');
  }, [source]);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) {
      toast.error('请输入流名称');
      return;
    }
    const filename = name.endsWith('.json') ? name : `${name}.json`;
    setEditing({ filename, def: emptyFlow(name.replace(/\.json$/, '')), source });
    setNewName('');
  };

  const handleEdit = async (filename: string) => {
    try {
      const def = source === 'global'
        ? await getGlobalFlow(filename)
        : await getFlow(projectId, filename);
      setEditing({ filename, def, source });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取失败');
    }
  };

  const handleSave = async (filename: string, def: FlowDef, editSource: FlowSource) => {
    try {
      if (editSource === 'global') {
        await saveGlobalFlow(filename, def);
      } else {
        await saveFlow(projectId, filename, def);
      }
      toast.success('已保存');
      setEditing(null);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const handleDelete = async (filename: string) => {
    const label = source === 'global' ? '全局任务流' : '任务流';
    const ok = await confirm({
      description: `删除${label} ${filename}？此操作不可恢复。`,
      confirmLabel: '删除',
      destructive: true,
    });
    if (!ok) return;
    try {
      if (source === 'global') await deleteGlobalFlow(filename);
      else await deleteFlow(projectId, filename);
      toast.success('已删除');
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleRun = async (filename: string) => {
    try {
      await runFlow(projectId, filename, source);
      toast.success('任务流已启动');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '启动失败');
    }
  };

  if (editing) {
    const titleSuffix = editing.source === 'global' ? '（全局）' : '';
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>编辑任务流{titleSuffix} · {editing.filename}</DialogTitle>
          </DialogHeader>
          <FlowEditor
            def={editing.def}
            onCancel={() => setEditing(null)}
            onSave={(d) => handleSave(editing.filename, d, editing.source)}
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

        <Tabs value={source} onValueChange={(v) => setSource(v as FlowSource)}>
          <TabsList>
            <TabsTrigger value="project">项目流</TabsTrigger>
            <TabsTrigger value="global">我的全局流</TabsTrigger>
          </TabsList>
        </Tabs>

        {source === 'global' && (
          <p className="text-xs text-muted-foreground">
            全局流是可复用的模板，运行时仍绑定到当前项目（PTY 与文件路径来自该项目）。
          </p>
        )}

        <div className="flex gap-2 items-center">
          <Input
            placeholder={source === 'global' ? '新全局流名称' : '新流名称（例：research）'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            className="flex-1"
          />
          <Button onClick={handleCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> 新建
          </Button>
          <Button onClick={() => refresh()} size="sm" variant="ghost" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="space-y-1 max-h-[55vh] overflow-y-auto">
          {files.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {source === 'global' ? '暂无全局任务流。新建一个开始。' : '暂无任务流。新建一个开始。'}
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
