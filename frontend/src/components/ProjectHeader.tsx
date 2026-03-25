import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Square, Play, PanelLeft, PanelRight, Maximize, Minimize, UploadCloud, Loader2, MessageSquare, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { stopProject, startProject, triggerBackup, SoundConfig, saveProjectSoundConfig, switchProjectMode } from '@/lib/api';
import { UsageBadge } from '@/components/UsageBadge';
import { ThemeToggle } from '@/components/ThemeToggle';
import SoundSelector from '@/components/SoundSelector';
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
  onToggleFileTree: () => void;
  onToggleShortcuts: () => void;
  onProjectUpdate: (p: Project) => void;
}

export function ProjectHeader({
  project,
  projectId,
  showFileTree,
  showShortcuts,
  onToggleFileTree,
  onToggleShortcuts,
  onProjectUpdate,
}: ProjectHeaderProps) {
  const navigate = useNavigate();
  const [actionLoading, setActionLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [soundConfig, setSoundConfig] = useState<SoundConfig>({
    enabled: false, source: 'preset:rain', playMode: 'auto', volume: 0.5, intervalRange: [3, 8],
  });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Init sound config from project
  useEffect(() => {
    if ((project as any)?.sound) setSoundConfig((project as any).sound);
  }, [project]);

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

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      await triggerBackup(projectId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '备份失败');
    } finally {
      setBackingUp(false);
    }
  };

  const handleSwitchMode = async () => {
    setSwitching(true);
    try {
      const newMode = project.mode === 'chat' ? 'terminal' : 'chat';
      const updated = await switchProjectMode(project.id, newMode);
      onProjectUpdate(updated);
      toast.success(`已切换到 ${newMode === 'chat' ? 'Chat' : 'Terminal'} 模式`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换失败');
    } finally {
      setSwitching(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try { onProjectUpdate(await stopProject(project.id)); }
    catch (err) { console.error(err); }
    finally { setActionLoading(false); }
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
          title="Toggle file tree"
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
          title="Toggle right panel"
        >
          <PanelRight className="h-4 w-4" />
        </button>

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

        <UsageBadge className="mr-2" />
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={toggleFullscreen}
          title={isFullscreen ? '退出全屏' : '全屏'}
        >
          {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
        </Button>

        {/* Sound */}
        <SoundSelector
          projectId={projectId}
          config={soundConfig}
          onChange={(cfg: SoundConfig) => {
            setSoundConfig(cfg);
            void saveProjectSoundConfig(projectId, cfg);
          }}
        />

        {/* Backup */}
        <Button
          variant="outline"
          size="sm"
          className="flex-shrink-0"
          onClick={() => void handleBackup()}
          disabled={backingUp}
          title="备份到云盘"
        >
          {backingUp ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5 mr-1.5" />}
          备份
        </Button>

        {/* Mode switch */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleSwitchMode()}
          disabled={switching || project.status === 'stopped'}
          title={project.mode === 'chat' ? '切换到 Terminal 模式' : '切换到 Chat 模式'}
        >
          {switching
            ? <span className="text-xs animate-spin inline-block">⟳</span>
            : project.mode === 'chat'
              ? <Terminal className="h-4 w-4" />
              : <MessageSquare className="h-4 w-4" />
          }
        </Button>

        {/* Stop / Start */}
        {project.status === 'running' || project.status === 'restarting' ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0"
            onClick={() => void handleStop()}
            disabled={actionLoading}
          >
            <Square className="h-3.5 w-3.5 mr-1.5" />Stop
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0"
            onClick={() => void handleStart()}
            disabled={actionLoading}
          >
            <Play className="h-3.5 w-3.5 mr-1.5" />Start
          </Button>
        )}
      </div>
    </header>
  );
}
