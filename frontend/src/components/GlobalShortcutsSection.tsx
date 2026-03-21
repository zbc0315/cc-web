import { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, X, Zap, GitMerge } from 'lucide-react';
import {
  GlobalShortcut,
  getGlobalShortcuts,
  createGlobalShortcut,
  updateGlobalShortcut,
  deleteGlobalShortcut,
} from '@/lib/api';
import { cn } from '@/lib/utils';

export function GlobalShortcutsSection() {
  const [shortcuts, setShortcuts] = useState<GlobalShortcut[]>([]);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newParentId, setNewParentId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editCommand, setEditCommand] = useState('');
  const [editParentId, setEditParentId] = useState('');
  const addLabelRef = useRef<HTMLInputElement>(null);
  const editLabelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getGlobalShortcuts().then(setShortcuts).catch(() => setShortcuts([]));
  }, []);

  useEffect(() => {
    if (adding) setTimeout(() => addLabelRef.current?.focus(), 0);
  }, [adding]);

  useEffect(() => {
    if (editingId) setTimeout(() => editLabelRef.current?.focus(), 0);
  }, [editingId]);

  const handleAdd = async () => {
    const cmd = newCommand.trim();
    if (!cmd) return;
    const created = await createGlobalShortcut({
      label: newLabel.trim() || cmd, command: cmd,
      ...(newParentId ? { parentId: newParentId } : {}),
    });
    setShortcuts((prev) => [...prev, created]);
    setNewLabel(''); setNewCommand(''); setNewParentId(''); setAdding(false);
  };

  const handleDelete = async (id: string) => {
    await deleteGlobalShortcut(id);
    setShortcuts((prev) => prev.filter((s) => s.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const handleSaveEdit = async () => {
    const cmd = editCommand.trim();
    if (!cmd || !editingId) return;
    const updated = await updateGlobalShortcut(editingId, {
      label: editLabel.trim() || cmd, command: cmd,
      parentId: editParentId || null,
    });
    setShortcuts((prev) => prev.map((s) => s.id === editingId ? updated : s));
    setEditingId(null);
  };

  return (
    <section className="mt-10">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">全局快捷命令</h2>
          <span className="text-xs text-muted-foreground">在所有项目的终端中可用</span>
        </div>
        <button
          onClick={() => { setAdding((v) => !v); setEditingId(null); }}
          className={cn(
            'flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border transition-colors',
            adding
              ? 'border-border text-foreground bg-muted'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          新建
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="mb-4 p-4 rounded-lg border border-border bg-background space-y-3">
          <input
            ref={addLabelRef}
            placeholder="名称（可选）"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="w-full text-sm bg-muted border border-border rounded px-3 py-1.5 text-foreground placeholder:text-muted-foreground outline-none focus:border-border transition-colors"
          />
          <textarea
            placeholder="命令内容…"
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            rows={3}
            className="w-full text-sm bg-muted border border-border rounded px-3 py-1.5 text-foreground placeholder:text-muted-foreground font-mono outline-none focus:border-border transition-colors resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleAdd(); }
              if (e.key === 'Escape') { setAdding(false); setNewLabel(''); setNewCommand(''); setNewParentId(''); }
            }}
          />
          <div className="flex items-center gap-2">
            <GitMerge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <select
              value={newParentId}
              onChange={(e) => setNewParentId(e.target.value)}
              className="flex-1 text-sm bg-muted border border-border rounded px-3 py-1.5 text-foreground outline-none focus:border-border transition-colors"
            >
              <option value="">无继承</option>
              {shortcuts.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">⌘↩ 保存 · Esc 取消</span>
            <div className="flex gap-2">
              <button
                onClick={() => { setAdding(false); setNewLabel(''); setNewCommand(''); }}
                className="text-sm px-3 py-1 rounded bg-secondary hover:bg-accent text-foreground transition-colors"
              >取消</button>
              <button
                onClick={() => void handleAdd()}
                disabled={!newCommand.trim()}
                className={cn(
                  'text-sm px-3 py-1 rounded transition-colors text-white',
                  newCommand.trim() ? 'bg-blue-600 hover:bg-blue-500' : 'bg-secondary opacity-40 cursor-not-allowed'
                )}
              >保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      {shortcuts.length === 0 && !adding ? (
        <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground/50 border border-dashed border-border rounded-lg">
          <Zap className="h-6 w-6" />
          <p className="text-sm">还没有全局快捷命令</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {shortcuts.map((s) =>
            editingId === s.id ? (
              /* Edit card */
              <div key={s.id} className="rounded-lg border border-border bg-background p-3 space-y-2">
                <input
                  ref={editLabelRef}
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="名称（可选）"
                  className="w-full text-sm bg-muted border border-border rounded px-2.5 py-1 text-foreground placeholder:text-muted-foreground outline-none focus:border-border transition-colors"
                />
                <textarea
                  value={editCommand}
                  onChange={(e) => setEditCommand(e.target.value)}
                  rows={3}
                  className="w-full text-sm bg-muted border border-border rounded px-2.5 py-1 text-foreground font-mono outline-none focus:border-border transition-colors resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSaveEdit(); }
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
                <div className="flex items-center gap-2">
                  <GitMerge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <select
                    value={editParentId}
                    onChange={(e) => setEditParentId(e.target.value)}
                    className="flex-1 text-sm bg-muted border border-border rounded px-2.5 py-1 text-foreground outline-none focus:border-border transition-colors"
                  >
                    <option value="">无继承</option>
                    {shortcuts.filter((x) => x.id !== s.id).map((x) => (
                      <option key={x.id} value={x.id}>{x.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditingId(null)} className="text-xs px-2.5 py-1 rounded bg-secondary hover:bg-accent text-foreground transition-colors">取消</button>
                  <button
                    onClick={() => void handleSaveEdit()}
                    disabled={!editCommand.trim()}
                    className={cn('text-xs px-2.5 py-1 rounded transition-colors text-white', editCommand.trim() ? 'bg-blue-600 hover:bg-blue-500' : 'bg-secondary opacity-40 cursor-not-allowed')}
                  >保存</button>
                </div>
              </div>
            ) : (
              /* Normal card */
              <div key={s.id} className="group relative rounded-lg border border-border bg-background hover:border-muted-foreground/30 transition-colors p-3">
                <div className="text-sm font-medium text-foreground truncate pr-14">{s.label}</div>
                {s.parentId && (() => {
                  const parent = shortcuts.find((x) => x.id === s.parentId);
                  return parent ? (
                    <div className="flex items-center gap-1 mt-1">
                      <GitMerge className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground truncate">继承: {parent.label}</span>
                    </div>
                  ) : null;
                })()}
                {!s.parentId && s.label !== s.command && (
                  <div className="text-xs text-muted-foreground font-mono truncate mt-1 pr-14">{s.command}</div>
                )}
                {/* Action buttons */}
                <div className="absolute top-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { setEditingId(s.id); setEditLabel(s.label); setEditCommand(s.command); setEditParentId(s.parentId || ''); setAdding(false); }}
                    className="p-1 rounded text-muted-foreground hover:text-blue-400 transition-colors"
                    title="编辑"
                  ><Pencil className="h-3.5 w-3.5" /></button>
                  <button
                    onClick={() => void handleDelete(s.id)}
                    className="p-1 rounded text-muted-foreground hover:text-red-400 transition-colors"
                    title="删除"
                  ><X className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </section>
  );
}
