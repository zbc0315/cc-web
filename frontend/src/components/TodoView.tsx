import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  Plus, ChevronRight, ChevronDown, Circle, CircleDot, CheckCircle2,
  Pencil, Trash2, CalendarClock, CalendarCheck, FolderOpen, RefreshCw, CornerDownRight,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  getTodoBlocks, createTodo, updateTodo, deleteTodo,
  type TodoBlock, type Todo, type TodoStatus,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const NEXT_STATUS: Record<TodoStatus, TodoStatus> = { todo: 'doing', doing: 'done', done: 'todo' };
const STATUS_ICON = { todo: Circle, doing: CircleDot, done: CheckCircle2 } as const;
const STATUS_CLS = {
  todo: 'text-muted-foreground',
  doing: 'text-amber-500',
  done: 'text-green-500',
} as const;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface EditorValues {
  title: string;
  description: string;
  status: TodoStatus;
  plannedDate: string | null;
  actualDate: string | null;
}

function TodoEditor({
  initial, saving, onSave, onCancel,
}: {
  initial?: Partial<EditorValues>;
  saving: boolean;
  onSave: (v: EditorValues) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [status, setStatus] = useState<TodoStatus>(initial?.status ?? 'todo');
  const [plannedDate, setPlannedDate] = useState(initial?.plannedDate ?? '');
  const [actualDate, setActualDate] = useState(initial?.actualDate ?? '');
  const [preview, setPreview] = useState(false);

  const submit = () => {
    if (!title.trim()) return;
    onSave({ title, description, status, plannedDate: plannedDate || null, actualDate: actualDate || null });
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('todo.title_ph')}
        className="w-full bg-background border border-border rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <label className="flex items-center gap-1">
          {t('todo.status')}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TodoStatus)}
            className="bg-background border border-border rounded px-1.5 py-0.5 text-foreground"
          >
            <option value="todo">{t('todo.status_todo')}</option>
            <option value="doing">{t('todo.status_doing')}</option>
            <option value="done">{t('todo.status_done')}</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          {t('todo.planned')}
          <input type="date" value={plannedDate ?? ''} onChange={(e) => setPlannedDate(e.target.value)}
            className="bg-background border border-border rounded px-1.5 py-0.5 text-foreground" />
        </label>
        <label className="flex items-center gap-1">
          {t('todo.actual')}
          <input type="date" value={actualDate ?? ''} onChange={(e) => setActualDate(e.target.value)}
            className="bg-background border border-border rounded px-1.5 py-0.5 text-foreground" />
        </label>
      </div>
      <div>
        <div className="flex gap-1 mb-1">
          <button onClick={() => setPreview(false)}
            className={cn('px-2 py-0.5 text-xs rounded', !preview ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
            {t('todo.write')}
          </button>
          <button onClick={() => setPreview(true)}
            className={cn('px-2 py-0.5 text-xs rounded', preview ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
            {t('todo.preview')}
          </button>
        </div>
        {preview ? (
          <div className="prose prose-sm dark:prose-invert max-w-none border border-border rounded p-2 min-h-[80px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{description || `_${t('todo.empty_desc')}_`}</ReactMarkdown>
          </div>
        ) : (
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)}
            rows={5} spellCheck={false} placeholder={t('todo.desc_ph')} className="font-mono text-xs" />
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={saving || !title.trim()}>{t('todo.save')}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>{t('todo.cancel')}</Button>
      </div>
    </div>
  );
}

export function TodoView() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [blocks, setBlocks] = useState<TodoBlock[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set());
  const [collapsedTodos, setCollapsedTodos] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ projectId: string; parentId: string | null } | null>(null);

  const today = localToday();

  const load = useCallback(async () => {
    setLoading(true);
    try { setBlocks(await getTodoBlocks()); } catch { setBlocks([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggleIn = (setFn: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    setFn((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const cycleStatus = async (todo: Todo) => {
    try { await updateTodo(todo.id, todo.projectId, { status: NEXT_STATUS[todo.status] }); await load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const saveNew = async (v: EditorValues) => {
    if (!draft) return;
    setSaving(true);
    try {
      await createTodo({ projectId: draft.projectId, parentId: draft.parentId, ...v });
      setDraft(null);
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const saveEdit = async (todo: Todo, v: EditorValues) => {
    setSaving(true);
    try { await updateTodo(todo.id, todo.projectId, v); setEditingId(null); await load(); }
    catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const remove = async (todo: Todo) => {
    const ok = await confirm({
      title: t('todo.confirm_delete_title'),
      description: t('todo.confirm_delete_desc'),
      destructive: true,
      confirmLabel: t('todo.delete'),
    });
    if (!ok) return;
    try { await deleteTodo(todo.id, todo.projectId); await load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const renderTree = (block: TodoBlock): ReactNode => {
    const ids = new Set(block.todos.map((t) => t.id));
    const byParent = new Map<string | null, Todo[]>();
    for (const todo of block.todos) {
      // Re-root any todo whose parent is missing (dangling) so it can never
      // become invisible/undeletable; the tree is acyclic by construction.
      const key = todo.parentId && ids.has(todo.parentId) ? todo.parentId : null;
      const arr = byParent.get(key);
      if (arr) arr.push(todo); else byParent.set(key, [todo]);
    }

    const renderNodes = (parentId: string | null, depth: number): ReactNode[] => {
      const out: ReactNode[] = [];
      for (const todo of byParent.get(parentId) ?? []) {
        const children = byParent.get(todo.id) ?? [];
        const collapsed = collapsedTodos.has(todo.id);
        const StatusIcon = STATUS_ICON[todo.status];
        const overdue = !!todo.plannedDate && todo.status !== 'done' && todo.plannedDate < today;

        out.push(
          <div key={todo.id}>
            <div className="group flex items-center gap-1.5 py-1 rounded hover:bg-accent/40"
              style={{ paddingLeft: depth * 18 + 4 }}>
              <button
                className="w-4 shrink-0 text-muted-foreground"
                onClick={() => children.length && toggleIn(setCollapsedTodos, todo.id)}
              >
                {children.length > 0 && (collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />)}
              </button>
              <button onClick={() => void cycleStatus(todo)} title={t(`todo.status_${todo.status}`)} className="shrink-0">
                <StatusIcon className={cn('h-4 w-4', STATUS_CLS[todo.status])} />
              </button>
              <button
                onClick={() => setEditingId((id) => (id === todo.id ? null : todo.id))}
                className={cn('flex-1 min-w-0 truncate text-left text-sm', todo.status === 'done' && 'line-through text-muted-foreground')}
              >
                {todo.title}
              </button>
              {todo.plannedDate && (
                <span className={cn('shrink-0 hidden sm:flex items-center gap-1 text-xs', overdue ? 'text-red-500' : 'text-muted-foreground')}>
                  <CalendarClock className="h-3 w-3" />{todo.plannedDate}
                </span>
              )}
              {todo.actualDate && (
                <span className="shrink-0 hidden sm:flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <CalendarCheck className="h-3 w-3" />{todo.actualDate}
                </span>
              )}
              <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="p-1 rounded hover:bg-accent text-muted-foreground" title={t('todo.add_sub')}
                  onClick={() => { setDraft({ projectId: block.projectId, parentId: todo.id }); setCollapsedTodos((p) => { const n = new Set(p); n.delete(todo.id); return n; }); }}>
                  <CornerDownRight className="h-3.5 w-3.5" />
                </button>
                <button className="p-1 rounded hover:bg-accent text-muted-foreground" title={t('todo.edit')}
                  onClick={() => setEditingId((id) => (id === todo.id ? null : todo.id))}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button className="p-1 rounded hover:bg-destructive/80 hover:text-destructive-foreground text-muted-foreground" title={t('todo.delete')}
                  onClick={() => void remove(todo)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {editingId === todo.id && (
              <div style={{ paddingLeft: depth * 18 + 22 }} className="py-1">
                <TodoEditor
                  initial={todo}
                  saving={saving}
                  onSave={(v) => void saveEdit(todo, v)}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            )}

            {!collapsed && editingId !== todo.id && todo.description && (
              <div style={{ paddingLeft: depth * 18 + 26 }}
                className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground pr-2 pb-1">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{todo.description}</ReactMarkdown>
              </div>
            )}

            {!collapsed && renderNodes(todo.id, depth + 1)}

            {draft && draft.parentId === todo.id && (
              <div style={{ paddingLeft: (depth + 1) * 18 + 22 }} className="py-1">
                <TodoEditor saving={saving} onSave={saveNew} onCancel={() => setDraft(null)} />
              </div>
            )}
          </div>
        );
      }
      return out;
    };

    return renderNodes(null, 0);
  };

  if (!blocks) {
    return <div className="text-sm text-muted-foreground py-8 text-center">{loading ? '…' : ''}</div>;
  }

  if (blocks.length === 0) {
    return <div className="text-center py-16 text-muted-foreground text-sm">{t('todo.no_projects')}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="icon" onClick={() => void load()} title={t('todo.refresh')}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
      </div>
      {blocks.map((block) => {
        const blockCollapsed = collapsedBlocks.has(block.projectId);
        const total = block.todos.length;
        const done = block.todos.filter((tdo) => tdo.status === 'done').length;
        return (
          <div key={block.projectId} className="rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <button className="text-muted-foreground" onClick={() => toggleIn(setCollapsedBlocks, block.projectId)}>
                {blockCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              <FolderOpen className="h-4 w-4 text-blue-400 shrink-0" />
              <span className="font-medium truncate flex-1">{block.projectName}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{done}/{total}</span>
              <button
                className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { setDraft({ projectId: block.projectId, parentId: null }); setCollapsedBlocks((p) => { const n = new Set(p); n.delete(block.projectId); return n; }); }}
              >
                <Plus className="h-3.5 w-3.5" />{t('todo.add')}
              </button>
            </div>
            {!blockCollapsed && (
              <div className="p-2">
                {total === 0 && !(draft && draft.projectId === block.projectId && draft.parentId === null) && (
                  <div className="text-xs text-muted-foreground px-2 py-3">{t('todo.empty')}</div>
                )}
                {renderTree(block)}
                {draft && draft.projectId === block.projectId && draft.parentId === null && (
                  <div className="py-1 px-1">
                    <TodoEditor saving={saving} onSave={saveNew} onCancel={() => setDraft(null)} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
