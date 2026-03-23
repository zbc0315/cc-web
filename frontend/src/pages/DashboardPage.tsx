import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderOpen, LogOut, Terminal, Maximize, Minimize, ChevronDown, ChevronRight, Settings, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProjectCard } from '@/components/ProjectCard';
import { NewProjectDialog } from '@/components/NewProjectDialog';
import { OpenProjectDialog } from '@/components/OpenProjectDialog';
import { getProjects, deleteProject, archiveProject, unarchiveProject, clearToken, getProjectsActivity } from '@/lib/api';
import { UsageBadge } from '@/components/UsageBadge';
import { GlobalShortcutsSection } from '@/components/GlobalShortcutsSection';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Project } from '@/types';

export function DashboardPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [activeProjects, setActiveProjects] = useState<Set<string>>(new Set());
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

  const fetchProjects = async () => {
    try {
      const data = await getProjects();
      setProjects(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProjects();
  }, []);

  // Poll terminal activity every 2 s; pause when tab is hidden
  useEffect(() => {
    const ACTIVE_THRESHOLD_MS = 2000;
    let interval: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const activity = await getProjectsActivity();
        const now = Date.now();
        const active = new Set(
          Object.entries(activity)
            .filter(([, ts]) => typeof ts === 'number' && now - ts < ACTIVE_THRESHOLD_MS)
            .map(([id]) => id)
        );
        setActiveProjects(active);
      } catch {
        // silently ignore — activity badge is non-critical
      }
    };
    const start = () => { void poll(); interval = setInterval(() => void poll(), 2000); };
    const stop = () => { if (interval) { clearInterval(interval); interval = null; } };
    const onVisibility = () => { document.hidden ? stop() : start(); };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const handleLogout = () => {
    clearToken();
    navigate('/login');
  };

  const handleProjectCreated = (project: Project) => {
    setProjects((prev) => [...prev, project]);
  };

  const handleProjectOpened = (project: Project) => {
    setProjects((prev) => [...prev, project]);
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  const handleArchiveProject = async (id: string) => {
    try {
      const updated = await archiveProject(id);
      setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to archive project');
    }
  };

  const handleUnarchiveProject = async (id: string) => {
    try {
      const updated = await unarchiveProject(id);
      setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to restore project');
    }
  };

  const activeList = projects.filter((p) => !p.archived);
  const archivedList = projects.filter((p) => p.archived);

  const handleProjectUpdated = (updated: Project) => {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const cardProps = {
    onDelete: (id: string) => void handleDeleteProject(id),
    onArchive: (id: string) => void handleArchiveProject(id),
    onUnarchive: (id: string) => void handleUnarchiveProject(id),
    onUpdated: handleProjectUpdated,
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
            {activeList.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                active={activeProjects.has(project.id)}
                {...cardProps}
              />
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
              {archivedExpanded
                ? <ChevronDown className="h-4 w-4" />
                : <ChevronRight className="h-4 w-4" />}
              <span className="font-medium">Archived</span>
              <span className="text-xs bg-muted rounded-full px-2 py-0.5">{archivedList.length}</span>
            </button>

            {archivedExpanded && (
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
            )}
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
