import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, X, Zap, Pencil, GitMerge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getGlobalShortcuts, GlobalShortcut } from '@/lib/api';

interface Shortcut {
  id: string;
  label: string;
  command: string;
}

const storageKey = (projectId: string) => `cc_shortcuts_${projectId}`;

interface ShortcutPanelProps {
  projectId: string;
  onSend: (text: string) => void;
}

export function ShortcutPanel({ projectId, onSend }: ShortcutPanelProps) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [globalShortcuts, setGlobalShortcuts] = useState<GlobalShortcut[]>([]);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const labelInputRef = useRef<HTMLInputElement>(null);

  // editingId: which card is open for editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editCommand, setEditCommand] = useState('');
  const editLabelRef = useRef<HTMLInputElement>(null);

  // Load from localStorage when project changes
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(projectId));
      setShortcuts(raw ? (JSON.parse(raw) as Shortcut[]) : []);
    } catch {
      setShortcuts([]);
    }
    setEditingId(null);
    setAdding(false);
  }, [projectId]);

  // Load global shortcuts
  useEffect(() => {
    void getGlobalShortcuts().then(setGlobalShortcuts).catch(() => setGlobalShortcuts([]));
  }, []);

  // Resolve inheritance chain: returns commands from root ancestor → self
  const resolveChain = useCallback((shortcut: GlobalShortcut): string[] => {
    const commands: string[] = [];
    const visited = new Set<string>();
    let current: GlobalShortcut | undefined = shortcut;
    const chain: GlobalShortcut[] = [];
    while (current) {
      if (visited.has(current.id)) break; // prevent cycles
      visited.add(current.id);
      chain.unshift(current);
      current = current.parentId ? globalShortcuts.find((s) => s.id === current!.parentId) : undefined;
    }
    for (const s of chain) commands.push(s.command);
    return commands;
  }, [globalShortcuts]);

  // Send a shortcut with inheritance chain
  const sendWithInheritance = useCallback((shortcut: GlobalShortcut) => {
    const commands = resolveChain(shortcut);
    // Send commands sequentially with small delay between them
    commands.forEach((cmd, i) => {
      setTimeout(() => onSend(cmd + '\r'), i * 500);
    });
  }, [resolveChain, onSend]);

  // Focus label input when add form opens
  useEffect(() => {
    if (adding) setTimeout(() => labelInputRef.current?.focus(), 0);
  }, [adding]);

  // Focus edit label when edit form opens
  useEffect(() => {
    if (editingId) setTimeout(() => editLabelRef.current?.focus(), 0);
  }, [editingId]);

  const persist = (list: Shortcut[]) => {
    setShortcuts(list);
    localStorage.setItem(storageKey(projectId), JSON.stringify(list));
  };

  const handleAdd = () => {
    const cmd = newCommand.trim();
    if (!cmd) return;
    persist([
      ...shortcuts,
      {
        id: crypto.randomUUID(),
        label: newLabel.trim() || cmd,
        command: cmd,
      },
    ]);
    setNewLabel('');
    setNewCommand('');
    setAdding(false);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (editingId === id) setEditingId(null);
    persist(shortcuts.filter((s) => s.id !== id));
  };

  const openEdit = (s: Shortcut) => {
    setEditingId(s.id);
    setEditLabel(s.label);
    setEditCommand(s.command);
    // close add form if open
    setAdding(false);
  };

  const handleSaveEdit = () => {
    const cmd = editCommand.trim();
    if (!cmd) return;
    persist(
      shortcuts.map((s) =>
        s.id === editingId
          ? { ...s, label: editLabel.trim() || cmd, command: cmd }
          : s
      )
    );
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setAdding(false);
      setNewLabel('');
      setNewCommand('');
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleCancelEdit();
  };

  return (
    <div className="h-full flex flex-col bg-background text-foreground select-none">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-border flex-shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Shortcuts</span>
        <button
          className={cn(
            'p-0.5 rounded transition-colors',
            adding ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => { setAdding((v) => !v); setEditingId(null); }}
          title="New shortcut"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div
          className="p-2 border-b border-border space-y-1.5 flex-shrink-0"
          onKeyDown={handleAddKeyDown}
        >
          <input
            ref={labelInputRef}
            placeholder="Label (optional)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className={cn(
              'w-full text-xs bg-muted border border-border rounded px-2 py-1',
              'text-foreground placeholder:text-muted-foreground',
              'outline-none focus:border-zinc-500 transition-colors'
            )}
          />
          <textarea
            placeholder="Command to send…"
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            rows={3}
            className={cn(
              'w-full text-xs bg-muted border border-border rounded px-2 py-1',
              'text-foreground placeholder:text-muted-foreground font-mono',
              'outline-none focus:border-zinc-500 transition-colors resize-none'
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <div className="flex gap-1.5 justify-end">
            <button
              className="text-xs px-2.5 py-1 rounded bg-secondary hover:bg-accent text-foreground transition-colors"
              onClick={() => { setAdding(false); setNewLabel(''); setNewCommand(''); }}
            >
              Cancel
            </button>
            <button
              className={cn(
                'text-xs px-2.5 py-1 rounded transition-colors text-white',
                newCommand.trim()
                  ? 'bg-blue-600 hover:bg-blue-500'
                  : 'bg-secondary opacity-40 cursor-not-allowed'
              )}
              disabled={!newCommand.trim()}
              onClick={handleAdd}
            >
              Add
            </button>
          </div>
          <p className="text-xs text-muted-foreground">⌘↩ to save · Esc to cancel</p>
        </div>
      )}

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
        {/* Global shortcuts section */}
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
                  title={parentLabel ? `继承自「${parentLabel}」，点击发送完整链` : `Click to send: ${s.command}`}
                >
                  <div className="text-xs font-medium text-foreground truncate leading-snug">{s.label}</div>
                  {parentLabel && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <GitMerge className="h-2.5 w-2.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground truncate">继承: {parentLabel}</span>
                    </div>
                  )}
                  {!parentLabel && s.label !== s.command && (
                    <div className="text-xs text-muted-foreground font-mono truncate mt-0.5 leading-snug">{s.command}</div>
                  )}
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

        {shortcuts.length === 0 && !adding && globalShortcuts.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50">
            <Zap className="h-5 w-5" />
            <p className="text-xs text-center leading-relaxed">
              No shortcuts yet.
              <br />
              Click&nbsp;<strong className="text-muted-foreground">+</strong>&nbsp;to add one.
            </p>
          </div>
        )}

        {shortcuts.map((s) =>
          editingId === s.id ? (
            /* ── Inline edit form ── */
            <div
              key={s.id}
              className="rounded border border-border bg-muted p-2 space-y-1.5"
              onKeyDown={handleEditKeyDown}
            >
              <input
                ref={editLabelRef}
                placeholder="Label (optional)"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className={cn(
                  'w-full text-xs bg-secondary border border-border rounded px-2 py-1',
                  'text-foreground placeholder:text-muted-foreground',
                  'outline-none focus:border-zinc-500 transition-colors'
                )}
              />
              <textarea
                placeholder="Command to send…"
                value={editCommand}
                onChange={(e) => setEditCommand(e.target.value)}
                rows={3}
                className={cn(
                  'w-full text-xs bg-secondary border border-border rounded px-2 py-1',
                  'text-foreground placeholder:text-muted-foreground font-mono',
                  'outline-none focus:border-zinc-500 transition-colors resize-none'
                )}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSaveEdit();
                  }
                }}
              />
              <div className="flex gap-1.5 justify-end">
                <button
                  className="text-xs px-2.5 py-1 rounded bg-zinc-600 hover:bg-accent text-foreground transition-colors"
                  onClick={handleCancelEdit}
                >
                  Cancel
                </button>
                <button
                  className={cn(
                    'text-xs px-2.5 py-1 rounded transition-colors text-white',
                    editCommand.trim()
                      ? 'bg-blue-600 hover:bg-blue-500'
                      : 'bg-secondary opacity-40 cursor-not-allowed'
                  )}
                  disabled={!editCommand.trim()}
                  onClick={handleSaveEdit}
                >
                  Save
                </button>
              </div>
              <p className="text-xs text-muted-foreground">⌘↩ to save · Esc to cancel</p>
            </div>
          ) : (
            /* ── Normal card ── */
            <div
              key={s.id}
              className={cn(
                'group relative rounded px-3 py-2 cursor-pointer',
                'bg-muted hover:bg-accent',
                'border border-transparent hover:border-muted-foreground/30',
                'transition-colors'
              )}
              onClick={() => onSend(s.command + '\r')}
              title={`Click to send: ${s.command}`}
            >
              {/* label */}
              <div className="text-xs font-medium text-foreground truncate pr-10 leading-snug">
                {s.label}
              </div>
              {/* command preview (only if different from label) */}
              {s.label !== s.command && (
                <div className="text-xs text-muted-foreground font-mono truncate mt-0.5 leading-snug pr-10">
                  {s.command}
                </div>
              )}

              {/* action buttons (visible on hover) */}
              <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* edit button */}
                <button
                  className="p-0.5 rounded text-muted-foreground hover:text-blue-400 transition-colors"
                  onClick={(e) => { e.stopPropagation(); openEdit(s); }}
                  title="Edit shortcut"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                {/* delete button */}
                <button
                  className="p-0.5 rounded text-muted-foreground hover:text-red-400 transition-colors"
                  onClick={(e) => handleDelete(s.id, e)}
                  title="Delete shortcut"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
