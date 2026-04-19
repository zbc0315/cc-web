import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  AgentPromptWithState,
  createGlobalPrompt, createProjectPrompt,
  updateGlobalPrompt, updateProjectPrompt,
  deleteGlobalPrompt, deleteProjectPrompt,
  getProjectPrompts,
  togglePromptInClaudeMd,
} from '@/lib/api';
import { AgentPromptDialog } from './AgentPromptDialog';
import { useConfirm } from './ConfirmProvider';
import { PromptCard } from './PromptCard';
import { SharePromptDialog } from './SharePromptDialog';

type Scope = 'global' | 'project';

interface AgentPromptsPanelProps {
  projectId: string;
}

/**
 * Agent Prompts panel — layout mirrors Quick Prompts / Memory Prompts:
 *   header ("AGENT PROMPTS" + one-line description)
 *   ├── Section "项目" (top) with its own `+` button
 *   └── Section "全局" (bottom) with its own `+` button
 *
 * Cards toggle insertion into CLAUDE.md; a green dot on the card shows
 * current insert state.
 */
export function AgentPromptsPanel({ projectId }: AgentPromptsPanelProps) {
  const confirm = useConfirm();
  const [globalPrompts, setGlobalPrompts] = useState<AgentPromptWithState[]>([]);
  const [projectPrompts, setProjectPrompts] = useState<AgentPromptWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogState, setDialogState] = useState<
    | { open: false }
    | { open: true; mode: 'create'; scope: Scope }
    | { open: true; mode: 'edit'; scope: Scope; id: string; label: string; command: string }
  >({ open: false });
  const [shareState, setShareState] = useState<{ open: boolean; label: string; content: string }>(
    { open: false, label: '', content: '' },
  );

  const refresh = useCallback(async () => {
    try {
      const res = await getProjectPrompts(projectId);
      setGlobalPrompts(res.global);
      setProjectPrompts(res.project);
    } catch (err) {
      toast.error(`加载提示词失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  // Per-prompt in-flight guard so fast double-click doesn't race two toggles.
  const pendingToggles = useRef<Set<string>>(new Set());

  const toggleInserted = useCallback(async (scope: Scope, prompt: AgentPromptWithState) => {
    if (pendingToggles.current.has(prompt.id)) return;
    pendingToggles.current.add(prompt.id);
    const action = prompt.inserted ? 'remove' : 'insert';
    const flip = (list: AgentPromptWithState[]) =>
      list.map((p) => (p.id === prompt.id ? { ...p, inserted: !p.inserted } : p));
    if (scope === 'global') setGlobalPrompts(flip);
    else setProjectPrompts(flip);

    try {
      const res = await togglePromptInClaudeMd(projectId, prompt.command, action);
      if (action === 'remove' && res.changed === false) {
        if (res.reason === 'not-found') {
          toast.error('CLAUDE.md 中找不到该提示词的精确文本，请自行编辑 CLAUDE.md 移除。');
        } else {
          toast.warning('该提示词当前不在 CLAUDE.md 中（可能被手动编辑过），已重新同步状态。');
        }
        void refresh();
        return;
      }
      void refresh();
    } catch (err) {
      toast.error(`操作失败: ${(err as Error).message}`);
      if (scope === 'global') setGlobalPrompts(flip);
      else setProjectPrompts(flip);
    } finally {
      pendingToggles.current.delete(prompt.id);
    }
  }, [projectId, refresh]);

  const handleSave = useCallback(async (
    mode: 'create' | 'edit',
    scope: Scope,
    id: string | null,
    label: string,
    command: string,
  ) => {
    try {
      if (mode === 'create') {
        if (scope === 'global') await createGlobalPrompt({ label, command });
        else await createProjectPrompt(projectId, { label, command });
        toast.success('已添加');
      } else {
        if (!id) return;
        if (scope === 'global') await updateGlobalPrompt(id, { label, command });
        else await updateProjectPrompt(projectId, id, { label, command });
        toast.success('已更新');
      }
      void refresh();
    } catch (err) {
      toast.error(`保存失败: ${(err as Error).message}`);
    }
  }, [projectId, refresh]);

  const handleDelete = useCallback(async (scope: Scope, prompt: AgentPromptWithState) => {
    const description = prompt.inserted
      ? `此提示词目前已插入当前项目的 CLAUDE.md。\n\n删除后它会在 CLAUDE.md 中成为"孤儿文本"——仅删除提示词记录，不会自动从 CLAUDE.md 移除。\n\n确认删除？`
      : '确认删除此提示词？此操作不可撤销。';
    const ok = await confirm({
      title: '删除提示词',
      description,
      destructive: true,
      confirmLabel: '删除',
    });
    if (!ok) return;
    try {
      if (scope === 'global') await deleteGlobalPrompt(prompt.id);
      else await deleteProjectPrompt(projectId, prompt.id);
      toast.success('已删除');
      void refresh();
    } catch (err) {
      toast.error(`删除失败: ${(err as Error).message}`);
    }
  }, [projectId, refresh, confirm]);

  const openShare = useCallback((prompt: AgentPromptWithState) => {
    setShareState({ open: true, label: prompt.label, content: prompt.command });
  }, []);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Panel header */}
      <div className="px-3 pt-2.5 pb-2 border-b border-border/50 shrink-0">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Agent Prompts
        </span>
        <p className="mt-1 text-[11px] text-muted-foreground/70 leading-snug">
          点击卡片插入 / 移出当前项目的 CLAUDE.md；左上角绿点表示已插入
        </p>
      </div>

      {/* Project section — top */}
      <Section
        title="项目"
        count={projectPrompts.length}
        loading={loading}
        prompts={projectPrompts}
        emptyText="暂无项目提示词"
        onAdd={() => setDialogState({ open: true, mode: 'create', scope: 'project' })}
        onToggle={(p) => void toggleInserted('project', p)}
        onEdit={(p) => setDialogState({ open: true, mode: 'edit', scope: 'project', id: p.id, label: p.label, command: p.command })}
        onDelete={(p) => void handleDelete('project', p)}
        onShare={openShare}
      />

      <div className="h-px bg-border mx-2" />

      {/* Global section — bottom */}
      <Section
        title="全局"
        count={globalPrompts.length}
        loading={loading}
        prompts={globalPrompts}
        emptyText="暂无全局提示词"
        onAdd={() => setDialogState({ open: true, mode: 'create', scope: 'global' })}
        onToggle={(p) => void toggleInserted('global', p)}
        onEdit={(p) => setDialogState({ open: true, mode: 'edit', scope: 'global', id: p.id, label: p.label, command: p.command })}
        onDelete={(p) => void handleDelete('global', p)}
        onShare={openShare}
      />

      <AgentPromptDialog
        open={dialogState.open}
        onOpenChange={(o) => { if (!o) setDialogState({ open: false }); }}
        title={
          dialogState.open === false
            ? ''
            : dialogState.mode === 'create'
              ? `新建${dialogState.scope === 'global' ? '全局' : '项目'}提示词`
              : `编辑${dialogState.scope === 'global' ? '全局' : '项目'}提示词`
        }
        initialLabel={dialogState.open && dialogState.mode === 'edit' ? dialogState.label : ''}
        initialCommand={dialogState.open && dialogState.mode === 'edit' ? dialogState.command : ''}
        onSave={(label, command) => {
          if (!dialogState.open) return;
          const id = dialogState.mode === 'edit' ? dialogState.id : null;
          void handleSave(dialogState.mode, dialogState.scope, id, label, command);
        }}
      />

      <SharePromptDialog
        open={shareState.open}
        onOpenChange={(o) => setShareState((prev) => ({ ...prev, open: o }))}
        kind="agent-prompt"
        label={shareState.label}
        content={shareState.content}
      />
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

function Section({
  title, count, loading, prompts, emptyText,
  onAdd, onToggle, onEdit, onDelete, onShare,
}: {
  title: string;
  count: number;
  loading: boolean;
  prompts: AgentPromptWithState[];
  emptyText: string;
  onAdd: () => void;
  onToggle: (p: AgentPromptWithState) => void;
  onEdit: (p: AgentPromptWithState) => void;
  onDelete: (p: AgentPromptWithState) => void;
  onShare: (p: AgentPromptWithState) => void;
}) {
  return (
    <div className="px-2 py-2">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <span>{title}</span>
          <span className="text-muted-foreground/60 normal-case tracking-normal">({count})</span>
        </div>
        <button
          onClick={onAdd}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="新建"
          aria-label="新建"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      {loading ? (
        <div className="px-1 py-3 text-xs text-muted-foreground/60">加载中…</div>
      ) : prompts.length === 0 ? (
        <div className="px-1 py-3 text-xs text-muted-foreground/60">{emptyText}</div>
      ) : (
        <div className="space-y-1.5">
          {prompts.map((p) => {
            const preview = p.command.split('\n').find((l) => l.trim()) ?? p.command.trim();
            return (
              <PromptCard
                key={p.id}
                kind="agent-prompt"
                label={p.label}
                preview={preview}
                inserted={p.inserted}
                onLeftClick={() => onToggle(p)}
                onEdit={() => onEdit(p)}
                onDelete={() => onDelete(p)}
                onShare={() => onShare(p)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
