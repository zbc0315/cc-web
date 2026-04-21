import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Play, PanelLeft, PanelRight, MessageSquare, Maximize, Minimize, Loader2, FolderSync } from 'lucide-react';
import { PomodoroTimer } from '@/components/PomodoroTimer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { startProject, syncProjectOnce } from '@/lib/api';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Project } from '@/types';
import { cn } from '@/lib/utils';

function StatusBadge({ status }: { status: Project['status'] }) {
  const variants = {
    running: 'bg-green-500/10 text-green-600 border-green-500/20',
    stopped: 'bg-muted text-muted-foreground border-border',
    restarting: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border',
        variants[status]
      )}
    >
      <span
        className={cn('w-1.5 h-1.5 rounded-full', {
          'bg-green-500': status === 'running',
          'bg-muted-foreground': status === 'stopped',
          'bg-yellow-400 animate-pulse': status === 'restarting',
        })}
      />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

interface ProjectHeaderProps {
  project: Project;
  projectId: string;
  showFileTree: boolean;
  showShortcuts: boolean;
  showChatOverlay: boolean;
  onToggleFileTree: () => void;
  onToggleShortcuts: () => void;
  onToggleChatOverlay: () => void;
  onProjectUpdate: (p: Project) => void;
}

export function ProjectHeader({
  project,
  projectId,
  showFileTree,
  showShortcuts,
  showChatOverlay,
  onToggleFileTree,
  onToggleShortcuts,
  onToggleChatOverlay,
  onProjectUpdate,
}: ProjectHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [actionLoading, setActionLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await syncProjectOnce(projectId);
      if (r.skipped) {
        toast.info(t('project_header.sync_skipped'));
      } else if (r.ok) {
        toast.success(t('project_header.sync_success', {
          files: r.filesTransferred,
          seconds: Math.round(r.durationMs / 1000),
        }));
      } else {
        toast.error(r.reason
          ? t('project_header.sync_failed_with_reason', { reason: r.reason })
          : t('project_header.sync_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('project_header.sync_failed'));
    } finally {
      setSyncing(false);
    }
  };

  const handleStart = async () => {
    setActionLoading(true);
    try { onProjectUpdate(await startProject(project.id)); }
    catch (err) { console.error(err); }
    finally { setActionLoading(false); }
  };

  return (
    <header className="border-b border-border flex-shrink-0 bg-muted/50">
      <div className="px-3 h-12 flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {/* Panel toggles */}
        <button
          className={cn(
            'p-1 rounded transition-colors',
            showFileTree
              ? 'text-foreground bg-muted'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
          onClick={onToggleFileTree}
          title={t('project_header.toggle_file_tree')}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          className={cn(
            'p-1 rounded transition-colors',
            showShortcuts
              ? 'text-foreground bg-muted'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
          onClick={onToggleShortcuts}
          title={t('project_header.toggle_right_panel')}
        >
          <PanelRight className="h-4 w-4" />
        </button>
        {project.cliTool !== 'terminal' && (
          <button
            className={cn(
              'p-1 rounded transition-colors',
              showChatOverlay
                ? 'text-foreground bg-muted'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
            onClick={onToggleChatOverlay}
            title={t('project_header.toggle_chat_overlay')}
          >
            <MessageSquare className="h-4 w-4" />
          </button>
        )}

        {/* Project info */}
        <div className="flex-1 min-w-0 flex items-center gap-2 ml-1">
          <h1 className="font-semibold text-foreground truncate text-sm">{project.name}</h1>
          <StatusBadge status={project.status} />
          <Badge variant="outline" className="text-xs">
            {project.permissionMode === 'unlimited' ? 'Unlimited' : 'Limited'}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono truncate hidden lg:block">
            {project.folderPath}
          </span>
        </div>

        <PomodoroTimer />
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={toggleFullscreen}
          title={isFullscreen ? t('project_header.fullscreen_exit') : t('project_header.fullscreen_enter')}
        >
          {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
        </Button>

        {/* Sync (rsync) */}
        <Button
          variant="outline"
          size="sm"
          className="flex-shrink-0"
          onClick={() => void handleSync()}
          disabled={syncing}
          title={t('project_header.sync_button_title')}
        >
          {syncing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FolderSync className="h-3.5 w-3.5 mr-1.5" />}
          {t('project_header.sync')}
        </Button>

        {/* Start (only shown when stopped) */}
        {project.status === 'stopped' && (
          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0"
            onClick={() => void handleStart()}
            disabled={actionLoading}
          >
            {/* "Start" kept as an English verb — matches the Claude Code CLI
                button language; no i18n key intentionally. */}
            <Play className="h-3.5 w-3.5 mr-1.5" />Start
          </Button>
        )}
      </div>
    </header>
  );
}
