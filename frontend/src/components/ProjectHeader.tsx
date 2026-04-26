import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Play, PanelLeft, PanelRight, MessageSquare, Maximize, Minimize, Loader2, FolderSync, X, RefreshCw } from 'lucide-react';
import { PomodoroTimer } from '@/components/PomodoroTimer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { startProject, switchProjectCliTool, syncProjectOnce, cancelSyncProject } from '@/lib/api';
import { useSyncEvents } from '@/lib/websocket';
import { useProjectStore } from '@/lib/stores';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SwitchCliDialog } from '@/components/SwitchCliDialog';
import { cliToolLabel } from '@/lib/cli-tools';
import { Project, CliTool } from '@/types';
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
  const [syncFiles, setSyncFiles] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false);
  const [switchLoading, setSwitchLoading] = useState(false);

  // Live rsync telemetry: the HTTP POST stays open for the duration of the
  // sync, so progress has to come via the dashboard WS. Filter by projectId
  // (server broadcasts for every project this user syncs).
  useSyncEvents({
    onStart: (e) => {
      if (e.projectId !== projectId) return;
      setSyncFiles(0);
    },
    onProgress: (e) => {
      if (e.projectId !== projectId) return;
      setSyncFiles(e.filesTransferred);
    },
    // `done` is handled by handleSync's await — just reset counters here in
    // case the event arrives via WS without the HTTP response (e.g. when a
    // scheduled/cron sync runs while the user is looking at this project).
    onDone: (e) => {
      if (e.projectId !== projectId) return;
      setSyncFiles(0);
    },
  });

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
    setSyncFiles(0);
    try {
      const r = await syncProjectOnce(projectId);
      if (r.skipped) {
        toast.info(t('project_header.sync_skipped'));
      } else if (r.ok) {
        toast.success(t('project_header.sync_success', {
          files: r.filesTransferred,
          seconds: Math.round(r.durationMs / 1000),
        }));
      } else if (r.reason === 'cancelled') {
        // User-triggered cancel — handleCancelSync already toasted. Silently
        // swallow here so we don't double-toast.
      } else {
        toast.error(r.reason
          ? t('project_header.sync_failed_with_reason', { reason: r.reason })
          : t('project_header.sync_failed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('project_header.sync_failed'));
    } finally {
      setSyncing(false);
      setSyncFiles(0);
      setCancelling(false);
    }
  };

  const handleCancelSync = async () => {
    if (!syncing || cancelling) return;
    setCancelling(true);
    try {
      const r = await cancelSyncProject(projectId);
      if (r.cancelled) toast.info(t('project_header.sync_cancelled'));
      else toast.error(t('project_header.sync_cancel_failed'));
      // cancelling flag stays true until handleSync's finally clears it, so
      // the spinner text reads "cancelling..." right up to the HTTP response
      // return.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('project_header.sync_cancel_failed'));
      // POST failed — handleSync's finally won't fire (the sync is still
      // running on the server). Clear the flag locally so the button becomes
      // clickable again for a retry.
      setCancelling(false);
    }
  };

  const handleStart = async () => {
    setActionLoading(true);
    try { onProjectUpdate(await startProject(project.id)); }
    catch (err) { console.error(err); }
    finally { setActionLoading(false); }
  };

  const updateProjectInStore = useProjectStore((s) => s.updateProject);

  const handleSwitchCli = async (cliTool: CliTool, continueSession: boolean) => {
    setSwitchLoading(true);
    try {
      const updated = await switchProjectCliTool(project.id, cliTool, continueSession);
      onProjectUpdate(updated);
      // Sync the global store so Dashboard / OpenProjectDialog reflect the new
      // cliTool without a full refetch when the user navigates back.
      updateProjectInStore(updated);
      setSwitchDialogOpen(false);
      toast.success(t('switch_cli.switched_toast', { tool: cliToolLabel(cliTool) }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Re-throw so SwitchCliDialog can display the inline error too. The
      // toast gives a hovering top-of-screen confirmation; the dialog message
      // gives the user the details without losing their picker selection.
      toast.error(t('switch_cli.switch_failed', { reason }));
      throw err;
    } finally {
      setSwitchLoading(false);
    }
  };

  return (
    <header className="border-b border-border flex-shrink-0 bg-muted/50">
      <div className="px-3 h-12 flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="h-5 mx-0.5" />

        {/* Panel toggles — tight group using shadcn active-state pattern
            (bg-accent + font-medium), unified via ghost Button for consistency
            with other header buttons. */}
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7', showFileTree && 'bg-accent')}
          onClick={onToggleFileTree}
          title={t('project_header.toggle_file_tree')}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7', showShortcuts && 'bg-accent')}
          onClick={onToggleShortcuts}
          title={t('project_header.toggle_right_panel')}
        >
          <PanelRight className="h-4 w-4" />
        </Button>
        {project.cliTool !== 'terminal' && (
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-7 w-7', showChatOverlay && 'bg-accent')}
            onClick={onToggleChatOverlay}
            title={t('project_header.toggle_chat_overlay')}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
        )}

        {/* Project info */}
        <div className="flex-1 min-w-0 flex items-center gap-2 ml-2">
          <h1 className="font-semibold text-foreground truncate text-sm">{project.name}</h1>
          <StatusBadge status={project.status} />
          <Badge variant="outline" className="text-xs">
            {project.permissionMode === 'unlimited' ? 'Unlimited' : 'Limited'}
          </Badge>
          {/* CLI tool badge — clickable to swap CLI mid-session.
              On narrow viewports (≤ sm) the text label collapses so the
              header row doesn't overflow next to project name + status +
              permission badges. The icon + tooltip still convey intent. */}
          <button
            type="button"
            onClick={() => setSwitchDialogOpen(true)}
            disabled={switchLoading}
            title={`${t('project_header.switch_cli_title')} (${cliToolLabel(project.cliTool)})`}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-border bg-background hover:bg-accent transition-colors disabled:opacity-50 flex-shrink-0"
          >
            <RefreshCw className="h-3 w-3" />
            <span className="font-medium hidden sm:inline">{cliToolLabel(project.cliTool)}</span>
          </button>
          <span className="text-xs text-muted-foreground font-mono truncate hidden lg:block">
            {project.folderPath}
          </span>
        </div>

        {/* Tool group: ambient utilities (pomodoro / theme / fullscreen) */}
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

        <Separator orientation="vertical" className="h-5 mx-0.5" />

        {/* Sync (rsync). While syncing, the same slot becomes a cancel button
            that SIGTERMs the live rsync; button label shows the running file
            count via dashboard WS (openrsync doesn't support --info=progress2
            so there's no percentage to show). */}
        {syncing ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0"
            onClick={() => void handleCancelSync()}
            disabled={cancelling}
            title={t('project_header.sync_cancel_title')}
          >
            {cancelling
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <X className="h-3.5 w-3.5 mr-1.5" />}
            <span className="tabular-nums">
              {syncFiles > 0
                ? t('project_header.sync_progress_label', { files: syncFiles })
                : t('project_header.sync_progress_label_empty')}
            </span>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0"
            onClick={() => void handleSync()}
            title={t('project_header.sync_button_title')}
          >
            <FolderSync className="h-3.5 w-3.5 mr-1.5" />
            {t('project_header.sync')}
          </Button>
        )}

        <SwitchCliDialog
          open={switchDialogOpen}
          onOpenChange={(o) => { if (!switchLoading) setSwitchDialogOpen(o); }}
          currentCliTool={project.cliTool}
          loading={switchLoading}
          onConfirm={handleSwitchCli}
        />

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
