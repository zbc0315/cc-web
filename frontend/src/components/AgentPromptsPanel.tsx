import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, MoreVertical, Check, Globe, FolderClosed } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
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

type Scope = 'global' | 'project';

interface AgentPromptsPanelProps {
  projectId: string;
}

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

  const toggleInserted = useCallback(async (scope: Scope, prompt: AgentPromptWithState) => {
    const action = prompt.inserted ? 'remove' : 'insert';
    // Optimistic flip
    const flip = (list: AgentPromptWithState[]) =>
      list.map((p) => (p.id === prompt.id ? { ...p, inserted: !p.inserted } : p));
    if (scope === 'global') setGlobalPrompts(flip);
    else setProjectPrompts(flip);

    try {
      const res = await togglePromptInClaudeMd(projectId, prompt.command, action);
      if (action === 'remove' && res.changed === false) {
        // Two failure modes, both surfaced so the user isn't left puzzled when
        // the click seemingly did nothing:
        //   'not-found'   : text present but we couldn't peel it cleanly (very
        //                   rare given the 3-level fallback)
        //   'not-present' : card thought inserted=true but CLAUDE.md was edited
        //                   manually — card state was stale
        if (res.reason === 'not-found') {
          toast.error('CLAUDE.md 中找不到该提示词的精确文本，请自行编辑 CLAUDE.md 移除。');
        } else {
          toast.warning('该提示词当前不在 CLAUDE.md 中（可能被手动编辑过），已重新同步状态。');
        }
        void refresh();
        return;
      }
      // Server-confirmed new state — re-fetch silently to reconcile any
      // multi-match / surrounding-whitespace quirks.
      void refresh();
    } catch (err) {
      toast.error(`操作失败: ${(err as Error).message}`);
      // Rollback
      if (scope === 'global') setGlobalPrompts(flip);
      else setProjectPrompts(flip);
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
        if (scope === 'global') {
          await createGlobalPrompt({ label, command });
        } else {
          await createProjectPrompt(projectId, { label, command });
        }
        toast.success('已添加');
      } else {
        if (!id) return;
        if (scope === 'global') {
          await updateGlobalPrompt(id, { label, command });
        } else {
          await updateProjectPrompt(projectId, id, { label, command });
        }
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

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <Section
        title="全局提示词"
        icon={<Globe className="h-3.5 w-3.5" />}
        emptyText="暂无全局提示词"
        loading={loading}
        prompts={globalPrompts}
        onAdd={() => setDialogState({ open: true, mode: 'create', scope: 'global' })}
        onToggle={(p) => void toggleInserted('global', p)}
        onEdit={(p) => setDialogState({ open: true, mode: 'edit', scope: 'global', id: p.id, label: p.label, command: p.command })}
        onDelete={(p) => void handleDelete('global', p)}
      />
      <div className="h-px bg-border mx-2" />
      <Section
        title="本项目提示词"
        icon={<FolderClosed className="h-3.5 w-3.5" />}
        emptyText="暂无项目提示词"
        loading={loading}
        prompts={projectPrompts}
        onAdd={() => setDialogState({ open: true, mode: 'create', scope: 'project' })}
        onToggle={(p) => void toggleInserted('project', p)}
        onEdit={(p) => setDialogState({ open: true, mode: 'edit', scope: 'project', id: p.id, label: p.label, command: p.command })}
        onDelete={(p) => void handleDelete('project', p)}
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
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  emptyText,
  loading,
  prompts,
  onAdd,
  onToggle,
  onEdit,
  onDelete,
}: {
  title: string;
  icon: React.ReactNode;
  emptyText: string;
  loading: boolean;
  prompts: AgentPromptWithState[];
  onAdd: () => void;
  onToggle: (p: AgentPromptWithState) => void;
  onEdit: (p: AgentPromptWithState) => void;
  onDelete: (p: AgentPromptWithState) => void;
}) {
  return (
    <div className="px-2 py-2">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {icon}
          <span>{title}</span>
          <span className="text-muted-foreground/60">({prompts.length})</span>
        </div>
        <button
          onClick={onAdd}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
          title="新建"
        >
          <Plus className="h-3 w-3" />
          添加
        </button>
      </div>
      {loading ? (
        <div className="px-1 py-4 text-xs text-muted-foreground/60">加载中…</div>
      ) : prompts.length === 0 ? (
        <div className="px-1 py-4 text-xs text-muted-foreground/60">{emptyText}</div>
      ) : (
        <div className="space-y-1.5">
          {prompts.map((p) => (
            <PromptCard key={p.id} prompt={p} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function PromptCard({
  prompt,
  onToggle,
  onEdit,
  onDelete,
}: {
  prompt: AgentPromptWithState;
  onToggle: (p: AgentPromptWithState) => void;
  onEdit: (p: AgentPromptWithState) => void;
  onDelete: (p: AgentPromptWithState) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close kebab menu on outside click. Uses pointerdown for touch/pen parity.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  const preview = prompt.command.split('\n').find((l) => l.trim()) ?? prompt.command.trim();

  return (
    <div
      className={cn(
        'group relative rounded-md border text-xs transition-colors cursor-pointer',
        prompt.inserted
          ? 'border-blue-500/50 bg-blue-500/10 hover:bg-blue-500/15'
          : 'border-dashed border-border hover:border-border/80 hover:bg-muted/50',
      )}
      onClick={() => onToggle(prompt)}
      title={prompt.inserted ? '点击从 CLAUDE.md 移除' : '点击插入 CLAUDE.md'}
    >
      <div className="px-2 py-1.5 pr-7">
        <div className="flex items-center gap-1 font-medium truncate">
          {prompt.inserted && <Check className="h-3 w-3 text-blue-500 shrink-0" />}
          <span className="truncate">{prompt.label}</span>
        </div>
        <div className="mt-0.5 text-muted-foreground/80 truncate">{preview}</div>
      </div>
      <div
        ref={menuRef}
        className="absolute top-1 right-1"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          className={cn(
            'p-0.5 rounded transition-opacity',
            menuOpen ? 'opacity-100 bg-muted' : 'opacity-0 group-hover:opacity-100',
            'hover:bg-muted focus:opacity-100 focus:bg-muted',
          )}
          title="更多"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-0.5 z-10 min-w-[80px] rounded-md border border-border bg-popover shadow-md py-1">
            <button
              className="block w-full text-left px-2 py-1 text-xs hover:bg-muted"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(prompt); }}
            >
              编辑
            </button>
            <button
              className="block w-full text-left px-2 py-1 text-xs text-red-500 hover:bg-muted"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(prompt); }}
            >
              删除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
