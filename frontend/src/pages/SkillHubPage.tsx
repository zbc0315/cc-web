import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Search, Download, ChevronDown, User, Tag, Puzzle, Trash2, Power,
  Zap, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  getHubItems, type HubItem,
  getGlobalShortcuts, createGlobalShortcut,
  getGlobalPrompts, createGlobalPrompt,
  getInstalledPlugins, installPlugin, uninstallPlugin, setPluginEnabled,
  type PluginInfo,
} from '@/lib/api';
import { cn } from '@/lib/utils';

type HubTab = 'prompts' | 'plugins';
type KindFilter = 'all' | 'quick-prompt' | 'agent-prompt';

interface PluginHubItem {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  tags?: string[];
  downloads?: number;
  permissions: string[];
  downloadUrl: string;
}

/**
 * CCWeb Hub browse page — community-shared Quick Prompts (shortcuts) and
 * Agent Prompts, plus plugins.  Replaces the earlier SkillHub shell that
 * pointed at the deleted `ccweb-skillhub` repo.
 *
 * Items come from `https://github.com/zbc0315/ccweb-hub` via the backend
 * proxy (`/api/skillhub/items`).  Import lands the prompt in the user's
 * global scope (Quick Prompts → global shortcuts; Agent Prompts → global
 * agent prompts).  Users can later move to project scope from the chat
 * panels if they want.
 *
 * The exported symbol stays as `SkillHubPage` for URL stability — React
 * Router mount and Dashboard button both reference it by that name.
 */
export function SkillHubPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<HubTab>('prompts');
  const [search, setSearch] = useState('');

  // ── Plugins ──────────────────────────────────────────────────────────────
  const [installedPlugins, setInstalledPlugins] = useState<PluginInfo[]>([]);
  const [hubPlugins, setHubPlugins] = useState<PluginHubItem[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== 'plugins') return;
    setPluginsLoading(true);
    Promise.all([
      getInstalledPlugins().catch(() => [] as PluginInfo[]),
      fetch('/api/skillhub/plugins').then((r) => r.ok ? r.json() : []).catch(() => []) as Promise<PluginHubItem[]>,
    ]).then(([installed, hub]) => {
      setInstalledPlugins(installed);
      setHubPlugins(hub);
    }).finally(() => setPluginsLoading(false));
  }, [activeTab]);

  const handleInstallPlugin = useCallback(async (item: PluginHubItem) => {
    if (installingId) return;
    setInstallingId(item.id);
    try {
      await installPlugin(item.downloadUrl);
      toast.success(`已安装 ${item.name}`);
      const updated = await getInstalledPlugins().catch(() => [] as PluginInfo[]);
      setInstalledPlugins(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '安装失败');
    } finally {
      setInstallingId(null);
    }
  }, [installingId]);

  const handleUninstallPlugin = useCallback(async (id: string) => {
    try {
      await uninstallPlugin(id);
      setInstalledPlugins((prev) => prev.filter((p) => p.id !== id));
      toast.success('已卸载');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '卸载失败');
    }
  }, []);

  const handleTogglePlugin = useCallback(async (id: string, enabled: boolean) => {
    try {
      await setPluginEnabled(id, enabled);
      setInstalledPlugins((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  }, []);

  // ── Prompts ──────────────────────────────────────────────────────────────
  const [items, setItems] = useState<HubItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [importingId, setImportingId] = useState<string | null>(null);

  useEffect(() => {
    // Load hub items AND the user's existing globals in parallel.  Pre-fill
    // `importedIds` so an item the user already has locally (matched by
    // label + body) shows "已导入" instead of re-offering to import — prevents
    // silent duplication on revisit / reload.
    Promise.all([
      getHubItems(),
      getGlobalShortcuts().catch(() => []),
      getGlobalPrompts().catch(() => []),
    ])
      .then(([hubItems, localShortcuts, localPrompts]) => {
        setItems(hubItems);
        const existing = new Set<string>();
        for (const item of hubItems) {
          if (item.kind === 'quick-prompt') {
            if (localShortcuts.some((s) => s.label === item.label && s.command === item.body)) {
              existing.add(item.id);
            }
          } else {
            if (localPrompts.some((p) => p.label === item.label && p.command === item.body)) {
              existing.add(item.id);
            }
          }
        }
        setImportedIds(existing);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load CCWeb Hub'))
      .finally(() => setLoading(false));
  }, []);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    items.forEach((it) => it.tags?.forEach((t) => s.add(t)));
    return [...s].sort();
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (kindFilter !== 'all') list = list.filter((i) => i.kind === kindFilter);
    if (selectedTag === '__untagged__') list = list.filter((i) => !i.tags || i.tags.length === 0);
    else if (selectedTag) list = list.filter((i) => i.tags?.includes(selectedTag));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        i.label.toLowerCase().includes(q) ||
        i.body.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q) ||
        (i.author ?? '').toLowerCase().includes(q) ||
        (i.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [items, kindFilter, selectedTag, search]);

  const handleImport = async (item: HubItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (importingId || importedIds.has(item.id)) return;
    setImportingId(item.id);
    try {
      if (item.kind === 'quick-prompt') {
        await createGlobalShortcut({ label: item.label, command: item.body });
        toast.success(`已导入到全局快捷 Prompts`);
      } else {
        await createGlobalPrompt({ label: item.label, command: item.body });
        toast.success(`已导入到全局 Agent Prompts`);
      }
      setImportedIds((prev) => new Set(prev).add(item.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <h1 className="font-semibold text-lg">CCWeb Hub</h1>
          <div className="flex items-center gap-1 ml-4">
            <button
              onClick={() => setActiveTab('prompts')}
              className={cn(
                'px-3 py-1 rounded-md text-sm transition-colors',
                activeTab === 'prompts' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              Prompts
            </button>
            <button
              onClick={() => setActiveTab('plugins')}
              className={cn(
                'px-3 py-1 rounded-md text-sm transition-colors flex items-center gap-1',
                activeTab === 'plugins' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <Puzzle className="h-3.5 w-3.5" />
              插件
            </button>
          </div>
          <div className="flex-1" />
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={activeTab === 'prompts' ? '搜索 prompt...' : '搜索插件...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* ── Plugins Tab ────────────────────────────────────────────── */}
        {activeTab === 'plugins' && (
          <div>
            {pluginsLoading && (
              <div className="text-center text-muted-foreground py-20">加载中...</div>
            )}

            {!pluginsLoading && (
              <>
                {installedPlugins.length > 0 && (
                  <div className="mb-8">
                    <h2 className="text-sm font-medium text-muted-foreground mb-3">已安装</h2>
                    <div className="space-y-2">
                      {installedPlugins.map((p) => (
                        <div key={p.id} className="rounded-xl border bg-card p-4 flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{p.name}</span>
                              <span className="text-xs text-muted-foreground">v{p.version}</span>
                              <span className={cn(
                                'text-xs px-1.5 py-0.5 rounded',
                                p.enabled ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground',
                              )}>
                                {p.enabled ? '启用' : '禁用'}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</p>
                            {p.permissions.length > 0 && (
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {p.permissions.map((perm) => (
                                  <span key={perm} className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">{perm}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => handleTogglePlugin(p.id, !p.enabled)} title={p.enabled ? '禁用' : '启用'}>
                            <Power className={cn('h-4 w-4', p.enabled ? 'text-green-500' : 'text-muted-foreground')} />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleUninstallPlugin(p.id)} title="卸载">
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h2 className="text-sm font-medium text-muted-foreground mb-3">
                    {installedPlugins.length > 0 ? '更多插件' : '可用插件'}
                  </h2>
                  {hubPlugins.length === 0 && (
                    <div className="text-center text-muted-foreground py-20">
                      <Puzzle className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">Hub 暂无可用插件</p>
                    </div>
                  )}
                  <div className="space-y-2">
                    {hubPlugins
                      .filter((h) => !installedPlugins.some((ip) => ip.id === h.id))
                      .map((item, i) => {
                        const isInstalling = installingId === item.id;
                        return (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25, delay: i * 0.03 }}
                            className="rounded-xl border bg-card p-4 flex items-center gap-4"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{item.name}</span>
                                <span className="text-xs text-muted-foreground">v{item.version}</span>
                                <span className="text-xs text-muted-foreground">by {item.author}</span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                              {item.permissions.length > 0 && (
                                <div className="flex gap-1 mt-1 flex-wrap">
                                  {item.permissions.map((perm) => (
                                    <span key={perm} className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">{perm}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <Button size="sm" disabled={isInstalling} onClick={() => handleInstallPlugin(item)}>
                              <Download className="h-3.5 w-3.5 mr-1" />
                              {isInstalling ? '安装中...' : '安装'}
                            </Button>
                          </motion.div>
                        );
                      })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Prompts Tab ────────────────────────────────────────────── */}
        {activeTab === 'prompts' && (
          <>
            {/* Kind filter */}
            <div className="flex flex-wrap gap-2 mb-3">
              <KindChip active={kindFilter === 'all'} onClick={() => setKindFilter('all')}>全部</KindChip>
              <KindChip active={kindFilter === 'quick-prompt'} onClick={() => setKindFilter('quick-prompt')}>
                <Zap className="h-3 w-3" />Quick Prompts
              </KindChip>
              <KindChip active={kindFilter === 'agent-prompt'} onClick={() => setKindFilter('agent-prompt')}>
                <Sparkles className="h-3 w-3" />Agent Prompts
              </KindChip>
            </div>

            {/* Tag filter */}
            {allTags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                <TagChip active={selectedTag === null} onClick={() => setSelectedTag(null)}>全部标签</TagChip>
                {allTags.map((tag) => (
                  <TagChip key={tag} active={selectedTag === tag} onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}>{tag}</TagChip>
                ))}
              </div>
            )}

            {loading && <div className="text-center text-muted-foreground py-20">加载中...</div>}
            {error && <div className="text-center text-destructive py-20">{error}</div>}

            {!loading && !error && items.length === 0 && (
              <div className="text-center text-muted-foreground py-20">
                <p className="text-lg mb-2">CCWeb Hub 还没有 prompt</p>
                <p className="text-sm">在 Quick Prompts 或 Agent Prompts 卡片上右键选择"共享"来提交第一个吧！</p>
              </div>
            )}

            {!loading && !error && items.length > 0 && filtered.length === 0 && (
              <div className="text-center text-muted-foreground py-20">没有匹配的 prompt</div>
            )}

            <div className="space-y-3">
              {filtered.map((item, i) => {
                const isExpanded = expandedId === item.id;
                const isImported = importedIds.has(item.id);
                const isImporting = importingId === item.id;
                return (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: i * 0.03, ease: 'easeOut' }}
                    className="rounded-xl border bg-card p-4 cursor-pointer hover:border-muted-foreground/30 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn(
                            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                            item.kind === 'quick-prompt'
                              ? 'bg-blue-500/15 text-blue-400'
                              : 'bg-green-500/15 text-green-500',
                          )}>
                            {item.kind === 'quick-prompt' ? <Zap className="h-2.5 w-2.5" /> : <Sparkles className="h-2.5 w-2.5" />}
                            {item.kind === 'quick-prompt' ? 'Quick' : 'Agent'}
                          </span>
                          <h3 className="font-medium text-sm truncate">{item.label}</h3>
                          {item.tags?.map((tag) => (
                            <span key={tag} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                              <Tag className="h-2.5 w-2.5" />{tag}
                            </span>
                          ))}
                        </div>
                        {item.description && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">{item.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          {item.author && (
                            <span className="flex items-center gap-1"><User className="h-3 w-3" />{item.author}</span>
                          )}
                          <code className="text-[10px] opacity-60">{item.file}</code>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          size="sm"
                          variant={isImported ? 'ghost' : 'outline'}
                          disabled={isImporting || isImported}
                          onClick={(e) => void handleImport(item, e)}
                          title={item.kind === 'quick-prompt' ? '导入到全局快捷 Prompts' : '导入到全局 Agent Prompts'}
                        >
                          <Download className="h-3.5 w-3.5 mr-1" />
                          {isImported ? '已导入' : isImporting ? '导入中...' : '导入'}
                        </Button>
                        <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </motion.span>
                      </div>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: 'easeInOut' }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 pt-3 border-t">
                            <pre className="text-xs font-mono bg-muted rounded p-3 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                              {item.body}
                            </pre>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ── Filter chips ────────────────────────────────────────────────────────────

function KindChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

function TagChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1 rounded-full text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
