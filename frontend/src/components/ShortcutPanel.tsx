import { useState, useEffect, useCallback } from 'react';
import { Plus, X, Zap, Pencil, GitMerge, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { STORAGE_KEYS, getStorage, setStorage } from '@/lib/storage';
import { getGlobalShortcuts, GlobalShortcut, getProjectShortcuts, createProjectShortcut, updateProjectShortcut, deleteProjectShortcut, ProjectShortcut, submitSkillToHub } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Shortcut = ProjectShortcut;

// ── Shortcut Editor Dialog ────────────────────────────────────────────────────

function ShortcutEditorDialog({
  open,
  onOpenChange,
  initialLabel,
  initialCommand,
  title,
  onSave,
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

  // Reset when opening
  useEffect(() => {
    if (open) {
      setLabel(initialLabel);
      setCommand(initialCommand);
    }
  }, [open, initialLabel, initialCommand]);

  const handleSave = () => {
    const cmd = command.trim();
    if (!cmd) return;
    onSave(label.trim() || cmd, cmd);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Write the command that will be sent to Claude when this shortcut is triggered.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0 flex flex-col">
          <div className="space-y-2">
            <Label htmlFor="shortcut-label">Label</Label>
            <Input
              id="shortcut-label"
              placeholder="Give it a name (optional)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="text-base"
              autoFocus
            />
          </div>
          <div className="space-y-2 flex-1 flex flex-col min-h-0">
            <Label htmlFor="shortcut-command">Command</Label>
            <textarea
              id="shortcut-command"
              placeholder="Enter the command to send to Claude..."
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className={cn(
                'flex-1 min-h-[200px] w-full rounded-md border border-input bg-background px-4 py-3',
                'text-base leading-relaxed font-mono',
                'ring-offset-background placeholder:text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'resize-none'
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
          <span className="text-xs text-muted-foreground">⌘↩ to save</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!command.trim()}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Share to SkillHub Dialog ──────────────────────────────────────────────────

function ShareToHubDialog({
  open,
  onOpenChange,
  label,
  command,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  command: string;
}) {
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState(() => getStorage(STORAGE_KEYS.skillhubAuthor, ''));
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      setDescription('');
      setTags('');
      setSubmitted(false);
      const saved = getStorage(STORAGE_KEYS.skillhubAuthor, '');
      if (saved) setAuthor(saved);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      setStorage(STORAGE_KEYS.skillhubAuthor, author);
      await submitSkillToHub({
        label,
        command,
        description: description.trim(),
        author: author.trim() || 'anonymous',
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setSubmitted(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>分享到 SkillHub</DialogTitle>
          <DialogDescription>
            将「{label}」分享给社区，审核通过后将出现在 SkillHub 中。
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            提交成功！等待审核后将出现在 SkillHub 中。
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="share-desc">描述</Label>
              <textarea
                id="share-desc"
                placeholder="简要描述这个命令的用途..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={cn(
                  'w-full rounded-md border border-input bg-background px-3 py-2',
                  'text-sm min-h-[80px] resize-none',
                  'ring-offset-background placeholder:text-muted-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="share-author">作者</Label>
              <Input
                id="share-author"
                placeholder="你的名字"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="share-tags">标签（逗号分隔）</Label>
              <Input
                id="share-tags"
                placeholder="代码审查, 中文, 测试"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {submitted ? (
            <Button onClick={() => onOpenChange(false)}>关闭</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? '提交中...' : '提交'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── ShortcutPanel ─────────────────────────────────────────────────────────────

interface ShortcutPanelProps {
  projectId: string;
  onSend: (text: string) => void;
}

export function ShortcutPanel({ projectId, onSend }: ShortcutPanelProps) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [globalShortcuts, setGlobalShortcuts] = useState<GlobalShortcut[]>([]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState<Shortcut | null>(null);

  // Share dialog state
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareLabel, setShareLabel] = useState('');
  const [shareCommand, setShareCommand] = useState('');

  useEffect(() => {
    void getProjectShortcuts(projectId).then(setShortcuts).catch(() => setShortcuts([]));
  }, [projectId]);

  useEffect(() => {
    void getGlobalShortcuts().then(setGlobalShortcuts).catch(() => setGlobalShortcuts([]));
  }, []);

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
  };

  const handleEdit = (s: Shortcut, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingShortcut(s);
    setDialogOpen(true);
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

  const handleShare = (label: string, command: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setShareLabel(label);
    setShareCommand(command);
    setShareDialogOpen(true);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteProjectShortcut(projectId, id);
      setShortcuts((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Failed to delete shortcut:', err);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background text-foreground select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-border flex-shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Shortcuts</span>
        <button
          className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
          onClick={handleAdd}
          title="New shortcut"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
        {/* Global shortcuts */}
        {globalShortcuts.length > 0 && (
          <>
            <div className="flex items-center gap-1.5 px-1 pt-1 pb-0.5">
              <Zap className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">全局</span>
            </div>
            {globalShortcuts.map((s) => {
              const parentLabel = s.parentId ? globalShortcuts.find((p) => p.id === s.parentId)?.label : undefined;
              return (
                <div
                  key={s.id}
                  className={cn(
                    'group relative rounded px-3 py-2 cursor-pointer',
                    'bg-muted hover:bg-accent',
                    'border border-transparent hover:border-muted-foreground/30',
                    'transition-colors'
                  )}
                  onClick={() => sendWithInheritance(s)}
                  title={parentLabel ? `继承自「${parentLabel}」` : `Click to send`}
                >
                  <div className="text-xs font-medium text-foreground truncate pr-6 leading-snug">{s.label}</div>
                  {parentLabel && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <GitMerge className="h-2.5 w-2.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground truncate">继承: {parentLabel}</span>
                    </div>
                  )}
                  {!parentLabel && s.label !== s.command && (
                    <div className="text-xs text-muted-foreground font-mono truncate mt-0.5 leading-snug">{s.command}</div>
                  )}
                  <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-0.5 rounded text-muted-foreground hover:text-green-400 transition-colors"
                      onClick={(e) => handleShare(s.label, s.command, e)}
                      title="分享到 SkillHub"
                    >
                      <Share2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
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
              No shortcuts yet.
              <br />
              Click&nbsp;<strong className="text-muted-foreground">+</strong>&nbsp;to add one.
            </p>
          </div>
        )}

        {/* Project shortcuts */}
        {shortcuts.map((s) => (
          <div
            key={s.id}
            className={cn(
              'group relative rounded px-3 py-2 cursor-pointer',
              'bg-muted hover:bg-accent',
              'border border-transparent hover:border-muted-foreground/30',
              'transition-colors'
            )}
            onClick={() => onSend(s.command + '\r')}
            title={`Click to send`}
          >
            <div className="text-xs font-medium text-foreground truncate pr-10 leading-snug">
              {s.label}
            </div>
            {s.label !== s.command && (
              <div className="text-xs text-muted-foreground font-mono truncate mt-0.5 leading-snug pr-10">
                {s.command}
              </div>
            )}
            <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                className="p-0.5 rounded text-muted-foreground hover:text-green-400 transition-colors"
                onClick={(e) => handleShare(s.label, s.command, e)}
                title="分享到 SkillHub"
              >
                <Share2 className="h-3 w-3" />
              </button>
              <button
                className="p-0.5 rounded text-muted-foreground hover:text-blue-400 transition-colors"
                onClick={(e) => handleEdit(s, e)}
                title="Edit shortcut"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                className="p-0.5 rounded text-muted-foreground hover:text-red-400 transition-colors"
                onClick={(e) => handleDelete(s.id, e)}
                title="Delete shortcut"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Editor Dialog */}
      <ShortcutEditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialLabel={editingShortcut?.label ?? ''}
        initialCommand={editingShortcut?.command ?? ''}
        title={editingShortcut ? 'Edit Shortcut' : 'New Shortcut'}
        onSave={handleSave}
      />

      {/* Share to SkillHub Dialog */}
      <ShareToHubDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        label={shareLabel}
        command={shareCommand}
      />
    </div>
  );
}
