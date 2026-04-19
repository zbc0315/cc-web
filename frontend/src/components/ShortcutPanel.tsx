import { useState, useEffect, useCallback } from 'react';
import { useProjectDialogStore } from '@/lib/stores';
import { Plus, Zap, GitMerge } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getGlobalShortcuts, GlobalShortcut,
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

type Shortcut = ProjectShortcut;

// ── Editor Dialog ──────────────────────────────────────────────────────────

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
          <DialogDescription>
            左键点击卡片会把此命令发送到 CLI。
          </DialogDescription>
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

// ── Panel ──────────────────────────────────────────────────────────────────

interface ShortcutPanelProps {
  projectId: string;
  onSend: (text: string) => void;
}

export function ShortcutPanel({ projectId, onSend }: ShortcutPanelProps) {
  const confirm = useConfirm();
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [globalShortcuts, setGlobalShortcuts] = useState<GlobalShortcut[]>([]);

  const dialogStore = useProjectDialogStore();
  const saved = dialogStore.get(projectId);

  const [dialogOpen, setDialogOpen] = useState(saved.shortcutEditorOpen);
  const [editingShortcut, setEditingShortcut] = useState<Shortcut | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(saved.shareHubOpen);
  const [shareLabel, setShareLabel] = useState(saved.shareHubLabel);
  const [shareCommand, setShareCommand] = useState(saved.shareHubCommand);

  useEffect(() => {
    void getProjectShortcuts(projectId).then(setShortcuts).catch(() => setShortcuts([]));
  }, [projectId]);

  useEffect(() => {
    if (saved.shortcutEditorOpen && saved.shortcutEditingId && shortcuts.length > 0) {
      const found = shortcuts.find((s) => s.id === saved.shortcutEditingId) ?? null;
      setEditingShortcut(found);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcuts]);

  useEffect(() => {
    void getGlobalShortcuts().then(setGlobalShortcuts).catch(() => setGlobalShortcuts([]));
  }, []);

  // Resolve parent chain for global shortcuts (inheritance).
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

  const handleAdd = () => {
    setEditingShortcut(null);
    setDialogOpen(true);
    dialogStore.setShortcutEditor(projectId, true, null);
  };

  const handleEdit = (s: Shortcut) => {
    setEditingShortcut(s);
    setDialogOpen(true);
    dialogStore.setShortcutEditor(projectId, true, s.id);
  };

  const handleSave = async (label: string, command: string) => {
    try {
      if (editingShortcut) {
        const updated = await updateProjectShortcut(projectId, editingShortcut.id, { label, command });
        setShortcuts((prev) => prev.map((s) => s.id === updated.id ? updated : s));
      } else {
        const created = await createProjectShortcut(projectId, { label, command });
        setShortcuts((prev) => [...prev, created]);
      }
    } catch (err) {
      console.error('Failed to save shortcut:', err);
    }
    setEditingShortcut(null);
  };

  const handleShare = (label: string, command: string) => {
    setShareLabel(label);
    setShareCommand(command);
    setShareDialogOpen(true);
    dialogStore.setShareHub(projectId, true, label, command);
  };

  const handleEditorOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) dialogStore.setShortcutEditor(projectId, false);
  };

  const handleShareOpenChange = (open: boolean) => {
    setShareDialogOpen(open);
    if (!open) dialogStore.setShareHub(projectId, false);
  };

  const handleDelete = async (s: Shortcut) => {
    const ok = await confirm({
      title: '删除快捷 Prompt',
      description: `确认删除「${s.label}」？此操作不可撤销。`,
      destructive: true,
      confirmLabel: '删除',
    });
    if (!ok) return;
    try {
      await deleteProjectShortcut(projectId, s.id);
      setShortcuts((prev) => prev.filter((x) => x.id !== s.id));
    } catch (err) {
      console.error('Failed to delete shortcut:', err);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      <div className="flex items-center justify-between px-3 h-9 border-b border-border flex-shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Quick Prompts</span>
        <button
          className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
          onClick={handleAdd}
          title="新建快捷 Prompt"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
        {globalShortcuts.length > 0 && (
          <>
            <div className="flex items-center gap-1.5 px-1 pt-1 pb-0.5">
              <Zap className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">全局</span>
            </div>
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
                  readOnly
                  onLeftClick={() => sendWithInheritance(s)}
                  onEdit={() => {/* global shortcuts edited from Dashboard */}}
                  onDelete={() => {/* global shortcuts deleted from Dashboard */}}
                  onShare={() => handleShare(s.label, s.command)}
                  footer={
                    parentLabel ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        <GitMerge className="h-2.5 w-2.5 text-muted-foreground" />
                        <span className="text-muted-foreground truncate">继承: {parentLabel}</span>
                      </div>
                    ) : null
                  }
                />
              );
            })}
            {shortcuts.length > 0 && (
              <div className="flex items-center gap-1.5 px-1 pt-2 pb-0.5">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">项目</span>
              </div>
            )}
          </>
        )}

        {shortcuts.length === 0 && globalShortcuts.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50">
            <Zap className="h-5 w-5" />
            <p className="text-xs text-center leading-relaxed">
              暂无快捷 Prompt。
              <br />
              点击&nbsp;<strong className="text-muted-foreground">+</strong>&nbsp;新建一个。
            </p>
          </div>
        )}

        {shortcuts.map((s) => (
          <PromptCard
            key={s.id}
            kind="quick-prompt"
            label={s.label}
            preview={s.label !== s.command ? s.command : ''}
            onLeftClick={() => onSend(s.command + '\r')}
            onEdit={() => handleEdit(s)}
            onDelete={() => void handleDelete(s)}
            onShare={() => handleShare(s.label, s.command)}
          />
        ))}
      </div>

      <QuickPromptEditorDialog
        open={dialogOpen}
        onOpenChange={handleEditorOpenChange}
        initialLabel={editingShortcut?.label ?? ''}
        initialCommand={editingShortcut?.command ?? ''}
        title={editingShortcut ? '编辑快捷 Prompt' : '新建快捷 Prompt'}
        onSave={handleSave}
      />

      <SharePromptDialog
        open={shareDialogOpen}
        onOpenChange={handleShareOpenChange}
        kind="quick-prompt"
        label={shareLabel}
        content={shareCommand}
      />
    </div>
  );
}
