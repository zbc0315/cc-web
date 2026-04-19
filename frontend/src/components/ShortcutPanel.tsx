import { useState, useEffect, useCallback } from 'react';
import { useProjectDialogStore } from '@/lib/stores';
import { Plus, GitMerge } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getGlobalShortcuts, GlobalShortcut,
  createGlobalShortcut, updateGlobalShortcut, deleteGlobalShortcut,
  getProjectShortcuts, createProjectShortcut, updateProjectShortcut, deleteProjectShortcut,
  ProjectShortcut,
} from '@/lib/api';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ConfirmProvider';
import { PromptCard } from '@/components/PromptCard';
import { SharePromptDialog } from '@/components/SharePromptDialog';
import { STORAGE_KEYS } from '@/lib/storage';

type Shortcut = ProjectShortcut;
type Scope = 'global' | 'project';

// ── Editor dialog ──────────────────────────────────────────────────────────

function QuickPromptEditorDialog({
  open, onOpenChange, initialLabel, initialCommand, title, onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialLabel: string;
  initialCommand: string;
  title: string;
  onSave: (label: string, command: string) => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [command, setCommand] = useState(initialCommand);
  const [isFocused, setIsFocused] = useState(true);

  useEffect(() => { if (open) setIsFocused(true); }, [open]);
  useEffect(() => {
    if (open) { setLabel(initialLabel); setCommand(initialCommand); }
  }, [open, initialLabel, initialCommand]);

  const handleSave = () => {
    const cmd = command.trim();
    if (!cmd) return;
    onSave(label.trim() || cmd, cmd);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        noOverlay
        className={cn(
          'sm:max-w-2xl max-h-[85vh] flex flex-col transition-opacity',
          !isFocused && 'opacity-50',
        )}
        onInteractOutside={(e) => { e.preventDefault(); setIsFocused(false); }}
        onClick={() => setIsFocused(true)}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>左键点击卡片会把此命令发送到 CLI。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 flex-1 min-h-0 flex flex-col">
          <div className="space-y-2">
            <Label htmlFor="qp-label">标签</Label>
            <Input
              id="qp-label"
              placeholder="显示名（可选，默认用命令文本）"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="text-base"
              autoFocus
            />
          </div>
          <div className="space-y-2 flex-1 flex flex-col min-h-0">
            <Label htmlFor="qp-command">命令</Label>
            <textarea
              id="qp-command"
              placeholder="输入要发送的命令..."
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className={cn(
                'flex-1 min-h-[200px] w-full rounded-md border border-input bg-background px-4 py-3',
                'text-base leading-relaxed font-mono',
                'ring-offset-background placeholder:text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'resize-none',
              )}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground">⌘↩ 保存</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={handleSave} disabled={!command.trim()}>保存</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Section sub-component ──────────────────────────────────────────────────

function Section({ title, count, onAdd, children }: {
  title: string;
  count: number;
  onAdd: () => void;
  children: React.ReactNode;
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
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
          title="新建"
          aria-label="新建"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      {children}
    </div>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────

interface ShortcutPanelProps {
  projectId: string;
  onSend: (text: string) => void;
}

/**
 * Quick Prompts panel — uniform layout with Agent Prompts:
 *   header ("QUICK PROMPTS" + one-line description)
 *   ├── Section "项目" (top) with its own `+` button
 *   └── Section "全局" (bottom) with its own `+` button
 *
 * Project cards that have NEVER been clicked show with a light-blue
 * background so a newly-created shortcut is visually distinct from ones the
 * user already uses regularly.  "Clicked once" state persists in
 * localStorage under `cc_used_shortcuts_<projectId>`.
 */
export function ShortcutPanel({ projectId, onSend }: ShortcutPanelProps) {
  const confirm = useConfirm();
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [globalShortcuts, setGlobalShortcuts] = useState<GlobalShortcut[]>([]);

  const dialogStore = useProjectDialogStore();
  const saved = dialogStore.get(projectId);

  const [dialogState, setDialogState] = useState<
    | { open: false }
    | { open: true; mode: 'create'; scope: Scope }
    | { open: true; mode: 'edit'; scope: Scope; id: string; label: string; command: string }
  >({ open: false });
  const [shareDialogOpen, setShareDialogOpen] = useState(saved.shareHubOpen);
  const [shareLabel, setShareLabel] = useState(saved.shareHubLabel);
  const [shareCommand, setShareCommand] = useState(saved.shareHubCommand);

  // Track which project-shortcut ids have been clicked at least once.
  // New shortcuts never in this set → render with the "unclicked" blue style.
  const usedKey = STORAGE_KEYS.usedShortcuts(projectId);
  const [usedIds, setUsedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(usedKey);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch { return new Set(); }
  });
  const markUsed = useCallback((id: string) => {
    setUsedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem(usedKey, JSON.stringify([...next])); } catch { /* quota */ }
      return next;
    });
  }, [usedKey]);

  useEffect(() => {
    void getProjectShortcuts(projectId).then(setShortcuts).catch(() => setShortcuts([]));
  }, [projectId]);

  useEffect(() => {
    void getGlobalShortcuts().then(setGlobalShortcuts).catch(() => setGlobalShortcuts([]));
  }, []);

  // Global-shortcut inheritance: when a shortcut has a parentId, chain
  // parent commands before it (each command sent 500ms apart).
  const resolveChain = useCallback((shortcut: GlobalShortcut): string[] => {
    const commands: string[] = [];
    const visited = new Set<string>();
    let current: GlobalShortcut | undefined = shortcut;
    const chain: GlobalShortcut[] = [];
    while (current) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      chain.unshift(current);
      current = current.parentId ? globalShortcuts.find((s) => s.id === current!.parentId) : undefined;
    }
    for (const s of chain) commands.push(s.command);
    return commands;
  }, [globalShortcuts]);

  const sendWithInheritance = useCallback((shortcut: GlobalShortcut) => {
    const commands = resolveChain(shortcut);
    commands.forEach((cmd, i) => {
      setTimeout(() => onSend(cmd + '\r'), i * 500);
    });
  }, [resolveChain, onSend]);

  const handleAdd = (scope: Scope) => setDialogState({ open: true, mode: 'create', scope });
  const handleEditProject = (s: Shortcut) =>
    setDialogState({ open: true, mode: 'edit', scope: 'project', id: s.id, label: s.label, command: s.command });
  const handleEditGlobal = (s: GlobalShortcut) =>
    setDialogState({ open: true, mode: 'edit', scope: 'global', id: s.id, label: s.label, command: s.command });

  const handleSave = async (label: string, command: string) => {
    if (!dialogState.open) return;
    try {
      if (dialogState.mode === 'create') {
        if (dialogState.scope === 'global') {
          const created = await createGlobalShortcut({ label, command });
          setGlobalShortcuts((prev) => [...prev, created]);
        } else {
          const created = await createProjectShortcut(projectId, { label, command });
          setShortcuts((prev) => [...prev, created]);
        }
      } else {
        if (dialogState.scope === 'global') {
          // Preserve the existing parentId (inheritance chain) since this panel
          // doesn't expose the parent-picker UI — only label + command here.
          // Full inheritance management still lives in Dashboard's
          // GlobalShortcutsSection.
          const existing = globalShortcuts.find((s) => s.id === dialogState.id);
          const updated = await updateGlobalShortcut(dialogState.id, {
            label, command,
            parentId: existing?.parentId ?? null,
          });
          setGlobalShortcuts((prev) => prev.map((s) => s.id === updated.id ? updated : s));
        } else {
          const updated = await updateProjectShortcut(projectId, dialogState.id, { label, command });
          setShortcuts((prev) => prev.map((s) => s.id === updated.id ? updated : s));
        }
      }
    } catch (err) {
      console.error('Failed to save shortcut:', err);
    }
  };

  const handleShare = (label: string, command: string) => {
    setShareLabel(label);
    setShareCommand(command);
    setShareDialogOpen(true);
    dialogStore.setShareHub(projectId, true, label, command);
  };

  const handleDeleteProject = async (s: Shortcut) => {
    const ok = await confirm({
      title: '删除项目快捷 Prompt',
      description: `确认删除「${s.label}」？此操作不可撤销。`,
      destructive: true,
      confirmLabel: '删除',
    });
    if (!ok) return;
    try {
      await deleteProjectShortcut(projectId, s.id);
      setShortcuts((prev) => prev.filter((x) => x.id !== s.id));
      // Clear the "used" flag so recreating a shortcut with the old id (if
      // backend ever recycles) doesn't inherit the stale state.
      setUsedIds((prev) => {
        if (!prev.has(s.id)) return prev;
        const next = new Set(prev);
        next.delete(s.id);
        try { localStorage.setItem(usedKey, JSON.stringify([...next])); } catch { /* quota */ }
        return next;
      });
    } catch (err) {
      console.error('Failed to delete shortcut:', err);
    }
  };

  const handleDeleteGlobal = async (s: GlobalShortcut) => {
    const children = globalShortcuts.filter((x) => x.parentId === s.id);
    const ok = await confirm({
      title: '删除全局快捷 Prompt',
      description: children.length > 0
        ? `「${s.label}」被 ${children.length} 个其他全局命令继承。删除后这些命令的继承会断链。确认删除？`
        : `确认删除「${s.label}」？此操作不可撤销。`,
      destructive: true,
      confirmLabel: '删除',
    });
    if (!ok) return;
    try {
      await deleteGlobalShortcut(s.id);
      setGlobalShortcuts((prev) => prev.filter((x) => x.id !== s.id));
    } catch (err) {
      console.error('Failed to delete global shortcut:', err);
    }
  };

  const handleProjectClick = (s: Shortcut) => {
    onSend(s.command + '\r');
    markUsed(s.id);
  };

  return (
    <div className="h-full flex flex-col text-foreground overflow-hidden">
      {/* Panel header — matches Agent Prompts / Memory Prompts */}
      <div className="px-3 pt-2.5 pb-2 border-b border-border/50 shrink-0">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Quick Prompts
        </span>
        <p className="mt-1 text-[11px] text-muted-foreground/70 leading-snug">
          点击卡片发送命令到 CLI；新建的命令在首次点击前以浅蓝色标识
        </p>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Project section — top */}
        <Section title="项目" count={shortcuts.length} onAdd={() => handleAdd('project')}>
          {shortcuts.length === 0 ? (
            <div className="px-1 py-3 text-xs text-muted-foreground/60">暂无项目命令</div>
          ) : (
            <div className="space-y-1.5">
              {shortcuts.map((s) => (
                <PromptCard
                  key={s.id}
                  kind="quick-prompt"
                  label={s.label}
                  preview={s.label !== s.command ? s.command : ''}
                  unclicked={!usedIds.has(s.id)}
                  onLeftClick={() => handleProjectClick(s)}
                  onEdit={() => handleEditProject(s)}
                  onDelete={() => void handleDeleteProject(s)}
                  onShare={() => handleShare(s.label, s.command)}
                />
              ))}
            </div>
          )}
        </Section>

        <div className="h-px bg-border mx-2" />

        {/* Global section — bottom */}
        <Section title="全局" count={globalShortcuts.length} onAdd={() => handleAdd('global')}>
          {globalShortcuts.length === 0 ? (
            <div className="px-1 py-3 text-xs text-muted-foreground/60">暂无全局命令</div>
          ) : (
            <div className="space-y-1.5">
              {globalShortcuts.map((s) => {
                const parentLabel = s.parentId
                  ? globalShortcuts.find((p) => p.id === s.parentId)?.label
                  : undefined;
                return (
                  <PromptCard
                    key={s.id}
                    kind="quick-prompt"
                    label={s.label}
                    preview={parentLabel ? '' : (s.label !== s.command ? s.command : '')}
                    onLeftClick={() => sendWithInheritance(s)}
                    onEdit={() => handleEditGlobal(s)}
                    onDelete={() => void handleDeleteGlobal(s)}
                    onShare={() => handleShare(s.label, s.command)}
                    footer={
                      parentLabel ? (
                        <div className="flex items-center gap-1 mt-0.5">
                          <GitMerge className="h-2.5 w-2.5 text-muted-foreground" />
                          <span className="text-muted-foreground truncate">继承: {parentLabel}（继承链仅可在 Dashboard 编辑）</span>
                        </div>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          )}
        </Section>
      </div>

      <QuickPromptEditorDialog
        open={dialogState.open}
        onOpenChange={(o) => { if (!o) setDialogState({ open: false }); }}
        initialLabel={dialogState.open && dialogState.mode === 'edit' ? dialogState.label : ''}
        initialCommand={dialogState.open && dialogState.mode === 'edit' ? dialogState.command : ''}
        title={
          !dialogState.open
            ? ''
            : dialogState.mode === 'create'
              ? `新建${dialogState.scope === 'global' ? '全局' : '项目'}命令`
              : '编辑命令'
        }
        onSave={(label, command) => void handleSave(label, command)}
      />

      <SharePromptDialog
        open={shareDialogOpen}
        onOpenChange={(open) => {
          setShareDialogOpen(open);
          if (!open) dialogStore.setShareHub(projectId, false);
        }}
        kind="quick-prompt"
        label={shareLabel}
        content={shareCommand}
      />
    </div>
  );
}
