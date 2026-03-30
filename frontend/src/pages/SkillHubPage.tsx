import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Search, Download, ChevronDown, User, Tag, GitMerge, Puzzle, Trash2, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  getSkillHubSkills, downloadSkillFromHub, type SkillHubItem,
  getInstalledPlugins, installPlugin, uninstallPlugin, setPluginEnabled,
  type PluginInfo,
} from '@/lib/api';
import { cn } from '@/lib/utils';

type HubTab = 'skills' | 'plugins';

// ── Plugin Hub Item (from GitHub repo plugins.json) ────────────────────────
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

export function SkillHubPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<HubTab>('skills');

  // ── Plugin state ─────────────────────────────────────────────────────────
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

  // ── Skill state ──────────────────────────────────────────────────────────
  const [skills, setSkills] = useState<SkillHubItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    getSkillHubSkills()
      .then(setSkills)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load SkillHub'))
      .finally(() => setLoading(false));
  }, []);

  // Extract all unique tags
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    skills.forEach((s) => s.tags?.forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [skills]);

  const hasUntagged = useMemo(() => skills.some((s) => !s.tags || s.tags.length === 0), [skills]);

  // Filter skills
  const filtered = useMemo(() => {
    let list = skills;

    if (selectedTag === '__untagged__') {
      list = list.filter((s) => !s.tags || s.tags.length === 0);
    } else if (selectedTag) {
      list = list.filter((s) => s.tags?.includes(selectedTag));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q) ||
          s.author.toLowerCase().includes(q) ||
          s.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }

    return list;
  }, [skills, search, selectedTag]);

  const handleDownload = async (skill: SkillHubItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloadingId || downloadedIds.has(skill.id)) return;
    setDownloadingId(skill.id);
    try {
      await downloadSkillFromHub(skill.id);
      setDownloadedIds((prev) => new Set(prev).add(skill.id));
      // Update local download count
      setSkills((prev) =>
        prev.map((s) => (s.id === skill.id ? { ...s, downloads: (s.downloads || 0) + 1 } : s))
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <h1 className="font-semibold text-lg">SkillHub</h1>
          <div className="flex items-center gap-1 ml-4">
            <button
              onClick={() => setActiveTab('skills')}
              className={cn(
                'px-3 py-1 rounded-md text-sm transition-colors',
                activeTab === 'skills' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              技能
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
              placeholder="搜索命令..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* ── Plugins Tab ─────────────────────────────────────────────── */}
        {activeTab === 'plugins' && (
          <div>
            {pluginsLoading && (
              <div className="text-center text-muted-foreground py-20">加载中...</div>
            )}

            {!pluginsLoading && (
              <>
                {/* Installed plugins */}
                {installedPlugins.length > 0 && (
                  <div className="mb-8">
                    <h2 className="text-sm font-medium text-muted-foreground mb-3">已安装</h2>
                    <div className="space-y-2">
                      {installedPlugins.map((p) => (
                        <div key={p.id} className="rounded-lg border bg-card p-4 flex items-center gap-4">
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
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleTogglePlugin(p.id, !p.enabled)}
                            title={p.enabled ? '禁用' : '启用'}
                          >
                            <Power className={cn('h-4 w-4', p.enabled ? 'text-green-500' : 'text-muted-foreground')} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleUninstallPlugin(p.id)}
                            title="卸载"
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hub plugins */}
                <div>
                  <h2 className="text-sm font-medium text-muted-foreground mb-3">
                    {installedPlugins.length > 0 ? '更多插件' : '可用插件'}
                  </h2>
                  {hubPlugins.length === 0 && (
                    <div className="text-center text-muted-foreground py-20">
                      <Puzzle className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">插件中心暂无可用插件</p>
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
                            className="rounded-lg border bg-card p-4 flex items-center gap-4"
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
                            <Button
                              size="sm"
                              disabled={isInstalling}
                              onClick={() => handleInstallPlugin(item)}
                            >
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

        {/* ── Skills Tab ──────────────────────────────────────────────── */}
        {activeTab === 'skills' && <>
        {/* Tag filters */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                selectedTag === null
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              )}
              onClick={() => setSelectedTag(null)}
            >
              全部
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  selectedTag === tag
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                )}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              >
                {tag}
              </button>
            ))}
            {hasUntagged && (
              <button
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  selectedTag === '__untagged__'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                )}
                onClick={() => setSelectedTag(selectedTag === '__untagged__' ? null : '__untagged__')}
              >
                无标签
              </button>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center text-muted-foreground py-20">加载中...</div>
        )}

        {/* Error */}
        {error && (
          <div className="text-center text-destructive py-20">{error}</div>
        )}

        {/* Empty */}
        {!loading && !error && skills.length === 0 && (
          <div className="text-center text-muted-foreground py-20">
            <p className="text-lg mb-2">SkillHub 还没有命令</p>
            <p className="text-sm">在快捷命令面板中点击分享按钮来提交第一个命令吧！</p>
          </div>
        )}

        {/* No results */}
        {!loading && !error && skills.length > 0 && filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-20">
            没有匹配的命令
          </div>
        )}

        {/* Skill cards */}
        <div className="space-y-3">
          {filtered.map((skill, i) => {
            const isExpanded = expandedId === skill.id;
            const isDownloaded = downloadedIds.has(skill.id);
            const isDownloading = downloadingId === skill.id;
            const parentSkill = skill.parentId ? skills.find((s) => s.id === skill.parentId) : undefined;

            return (
              <motion.div
                key={skill.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.03, ease: 'easeOut' }}
                className="rounded-lg border bg-card p-4 cursor-pointer hover:border-muted-foreground/30 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : skill.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-sm truncate">{skill.label}</h3>
                      {skill.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground"
                        >
                          <Tag className="h-2.5 w-2.5" />
                          {tag}
                        </span>
                      ))}
                    </div>
                    {parentSkill && (
                      <div className="flex items-center gap-1 mt-1">
                        <GitMerge className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">继承: {parentSkill.label}</span>
                      </div>
                    )}
                    {skill.description && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">{skill.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {skill.author}
                      </span>
                      <span className="flex items-center gap-1">
                        <Download className="h-3 w-3" />
                        {skill.downloads || 0}
                      </span>
                      <span>{skill.createdAt}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant={isDownloaded ? 'outline' : 'default'}
                      disabled={isDownloading || isDownloaded}
                      onClick={(e) => handleDownload(skill, e)}
                      title={parentSkill ? `将同时下载继承的「${parentSkill.label}」` : undefined}
                    >
                      <Download className="h-3.5 w-3.5 mr-1" />
                      {isDownloaded ? '已下载' : isDownloading ? '下载中...' : '下载'}
                    </Button>
                    <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </motion.span>
                  </div>
                </div>

                {/* Expanded: show full command */}
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
                          {skill.command}
                        </pre>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
        </>}
      </main>
    </div>
  );
}
