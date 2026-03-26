import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, FolderOpen, LogOut, Terminal, Maximize, Minimize, ChevronRight, Settings, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProjectCard, StatusEntry } from '@/components/ProjectCard';
import { NewProjectDialog } from '@/components/NewProjectDialog';
import { OpenProjectDialog } from '@/components/OpenProjectDialog';
import { toast } from 'sonner';
import { deleteProject, archiveProject, unarchiveProject } from '@/lib/api';
import { useAuthStore, useProjectStore } from '@/lib/stores';
import { useDashboardWebSocket, ActivityUpdate } from '@/lib/websocket';
import { UsageBadge } from '@/components/UsageBadge';
import { GlobalShortcutsSection } from '@/components/GlobalShortcutsSection';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Project } from '@/types';

export function DashboardPage() {
  const navigate = useNavigate();
  const { projects, loading, error, fetchProjects, addProject, updateProject, removeProject } = useProjectStore();
  const clearToken = useAuthStore((s) => s.clearToken);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [activeProjects, setActiveProjects] = useState<Set<string>>(new Set());
  const statusStacksRef = useRef<Map<string, StatusEntry[]>>(new Map());
  const [statusStacks, setStatusStacks] = useState<Map<string, StatusEntry[]>>(new Map());
  const nextIdRef = useRef(0);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [archivedExpanded, setArchivedExpanded] = useState(false);

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

  // Request browser notification permission on first dashboard visit
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  // Activity via WebSocket push (replaces 2s polling)
  const ACTIVE_THRESHOLD_MS = 2000;
  const MAX_STACK = 3;
  const EXPIRE_MS = 8000;

  const handleActivityUpdate = useCallback((update: ActivityUpdate) => {
    const now = Date.now();
    const stacks = statusStacksRef.current;

    if (now - update.lastActivityAt < ACTIVE_THRESHOLD_MS) {
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
  }, []);

  const handleProjectStopped = useCallback((_projectId: string, projectName: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Claude 已完成', {
        body: `项目「${projectName}」的任务已完成`,
        icon: '/terminal.svg',
      });
    }
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
          <Button variant="ghost" size="sm" onClick={() => navigate('/skillhub')} title="SkillHub">
            <Sparkles className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/settings')} title="设置">
            <Settings className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
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

        {loading && (
          <div className="text-center text-muted-foreground py-12">
            Loading projects...
          </div>
        )}

        {error && (
          <div className="text-center text-destructive py-12">
            {error}
          </div>
        )}

        {!loading && !error && projects.length === 0 && (
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

        {/* Active projects */}
        {!loading && !error && activeList.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeList.map((project, i) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05, ease: 'easeOut' }}
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
      </main>

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
    </div>
  );
}
