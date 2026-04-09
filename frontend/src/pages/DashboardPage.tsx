import { useState, useEffect, useRef, useCallback, useMemo, DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, FolderOpen, LogOut, Terminal, Maximize, Minimize, ChevronRight, Settings, Sparkles, Brain, LayoutGrid, Monitor, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProjectCard, StatusEntry } from '@/components/ProjectCard';
import { NewProjectDialog } from '@/components/NewProjectDialog';
import { OpenProjectDialog } from '@/components/OpenProjectDialog';
import { toast } from 'sonner';
import { deleteProject, archiveProject, unarchiveProject, getGlobalPoolIndex, GlobalPoolIndex } from '@/lib/api';
import { MemoryPoolBubbleDialog } from '@/components/MemoryPoolBubbleDialog';
import { notifyProjectStopped } from '@/lib/notify';
import { useAuthStore, useProjectStore } from '@/lib/stores';
import { useDashboardWebSocket, ActivityUpdate } from '@/lib/websocket';
import { STORAGE_KEYS, usePersistedState } from '@/lib/storage';
import { UsageBadge } from '@/components/UsageBadge';
import { GlobalShortcutsSection } from '@/components/GlobalShortcutsSection';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PomodoroTimer } from '@/components/PomodoroTimer';
import { MonitorDashboard } from '@/components/MonitorDashboard';
import { Project } from '@/types';
import { cn } from '@/lib/utils';

export function DashboardPage() {
  const navigate = useNavigate();
  const { projects, loading, error, hasFetched, fetchProjects, addProject, updateProject, removeProject } = useProjectStore();
  const clearToken = useAuthStore((s) => s.clearToken);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [activeProjects, setActiveProjects] = useState<Set<string>>(new Set());
  const statusStacksRef = useRef<Map<string, StatusEntry[]>>(new Map());
  const [statusStacks, setStatusStacks] = useState<Map<string, StatusEntry[]>>(new Map());
  const nextIdRef = useRef(0);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [monitorMode, setMonitorMode] = usePersistedState(STORAGE_KEYS.monitorMode, false, { parse: true });
  const [projectStatuses, setProjectStatuses] = useState<Map<string, 'running' | 'stopped' | 'restarting'>>(new Map());

  // Global memory pool bubble dialog
  const [globalBubbleOpen, setGlobalBubbleOpen] = useState(false);
  const [globalPoolData, setGlobalPoolData] = useState<GlobalPoolIndex | null>(null);

  const handleOpenGlobalBubble = async () => {
    try {
      const data = await getGlobalPoolIndex();
      setGlobalPoolData(data);
      setGlobalBubbleOpen(true);
    } catch (err: any) {
      // 404 = pool not initialized (show empty state); other errors = toast
      if (err?.message?.includes('404') || err?.status === 404) {
        setGlobalPoolData(null);
        setGlobalBubbleOpen(true);
      } else {
        toast.error('无法加载全局记忆池', { description: err?.message });
      }
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  // Notification permission now requested in App.tsx (global)

  // Activity via WebSocket push (replaces 2s polling)
  const MAX_STACK = 3;
  const EXPIRE_MS = 8000;

  const handleActivityUpdate = useCallback((update: ActivityUpdate) => {
    // Sync project status from real-time push to keep cards up-to-date without polling
    if (update.status) {
      const stored = useProjectStore.getState().projects.find((p) => p.id === update.projectId);
      if (stored && stored.status !== update.status) {
        updateProject({ ...stored, status: update.status });
      }
      // Track for monitor dashboard
      setProjectStatuses(prev => {
        const next = new Map(prev);
        next.set(update.projectId, update.status!);
        return next;
      });
    }

    const now = Date.now();
    const stacks = statusStacksRef.current;

    // Use server-side `active` flag (avoids clock skew on LAN)
    if (update.active) {
      setActiveProjects((prev) => {
        if (prev.has(update.projectId)) return prev;
        return new Set(prev).add(update.projectId);
      });

      const stack = stacks.get(update.projectId) ?? [];
      let changed = false;

      if (update.semantic) {
        const latest = stack[stack.length - 1];
        const newLabel = `${update.semantic.phase}:${update.semantic.detail ?? ''}`;
        const oldLabel = latest ? `${latest.phase}:${latest.detail ?? ''}` : '';

        if (newLabel !== oldLabel) {
          stack.push({
            id: nextIdRef.current++,
            phase: update.semantic.phase,
            detail: update.semantic.detail,
            ts: now,
          });
          changed = true;
        } else if (latest) {
          latest.ts = now;
        }
      }

      // Expire old entries + keep max stack
      const filtered = stack.filter((e) => now - e.ts < EXPIRE_MS);
      const trimmed = filtered.length > MAX_STACK ? filtered.slice(-MAX_STACK) : filtered;
      if (trimmed.length !== stack.length) changed = true;
      stacks.set(update.projectId, trimmed);
      if (changed) setStatusStacks(new Map(stacks));
    } else {
      // Inactive
      setActiveProjects((prev) => {
        if (!prev.has(update.projectId)) return prev;
        const next = new Set(prev);
        next.delete(update.projectId);
        return next;
      });
      if (stacks.has(update.projectId) && stacks.get(update.projectId)!.length > 0) {
        stacks.set(update.projectId, []);
        setStatusStacks(new Map(stacks));
      }
    }
  }, [updateProject]);

  const handleProjectStopped = useCallback((projectId: string, projectName: string) => {
    notifyProjectStopped(projectId, projectName);
  }, []);

  useDashboardWebSocket({ onActivityUpdate: handleActivityUpdate, onProjectStopped: handleProjectStopped });

  // Expire stale active projects periodically (since WS only pushes on change)
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const stacks = statusStacksRef.current;
      let changed = false;
      for (const [id, stack] of stacks) {
        const filtered = stack.filter((e) => now - e.ts < EXPIRE_MS);
        if (filtered.length !== stack.length) {
          stacks.set(id, filtered);
          changed = true;
        }
      }
      if (changed) setStatusStacks(new Map(stacks));

      // Clear active for projects without recent activity
      setActiveProjects((prev) => {
        let anyRemoved = false;
        const next = new Set(prev);
        for (const id of prev) {
          const stack = stacks.get(id);
          if (!stack || stack.length === 0) {
            next.delete(id);
            anyRemoved = true;
          }
        }
        return anyRemoved ? next : prev;
      });
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = () => {
    clearToken();
    navigate('/login');
  };

  const handleProjectCreated = (project: Project) => {
    addProject(project);
  };

  const handleProjectOpened = (project: Project) => {
    addProject(project);
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteProject(id);
      removeProject(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  const handleArchiveProject = async (id: string) => {
    try {
      const updated = await archiveProject(id);
      updateProject(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to archive project');
    }
  };

  const handleUnarchiveProject = async (id: string) => {
    try {
      const updated = await unarchiveProject(id);
      updateProject(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restore project');
    }
  };

  const activeList = useMemo(() => projects.filter((p) => !p.archived), [projects]);
  const archivedList = useMemo(() => projects.filter((p) => p.archived), [projects]);

  // Tag filtering
  const allTags = useMemo(() => Array.from(new Set(projects.flatMap((p) => p.tags ?? []))), [projects]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const filteredActive = useMemo(() => {
    if (selectedTags.length === 0) return activeList;
    return activeList.filter((p) => selectedTags.some((t) => p.tags?.includes(t)));
  }, [activeList, selectedTags]);

  // Drag-and-drop ordering (persisted in localStorage)
  const [projectOrder, setProjectOrder] = usePersistedState<string[]>(
    STORAGE_KEYS.projectOrder, [], { parse: true }
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Sync order array when projects are added or removed
  useEffect(() => {
    if (activeList.length === 0) return;
    const activeIds = activeList.map((p) => p.id);
    setProjectOrder((prev) => {
      const kept = prev.filter((id) => activeIds.includes(id));
      const added = activeIds.filter((id) => !prev.includes(id));
      const next = [...kept, ...added];
      if (next.join(',') === prev.join(',')) return prev;
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeList]);

  const orderedActive = useMemo(() => {
    if (projectOrder.length === 0) return filteredActive;
    return [...filteredActive].sort((a, b) => {
      const ai = projectOrder.indexOf(a.id);
      const bi = projectOrder.indexOf(b.id);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [filteredActive, projectOrder]);

  const handleDragStart = useCallback((id: string) => setDraggedId(id), []);
  const handleDragEnd = useCallback(() => { setDraggedId(null); setDragOverId(null); }, []);
  const handleDragOver = useCallback((e: DragEvent, id: string) => {
    e.preventDefault();
    setDragOverId(id);
  }, []);
  const handleDrop = useCallback((e: DragEvent, targetId: string, sourceId: string | null) => {
    e.preventDefault();
    if (!sourceId || sourceId === targetId) { setDragOverId(null); return; }
    setProjectOrder((prev) => {
      const next = [...prev];
      const si = next.indexOf(sourceId);
      const ti = next.indexOf(targetId);
      if (si === -1 || ti === -1) return prev;
      next.splice(si, 1);
      next.splice(ti, 0, sourceId);
      return next;
    });
    setDraggedId(null);
    setDragOverId(null);
  }, [setProjectOrder]);

  const cardProps = {
    onDelete: (id: string) => void handleDeleteProject(id),
    onArchive: (id: string) => void handleArchiveProject(id),
    onUnarchive: (id: string) => void handleUnarchiveProject(id),
    onUpdated: updateProject,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            <span className="font-semibold text-lg">CC Web</span>
          </div>
          <UsageBadge />
          <Button variant="ghost" size="sm" onClick={handleOpenGlobalBubble} title="全局记忆池">
            <Brain className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/skillhub')} title="SkillHub">
            <Sparkles className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/mobile')} title="手机界面">
            <Smartphone className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/settings')} title="设置">
            <Settings className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMonitorMode(!monitorMode)}
            title={monitorMode ? '卡片模式' : '监控大屏'}
            className={cn(monitorMode && 'text-blue-400 bg-blue-500/10')}
          >
            {monitorMode ? <LayoutGrid className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
          <PomodoroTimer />
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </header>

      {/* Monitor mode */}
      {monitorMode && (
        <div className="flex-1 min-h-0">
          <MonitorDashboard projects={projects} projectStatuses={projectStatuses} activeProjectIds={activeProjects} />
        </div>
      )}

      {/* Card mode */}
      {!monitorMode && <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Projects</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Each project runs Claude CLI in a dedicated terminal session.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpenDialogOpen(true)}>
              <FolderOpen className="h-4 w-4 mr-2" />
              Open Project
            </Button>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </div>
        </div>

        {loading && !hasFetched && (
          <div className="text-center text-muted-foreground py-12">
            Loading projects...
          </div>
        )}

        {error && (
          <div className="text-center text-destructive py-12">
            {error}
          </div>
        )}

        {hasFetched && !loading && !error && projects.length === 0 && (
          <div className="text-center py-20">
            <Terminal className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">No projects yet</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Create a new project or open an existing one.
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => setOpenDialogOpen(true)}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Open Project
              </Button>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Project
              </Button>
            </div>
          </div>
        )}

        {/* Tag filter chips */}
        {!loading && !error && allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTags((prev) =>
                  prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                )}
                className={cn(
                  'px-2 py-0.5 rounded-full text-xs border transition-colors',
                  selectedTags.includes(tag)
                    ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                    : 'bg-muted text-muted-foreground border-border hover:border-muted-foreground/40'
                )}
              >
                #{tag}
              </button>
            ))}
            {selectedTags.length > 0 && (
              <button
                onClick={() => setSelectedTags([])}
                className="px-2 py-0.5 rounded-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                清除
              </button>
            )}
          </div>
        )}

        {/* Active projects */}
        {!loading && !error && orderedActive.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {orderedActive.map((project, i) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i * 0.05, 0.3), ease: 'easeOut' }}
                draggable
                onDragStart={() => handleDragStart(project.id)}
                onDragOver={(e) => handleDragOver(e, project.id)}
                onDrop={(e) => handleDrop(e, project.id, draggedId)}
                onDragEnd={handleDragEnd}
                style={{ opacity: draggedId === project.id ? 0.4 : 1, cursor: 'grab' }}
                className={cn(dragOverId === project.id && draggedId !== project.id && 'ring-2 ring-blue-500/50 rounded-xl')}
              >
                <ProjectCard
                  project={project}
                  active={activeProjects.has(project.id)}
                  statusStack={statusStacks.get(project.id) ?? []}
                  {...cardProps}
                />
              </motion.div>
            ))}
          </div>
        )}

        {/* Archived projects */}
        {!loading && !error && archivedList.length > 0 && (
          <div className="mt-10">
            <button
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4 group"
              onClick={() => setArchivedExpanded((v) => !v)}
            >
              <motion.span animate={{ rotate: archivedExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronRight className="h-4 w-4" />
              </motion.span>
              <span className="font-medium">Archived</span>
              <span className="text-xs bg-muted rounded-full px-2 py-0.5">{archivedList.length}</span>
            </button>

            <AnimatePresence>
              {archivedExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {archivedList.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        active={false}
                        {...cardProps}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <GlobalShortcutsSection />
      </main>}

      <NewProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleProjectCreated}
      />

      <OpenProjectDialog
        open={openDialogOpen}
        onOpenChange={setOpenDialogOpen}
        onOpened={handleProjectOpened}
      />

      {globalBubbleOpen && globalPoolData && globalPoolData.balls.length > 0 && (
        <MemoryPoolBubbleDialog
          balls={globalPoolData.balls}
          activeCapacity={globalPoolData.active_capacity}
          onClose={() => setGlobalBubbleOpen(false)}
        />
      )}
      {globalBubbleOpen && (!globalPoolData || globalPoolData.balls.length === 0) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setGlobalBubbleOpen(false)}>
          <div className="bg-popover border rounded-lg p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-muted-foreground">全局记忆池为空</p>
            <p className="text-xs text-muted-foreground mt-1">在项目记忆池中点击"同步全局"以汇总记忆</p>
            <button onClick={() => setGlobalBubbleOpen(false)} className="mt-3 px-3 py-1 text-xs rounded border hover:bg-muted transition-colors">关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}
