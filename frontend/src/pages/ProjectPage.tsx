import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Square, Play, PanelLeft, PanelRight, Maximize, Minimize, UploadCloud, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { WebTerminal, WebTerminalHandle } from '@/components/WebTerminal';
import { FileTree } from '@/components/FileTree';
import { RightPanel } from '@/components/RightPanel';
import { getProjects, stopProject, startProject, triggerBackup, SoundConfig, saveProjectSoundConfig } from '@/lib/api';
import { UsageBadge } from '@/components/UsageBadge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SoundPlayer } from '@/components/SoundPlayer';
import SoundSelector from '@/components/SoundSelector';
import { useProjectWebSocket } from '@/lib/websocket';
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

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [soundConfig, setSoundConfig] = useState<SoundConfig>({
    enabled: false, source: 'preset:rain', playMode: 'auto', volume: 0.5, intervalRange: [3, 8],
  });
  const [llmActive, setLlmActive] = useState(false);
  const llmIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBackup = async () => {
    if (!id) return;
    setBackingUp(true);
    try {
      await triggerBackup(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : '备份失败');
    } finally {
      setBackingUp(false);
    }
  };

  // Panel visibility — persisted per-session in localStorage
  const [showFileTree, setShowFileTree] = useState<boolean>(() => {
    try { return localStorage.getItem('cc_panel_filetree') !== 'false'; } catch { return true; }
  });
  const [showShortcuts, setShowShortcuts] = useState<boolean>(() => {
    try { return localStorage.getItem('cc_panel_shortcuts') !== 'false'; } catch { return true; }
  });
  const toggleFileTree = () =>
    setShowFileTree((v) => { localStorage.setItem('cc_panel_filetree', String(!v)); return !v; });
  const toggleShortcuts = () =>
    setShowShortcuts((v) => { localStorage.setItem('cc_panel_shortcuts', String(!v)); return !v; });

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

  const webTerminalRef = useRef<WebTerminalHandle>(null);
  const terminalDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  const subscribeTerminalRef = useRef<((cols: number, rows: number) => void) | null>(null);

  const handleTerminalData = useCallback((data: string) => {
    webTerminalRef.current?.write(data);
    // LLM activity detection for sound
    setLlmActive(true);
    if (llmIdleTimerRef.current) clearTimeout(llmIdleTimerRef.current);
    llmIdleTimerRef.current = setTimeout(() => setLlmActive(false), 3000);
  }, []);

  const doSubscribe = useCallback(() => {
    const dims = terminalDimsRef.current;
    if (dims && subscribeTerminalRef.current) {
      subscribeTerminalRef.current(dims.cols, dims.rows);
    }
  }, []);

  const { subscribeTerminal, sendTerminalInput, sendTerminalResize } = useProjectWebSocket(
    id ?? '',
    {
      onTerminalData: handleTerminalData,
      onStatus: (status) =>
        setProject((prev) => (prev ? { ...prev, status: status as Project['status'] } : prev)),
      onConnected: doSubscribe,
    }
  );

  useEffect(() => {
    subscribeTerminalRef.current = subscribeTerminal;
  }, [subscribeTerminal]);

  const handleTerminalReady = useCallback(
    (cols: number, rows: number) => {
      terminalDimsRef.current = { cols, rows };
      doSubscribe();
    },
    [doSubscribe]
  );

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      try {
        const projects = await getProjects();
        const proj = projects.find((p) => p.id === id) ?? null;
        setProject(proj);
        if ((proj as any)?.sound) setSoundConfig((proj as any).sound);
      } catch (err) {
        console.error('Failed to load project:', err);
      } finally {
        setLoading(false);
      }
    };
    void fetch();
  }, [id]);

  const handleStop = async () => {
    if (!project) return;
    setActionLoading(true);
    try { setProject(await stopProject(project.id)); }
    catch (err) { console.error(err); }
    finally { setActionLoading(false); }
  };

  const handleStart = async () => {
    if (!project) return;
    setActionLoading(true);
    try { setProject(await startProject(project.id)); }
    catch (err) { console.error(err); }
    finally { setActionLoading(false); }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <span className="text-muted-foreground text-sm">Loading…</span>
      </div>
    );
  }

  if (!project || !id) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <p className="text-muted-foreground">Project not found.</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-2" />Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-border flex-shrink-0 bg-muted/50">
        <div className="px-3 h-12 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => navigate('/')}
          >
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
            onClick={toggleFileTree}
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
            onClick={toggleShortcuts}
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
          {id && (
            <SoundSelector
              projectId={id}
              config={soundConfig}
              onChange={(cfg: SoundConfig) => {
                setSoundConfig(cfg);
                void saveProjectSoundConfig(id, cfg);
              }}
            />
          )}

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

      {/* ── Three-column body ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex min-h-0">

        {/* Left: File tree */}
        {showFileTree && (
          <div className="w-56 flex-shrink-0 border-r border-border overflow-hidden">
            <FileTree projectPath={project.folderPath} />
          </div>
        )}

        {/* Center: Terminal */}
        <div className="flex-1 overflow-hidden min-w-0">
          <WebTerminal
            ref={webTerminalRef}
            onInput={sendTerminalInput}
            onResize={(cols, rows) => {
              terminalDimsRef.current = { cols, rows };
              sendTerminalResize(cols, rows);
            }}
            onReady={handleTerminalReady}
          />
        </div>

        {/* Right: Shortcuts / History tabs */}
        {showShortcuts && (
          <div className="w-52 flex-shrink-0 border-l border-border overflow-hidden">
            <RightPanel projectId={id} onSend={sendTerminalInput} />
          </div>
        )}
      </div>

      {/* Sound player (invisible) */}
      {id && <SoundPlayer projectId={id} config={soundConfig} isActive={llmActive} />}
    </div>
  );
}
