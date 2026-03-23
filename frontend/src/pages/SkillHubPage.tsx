import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Download, ChevronDown, ChevronUp, User, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSkillHubSkills, downloadSkillFromHub, type SkillHubItem } from '@/lib/api';
import { cn } from '@/lib/utils';

export function SkillHubPage() {
  const navigate = useNavigate();
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
      alert(err instanceof Error ? err.message : 'Download failed');
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
          {filtered.map((skill) => {
            const isExpanded = expandedId === skill.id;
            const isDownloaded = downloadedIds.has(skill.id);
            const isDownloading = downloadingId === skill.id;

            return (
              <div
                key={skill.id}
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
                    >
                      <Download className="h-3.5 w-3.5 mr-1" />
                      {isDownloaded ? '已下载' : isDownloading ? '下载中...' : '下载'}
                    </Button>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Expanded: show full command */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t">
                    <pre className="text-xs font-mono bg-muted rounded p-3 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                      {skill.command}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
