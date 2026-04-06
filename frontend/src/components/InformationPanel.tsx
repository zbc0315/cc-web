import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Trash2, X, Minimize2, Shuffle } from 'lucide-react';
import { toast } from 'sonner';
import {
  getConversations, getConversationDetail, deleteConversation, syncConversations,
  condenseConversation_api, reorganizeConversation_api,
  ConversationListItem, ConversationDetail,
} from '@/lib/api';
import { cn } from '@/lib/utils';

interface InformationPanelProps {
  projectId: string;
}

// ── Time grouping ──

function timeGroup(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400_000);
  const weekAgo = new Date(today.getTime() - 7 * 86400_000);
  if (d >= today) return '今天';
  if (d >= yesterday) return '昨天';
  if (d >= weekAgo) return '本周';
  return '更早';
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
  return String(tokens);
}

// ── Main Panel ──

export function InformationPanel({ projectId }: InformationPanelProps) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailVersion, setDetailVersion] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['今天', '昨天', '本周']));
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const data = await getConversations(projectId);
      setConversations(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [projectId]);

  // Initial load + poll
  useEffect(() => {
    setLoading(true);
    void fetchList();
    pollRef.current = setInterval(() => void fetchList(), 15000);
    const onVis = () => {
      if (document.hidden) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      } else {
        void fetchList();
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(() => void fetchList(), 15000);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchList]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncConversations(projectId) as any;
      const parts: string[] = [];
      if (result.synced > 0) parts.push(`同步 ${result.synced} 个新对话`);
      if (result.updated > 0) parts.push(`更新 ${result.updated} 个`);
      if (result.cleaned > 0) parts.push(`清理 ${result.cleaned} 个旧记录`);
      if (parts.length > 0) {
        toast.success(parts.join('，'));
        await fetchList();
      } else {
        toast.info('已是最新');
      }
    } catch { toast.error('同步失败'); }
    finally { setSyncing(false); }
  };

  const handleDelete = async (convId: string) => {
    if (!confirm('确认删除此对话记录？所有版本将被永久删除。')) return;
    try {
      await deleteConversation(projectId, convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (selectedConv === convId) { setSelectedConv(null); setDetail(null); }
      toast.success('已删除');
    } catch { toast.error('删除失败'); }
  };

  const openDetail = async (convId: string, version?: string) => {
    setSelectedConv(convId);
    setDetailLoading(true);
    setDetailVersion(version || null);
    try {
      const d = await getConversationDetail(projectId, convId, version, 'user');
      setDetail(d);
      setDetailVersion(d.version);
    } catch { toast.error('加载失败'); }
    finally { setDetailLoading(false); }
  };

  const switchVersion = async (version: string) => {
    if (!selectedConv) return;
    setDetailLoading(true);
    try {
      const d = await getConversationDetail(projectId, selectedConv, version, 'user');
      setDetail(d);
      setDetailVersion(d.version);
    } catch { toast.error('加载失败'); }
    finally { setDetailLoading(false); }
  };

  // Filter + group
  const filtered = search
    ? conversations.filter(c => c.summary.toLowerCase().includes(search.toLowerCase()))
    : conversations;

  const groups = new Map<string, ConversationListItem[]>();
  for (const c of filtered) {
    const g = timeGroup(c.started_at);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(c);
  }

  const toggleGroup = (g: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-xs text-muted-foreground">加载中...</div>;
  }

  // ── Detail dialog ──
  if (selectedConv && detail) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {/* Detail header */}
        <div className="flex-shrink-0 px-3 pt-2 pb-1 flex items-center justify-between border-b border-border">
          <button onClick={() => { setSelectedConv(null); setDetail(null); }} className="text-xs text-muted-foreground hover:text-foreground">
            ← 返回
          </button>
          <button onClick={() => { setSelectedConv(null); setDetail(null); }} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Version switcher */}
        {detail.available_versions.length > 1 && (
          <div className="flex-shrink-0 px-3 py-1.5 flex gap-1 flex-wrap border-b border-border/50">
            {detail.available_versions.map(v => (
              <button
                key={v}
                onClick={() => void switchVersion(v)}
                className={cn(
                  'px-1.5 py-0.5 rounded text-[10px] transition-colors',
                  detailVersion === v
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/50',
                )}
              >
                {v}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 py-2 text-xs space-y-2">
          {detailLoading ? (
            <div className="text-center text-muted-foreground py-8">加载中...</div>
          ) : (
            detail.content.split(/(?=^## [UA]\d+)/m).filter(Boolean).map((section, i) => {
              const headerMatch = section.match(/^## ([UA]\d+)(.*)\n/);
              if (!headerMatch) return <pre key={i} className="whitespace-pre-wrap text-muted-foreground">{section}</pre>;
              const turnId = headerMatch[1];
              const meta = headerMatch[2].trim();
              const body = section.slice(headerMatch[0].length).trim();
              const isUser = turnId.startsWith('U');

              // Parse [cN,P%] tag
              const tagMatch = meta.match(/\[c(\d+),(\d+)%/);
              const condensedLevel = tagMatch ? parseInt(tagMatch[1]) : 0;
              const pct = tagMatch ? parseInt(tagMatch[2]) : 100;

              return (
                <div key={i} className={cn(
                  'rounded-md p-2',
                  isUser ? 'bg-blue-500/5 border-l-2 border-blue-500/30' : 'bg-muted/30 border-l-2 border-muted-foreground/20',
                )}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="font-mono text-[10px] text-muted-foreground">{turnId}</span>
                    {condensedLevel > 0 && (
                      <span className={cn(
                        'text-[9px] px-1 py-px rounded',
                        pct < 20 ? 'bg-red-500/10 text-red-400'
                          : pct < 40 ? 'bg-orange-500/10 text-orange-400'
                          : 'bg-muted text-muted-foreground',
                      )}>
                        c{condensedLevel} {pct}%
                      </span>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap break-words leading-relaxed">{body}</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1 flex items-center justify-between">
        <span className="font-medium text-xs text-foreground">信息</span>
        <button
          onClick={() => void handleSync()}
          disabled={syncing}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="手动同步"
        >
          <RefreshCw className={cn('h-3 w-3', syncing && 'animate-spin')} />
        </button>
      </div>

      {/* Search */}
      <div className="flex-shrink-0 px-3 pb-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索..."
          className="w-full px-2 py-1 text-[11px] rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-blue-500/50"
        />
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
        {filtered.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8">
            {conversations.length === 0
              ? '尚无对话记录，在终端中与 AI 对话后会自动同步到这里'
              : '无匹配结果'}
          </div>
        )}
        {['今天', '昨天', '本周', '更早'].map(groupName => {
          const items = groups.get(groupName);
          if (!items || items.length === 0) return null;
          const expanded = expandedGroups.has(groupName);
          return (
            <div key={groupName}>
              <button
                onClick={() => toggleGroup(groupName)}
                className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1 hover:text-foreground"
              >
                <span className={cn('transition-transform', expanded ? 'rotate-90' : '')} style={{ display: 'inline-block' }}>▸</span>
                {groupName} ({items.length})
              </button>
              {expanded && items.map(conv => (
                <ConversationCard
                  key={conv.id}
                  conv={conv}
                  projectId={projectId}
                  onClick={() => void openDetail(conv.id)}
                  onDelete={() => void handleDelete(conv.id)}
                  onRefresh={fetchList}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Conversation Card ──

function ConversationCard({ conv, projectId, onClick, onDelete, onRefresh }: {
  conv: ConversationListItem;
  projectId: string;
  onClick: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [operating, setOperating] = useState(false);
  const hasCondensed = conv.latest !== 'v0';

  const handleCondense = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOperating(true);
    try {
      const result = await condenseConversation_api(projectId, conv.id);
      toast.success(`已缩减为 ${result.version} (${formatTokens(result.after_tokens)})`);
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || '缩减失败');
    } finally { setOperating(false); }
  };

  const handleReorganize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOperating(true);
    try {
      const result = await reorganizeConversation_api(projectId, conv.id);
      toast.success(`已重整为 ${result.version}，高关注: ${result.high_attention_turns.join(', ')}`);
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || '重整失败');
    } finally { setOperating(false); }
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        'p-2 rounded-md cursor-pointer transition-colors bg-muted/40 hover:bg-muted/60 border-l-2 border-border mb-1 group',
        operating && 'opacity-50 pointer-events-none',
      )}
    >
      <div className="text-[11px] text-foreground leading-tight line-clamp-2">{conv.summary}</div>
      <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
        <span>{conv.turns}轮</span>
        <span>·</span>
        {hasCondensed ? (
          <span>{conv.latest} ({formatTokens(conv.latest_tokens)}/{formatTokens(conv.original_tokens)})</span>
        ) : (
          <span>v0 ({formatTokens(conv.original_tokens)})</span>
        )}
        {conv.expand_count > 0 && (
          <>
            <span>·</span>
            <span>⤢{conv.expand_count}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
          <button
            onClick={handleCondense}
            className="text-muted-foreground hover:text-blue-400 transition-colors"
            title="信息缩减（通过 Haiku）"
          >
            <Minimize2 className="h-3 w-3" />
          </button>
          {conv.expand_count > 0 && (
            <button
              onClick={handleReorganize}
              className="text-muted-foreground hover:text-purple-400 transition-colors"
              title="信息重整（基于展开数据）"
            >
              <Shuffle className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-muted-foreground hover:text-red-400 transition-colors"
            title="删除"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
