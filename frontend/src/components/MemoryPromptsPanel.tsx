import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, RefreshCw, ListRestart } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getMemoryPrompts, toggleMemoryInClaudeMd, type MemoryPromptItem } from '@/lib/api';
import { PromptCard } from './PromptCard';

interface MemoryPromptsPanelProps {
  projectId: string;
}

/**
 * Memory Prompts — read-only view of `<project>/.ccweb/memory/*.md`, each file
 * rendered as a card.  Click inserts its content into CLAUDE.md wrapped with
 * plain-text `START <name>` / `END <name>` markers (one per line); click again
 * removes the block using the same markers.
 *
 * No edit / delete / share — the user maintains the .md files externally.
 * A refresh button re-reads the directory in case files were added/edited
 * from another tool.
 */
export function MemoryPromptsPanel({ projectId }: MemoryPromptsPanelProps) {
  const [items, setItems] = useState<MemoryPromptItem[]>([]);
  const [claudeMdLineCount, setClaudeMdLineCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const pendingToggles = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getMemoryPrompts(projectId);
      setItems(next.items);
      setClaudeMdLineCount(next.claudeMdLineCount);
    } catch (err) {
      toast.error(`加载失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleToggle = useCallback(async (item: MemoryPromptItem) => {
    if (pendingToggles.current.has(item.filename)) return;
    pendingToggles.current.add(item.filename);
    // Optimistic flip
    setItems((prev) => prev.map((p) => (p.filename === item.filename ? { ...p, inserted: !p.inserted } : p)));
    const action = item.inserted ? 'remove' : 'insert';
    try {
      const res = await toggleMemoryInClaudeMd(projectId, item.filename, action);
      if (!res.ok) {
        toast.error(`操作失败${res.reason ? `（${res.reason}）` : ''}`);
        void refresh();
        return;
      }
      // Reconcile actual state from server response in case of in-place refresh
      setItems((prev) => prev.map((p) => (p.filename === item.filename ? { ...p, inserted: res.inserted } : p)));
      if (typeof res.claudeMdLineCount === 'number') setClaudeMdLineCount(res.claudeMdLineCount);
      if (action === 'insert' && res.reason === 'refreshed') {
        toast.info(`${item.name} 已更新（文件内容有变化）`);
      }
    } catch (err) {
      toast.error(`操作失败: ${(err as Error).message}`);
      setItems((prev) => prev.map((p) => (p.filename === item.filename ? { ...p, inserted: item.inserted } : p)));
    } finally {
      pendingToggles.current.delete(item.filename);
    }
  }, [projectId, refresh]);

  // Sequentially re-insert every currently-inserted card.  Serialize (not
  // Promise.all) because each call reads → rewrites CLAUDE.md; two in flight
  // would last-write-wins and drop one block.
  const handleRefreshAll = useCallback(async () => {
    if (refreshingAll) return;
    const targets = items.filter((p) => p.inserted);
    if (targets.length === 0) {
      toast.info('没有已插入的 memory 卡片');
      return;
    }
    setRefreshingAll(true);
    let ok = 0;
    let fail = 0;
    for (const item of targets) {
      if (pendingToggles.current.has(item.filename)) { fail++; continue; }
      pendingToggles.current.add(item.filename);
      try {
        const res = await toggleMemoryInClaudeMd(projectId, item.filename, 'insert');
        if (res.ok) {
          setItems((prev) => prev.map((p) => (p.filename === item.filename ? { ...p, inserted: res.inserted } : p)));
          if (typeof res.claudeMdLineCount === 'number') setClaudeMdLineCount(res.claudeMdLineCount);
          ok++;
        } else {
          fail++;
        }
      } catch {
        fail++;
      } finally {
        pendingToggles.current.delete(item.filename);
      }
    }
    setRefreshingAll(false);
    if (fail === 0) {
      toast.success(`已从磁盘更新 ${ok} 个 memory 卡片`);
    } else {
      toast.error(`${ok} 个更新成功，${fail} 个失败`);
    }
  }, [projectId, items, refreshingAll]);

  // Right-click "更新": re-insert while currently inserted — the backend
  // treats this as "refresh in place" (replaces the existing block's content
  // with the latest .md file).  No effect if the card is somehow not
  // currently inserted (toast informs the user).
  const handleRefresh = useCallback(async (item: MemoryPromptItem) => {
    if (pendingToggles.current.has(item.filename)) return;
    if (!item.inserted) {
      toast.info('卡片未插入，无需更新');
      return;
    }
    pendingToggles.current.add(item.filename);
    try {
      const res = await toggleMemoryInClaudeMd(projectId, item.filename, 'insert');
      if (!res.ok) {
        toast.error(`更新失败${res.reason ? `（${res.reason}）` : ''}`);
        void refresh();
        return;
      }
      setItems((prev) => prev.map((p) => (p.filename === item.filename ? { ...p, inserted: res.inserted } : p)));
      if (typeof res.claudeMdLineCount === 'number') setClaudeMdLineCount(res.claudeMdLineCount);
      toast.success(`${item.name} 已从磁盘重新加载`);
    } catch (err) {
      toast.error(`更新失败: ${(err as Error).message}`);
    } finally {
      pendingToggles.current.delete(item.filename);
    }
  }, [projectId, refresh]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Panel header — matches Quick Prompts / Agent Prompts layout */}
      <div className="px-3 pt-2.5 pb-2 border-b border-border/50 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Memory Prompts
          </span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => void handleRefreshAll()}
              disabled={refreshingAll || !items.some((p) => p.inserted)}
              className={cn(
                'p-0.5 rounded text-muted-foreground transition-colors',
                'hover:text-foreground hover:bg-muted-foreground/10',
                'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground'
              )}
              title="把所有已插入卡片的内容从磁盘重新加载到 CLAUDE.md"
            >
              <ListRestart className={cn('h-3.5 w-3.5', refreshingAll && 'animate-spin')} />
            </button>
            <button
              onClick={() => void refresh()}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
              title="刷新（重新扫描 .ccweb/memory/）"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground/70 leading-snug">
          来自 <code className="text-[11px]">.ccweb/memory/*.md</code> 的文件，点击插入 / 移除 CLAUDE.md（以
          <code className="text-[11px]"> START 名 / END 名 </code>包裹）
        </p>
        {claudeMdLineCount !== null && (
          <p className="mt-0.5 text-[11px] text-muted-foreground/60 font-mono tabular-nums">
            CLAUDE.md: {claudeMdLineCount} 行
          </p>
        )}
      </div>

      <div className="px-2 py-2 flex-1 min-h-0">
        {loading && items.length === 0 ? (
          <div className="px-1 py-6 text-xs text-muted-foreground/60 text-center">加载中…</div>
        ) : items.length === 0 ? (
          <div className="px-1 py-8 text-xs text-muted-foreground/60 flex flex-col items-center gap-2">
            <Database className="h-5 w-5" />
            <div className="text-center leading-relaxed">
              暂无 memory 文件
              <br />
              新建 <code className="text-[11px]">.ccweb/memory/*.md</code> 文件后点刷新
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {items.map((item) => (
              <PromptCard
                key={item.filename}
                kind="agent-prompt"
                noContextMenu
                label={item.name}
                preview={item.preview}
                inserted={item.inserted}
                cornerHint={`${item.lineCount} 行`}
                onLeftClick={() => void handleToggle(item)}
                // Right-click "更新" — only meaningful (and only shown) when
                // the card is currently inserted.  `noContextMenu` still
                // suppresses the default Edit/Delete/Share triad.
                onRefresh={item.inserted ? () => void handleRefresh(item) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
