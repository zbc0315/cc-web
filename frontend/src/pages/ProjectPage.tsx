import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, FolderOpen, Terminal as TerminalIcon, PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/lib/stores';
import { LeftPanel } from '@/components/LeftPanel';
import { RightPanel } from '@/components/RightPanel';
import { ProjectHeader } from '@/components/ProjectHeader';
import { TerminalView, TerminalViewHandle } from '@/components/TerminalView';
import { ChatOverlay, ChatOverlayHandle } from '@/components/ChatOverlay';
import { Project } from '@/types';
import { ChatMessage, ApprovalRequestEvent, ApprovalResolvedEvent, SemanticUpdate } from '@/lib/websocket';
import { STORAGE_KEYS, usePersistedState } from '@/lib/storage';
import { cn } from '@/lib/utils';

const LEFT_WIDTH_DEFAULT = 224;
const RIGHT_WIDTH_DEFAULT = 208;
const PANEL_WIDTH_MIN = 150;
const PANEL_WIDTH_MAX = 520;

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  // Panel visibility
  const [showFileTree, setShowFileTree] = usePersistedState(STORAGE_KEYS.panelFileTree, 'true');
  const [showShortcuts, setShowShortcuts] = usePersistedState(STORAGE_KEYS.panelShortcuts, 'true');
  const [showChatOverlay, setShowChatOverlay] = usePersistedState(STORAGE_KEYS.chatOverlay(id ?? ''), 'true');
  const toggleChatOverlay = useCallback(() => setShowChatOverlay((v) => v === 'true' ? 'false' : 'true'), [setShowChatOverlay]);

  // Chat messages from WS (lifted from TerminalView)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [approvalEvents, setApprovalEvents] = useState<(ApprovalRequestEvent | ApprovalResolvedEvent)[]>([]);
  const [semanticUpdate, setSemanticUpdate] = useState<SemanticUpdate | null>(null);
  const handleApprovalRequest = useCallback((evt: ApprovalRequestEvent) => {
    setApprovalEvents((prev) => [...prev.slice(-50), evt]);
  }, []);
  const handleApprovalResolved = useCallback((evt: ApprovalResolvedEvent) => {
    setApprovalEvents((prev) => [...prev.slice(-50), evt]);
  }, []);
  const sendRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleChatMessage = useCallback((msg: ChatMessage) => {
    setChatMessages((prev) => [...prev, msg]);
    // Any CLI response → clear shortcut retry timer
    if (sendRetryRef.current) {
      clearTimeout(sendRetryRef.current);
      sendRetryRef.current = null;
    }
  }, []);
  const handleWsConnected = useCallback(() => {
    setChatMessages([]);
    setSemanticUpdate(null);
    setWsConnected(true);
  }, []);
  const handleWsDisconnected = useCallback(() => {
    setWsConnected(false);
  }, []);

  // Wrap sendTerminalInput with retry: if CLI doesn't echo back within 3s, resend \r
  const sendWithRetry = useCallback((data: string) => {
    // If overlay is open, optimistically append the user bubble
    if (data.endsWith('\r')) {
      chatOverlayRef.current?.appendUserMessage(data);
    }
    terminalViewRef.current?.sendTerminalInput(data);
    // Only retry for commands that end with \r (user-submitted input)
    if (!data.endsWith('\r')) return;
    if (sendRetryRef.current) clearTimeout(sendRetryRef.current);
    const MAX_RETRY = 3;
    let attempt = 0;
    const scheduleRetry = () => {
      if (attempt >= MAX_RETRY) { sendRetryRef.current = null; return; }
      sendRetryRef.current = setTimeout(() => {
        attempt++;
        terminalViewRef.current?.sendTerminalInput('\r');
        scheduleRetry();
      }, 3000);
    };
    scheduleRetry();
  }, []);
  const toggleFileTree = () => setShowFileTree((v) => v === 'true' ? 'false' : 'true');
  const toggleShortcuts = () => setShowShortcuts((v) => v === 'true' ? 'false' : 'true');

  // Cleanup retry timer on unmount
  useEffect(() => () => { if (sendRetryRef.current) clearTimeout(sendRetryRef.current); }, []);

  // Panel widths (persisted as strings)
  const [leftWidthStr, setLeftWidthStr] = usePersistedState(STORAGE_KEYS.panelLeftWidth, String(LEFT_WIDTH_DEFAULT));
  const [rightWidthStr, setRightWidthStr] = usePersistedState(STORAGE_KEYS.panelRightWidth, String(RIGHT_WIDTH_DEFAULT));
  const leftWidth = parseInt(leftWidthStr, 10) || LEFT_WIDTH_DEFAULT;
  const rightWidth = parseInt(rightWidthStr, 10) || RIGHT_WIDTH_DEFAULT;

  // Refs for direct DOM manipulation during drag (avoids re-renders on every pixel)
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  const terminalViewRef = useRef<TerminalViewHandle>(null);
  const chatOverlayRef = useRef<ChatOverlayHandle>(null);

  // Plan event state (lifted from TerminalView so LeftPanel can reactively re-render)
  const [planStatus, setPlanStatus] = useState<any>(null);
  const [planNodeUpdate, setPlanNodeUpdate] = useState<any>(null);
  const [planReplan, setPlanReplan] = useState(0);

  // Ctrl+I to toggle chat overlay (skip for SSH-only projects)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'i' && project?.cliTool !== 'terminal') {
        e.preventDefault();
        toggleChatOverlay();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleChatOverlay, project?.cliTool]);

  // Mobile layout
  type MobilePanel = 'files' | 'terminal' | 'panel';
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('terminal');
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load project from store
  const { fetchProjects, hasFetched } = useProjectStore();

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      if (!hasFetched) await fetchProjects();
      const proj = useProjectStore.getState().projects.find((p) => p.id === id) ?? null;
      setProject(proj);
      setLoading(false);
    };
    void load();
  }, [id, hasFetched, fetchProjects]);

  // ── Resize handlers ───────────────────────────────────────────────────────────

  const startDragLeft = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftPanelRef.current?.offsetWidth ?? leftWidth;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const w = Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, startWidth + (ev.clientX - startX)));
      if (leftPanelRef.current) leftPanelRef.current.style.width = w + 'px';
    };

    const onUp = (ev: MouseEvent) => {
      const w = Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, startWidth + (ev.clientX - startX)));
      setLeftWidthStr(String(w));
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startDragRight = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelRef.current?.offsetWidth ?? rightWidth;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const w = Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, startWidth - (ev.clientX - startX)));
      if (rightPanelRef.current) rightPanelRef.current.style.width = w + 'px';
    };

    const onUp = (ev: MouseEvent) => {
      const w = Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, startWidth - (ev.clientX - startX)));
      setRightWidthStr(String(w));
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

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
      <ProjectHeader
        project={project}
        projectId={id}
        showFileTree={showFileTree === 'true'}
        showShortcuts={showShortcuts === 'true'}
        showChatOverlay={showChatOverlay === 'true'}
        onToggleFileTree={toggleFileTree}
        onToggleShortcuts={toggleShortcuts}
        onToggleChatOverlay={toggleChatOverlay}
        onProjectUpdate={setProject}
      />

      {isMobile ? (
        /* Mobile: single column + bottom tab nav */
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="flex-1 overflow-hidden min-h-0">
            {mobilePanel === 'files' && (
              <LeftPanel
                projectPath={project.folderPath}
                projectId={id}
                planStatus={planStatus}
                planNodeUpdate={planNodeUpdate}
                planReplan={planReplan}
                onSend={sendWithRetry}
              />
            )}
            {mobilePanel === 'terminal' && (
              <TerminalView
                ref={terminalViewRef}
                projectId={id}
                project={project}
                onStatusChange={(status) =>
                  setProject((prev) => (prev ? { ...prev, status: status as Project['status'] } : prev))
                }
                onPlanStatus={setPlanStatus}
                onPlanNodeUpdate={setPlanNodeUpdate}
                onPlanReplan={() => setPlanReplan(prev => prev + 1)}
              />
            )}
            {mobilePanel === 'panel' && (
              <RightPanel
                projectId={id}
                onSend={sendWithRetry}
              />
            )}
          </div>

          {/* Bottom Tab Nav */}
          <div className="flex-shrink-0 flex border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
            {([
              { id: 'files' as MobilePanel, icon: FolderOpen, label: '文件' },
              { id: 'terminal' as MobilePanel, icon: TerminalIcon, label: '终端' },
              { id: 'panel' as MobilePanel, icon: PanelRight, label: '快捷' },
            ]).map(({ id: panelId, icon: Icon, label }) => (
              <button
                key={panelId}
                onClick={() => setMobilePanel(panelId)}
                className={cn(
                  'flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors',
                  mobilePanel === panelId
                    ? 'text-blue-400'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Desktop: 3-column layout with resizable panels */
        <div className="flex-1 overflow-hidden flex min-h-0">

          {/* Left panel */}
          <AnimatePresence initial={false}>
            {showFileTree === 'true' && (
              <motion.div
                ref={leftPanelRef}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: leftWidth, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="flex-shrink-0 overflow-hidden"
              >
                <LeftPanel
                  projectPath={project.folderPath}
                  projectId={id}
                  planStatus={planStatus}
                  planNodeUpdate={planNodeUpdate}
                  planReplan={planReplan}
                  onSend={sendWithRetry}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Left resize handle */}
          {showFileTree === 'true' && (
            <div
              onMouseDown={startDragLeft}
              className="w-1 flex-shrink-0 bg-border hover:bg-blue-500/60 active:bg-blue-500/80 cursor-col-resize transition-colors"
            />
          )}

          {/* Center: Terminal + ChatOverlay */}
          <div className="flex-1 overflow-hidden min-w-0 relative flex flex-col">
            <TerminalView
              ref={terminalViewRef}
              projectId={id}
              project={project}
              onStatusChange={(status) =>
                setProject((prev) => (prev ? { ...prev, status: status as Project['status'] } : prev))
              }
              onChatMessage={handleChatMessage}
              onWsConnected={handleWsConnected}
              onWsDisconnected={handleWsDisconnected}
              onApprovalRequest={handleApprovalRequest}
              onApprovalResolved={handleApprovalResolved}
              onSemanticUpdate={setSemanticUpdate}
              onPlanStatus={setPlanStatus}
              onPlanNodeUpdate={setPlanNodeUpdate}
              onPlanReplan={() => setPlanReplan(prev => prev + 1)}
            />
            <AnimatePresence>
              {showChatOverlay === 'true' && project.cliTool !== 'terminal' && (
                <ChatOverlay
                  ref={chatOverlayRef}
                  key="chat-overlay"
                  projectId={id}
                  project={project}
                  liveMessages={chatMessages}
                  approvalEvents={approvalEvents}
                  semanticUpdate={semanticUpdate}
                  wsConnected={wsConnected}
                  onSend={(data) => terminalViewRef.current?.sendTerminalInput(data)}
                  onClose={toggleChatOverlay}
                />
              )}
            </AnimatePresence>
          </div>

          {/* Right resize handle */}
          {showShortcuts === 'true' && (
            <div
              onMouseDown={startDragRight}
              className="w-1 flex-shrink-0 bg-border hover:bg-blue-500/60 active:bg-blue-500/80 cursor-col-resize transition-colors"
            />
          )}

          {/* Right panel */}
          <AnimatePresence initial={false}>
            {showShortcuts === 'true' && (
              <motion.div
                ref={rightPanelRef}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: rightWidth, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="flex-shrink-0 overflow-hidden"
              >
                <RightPanel
                  projectId={id}
                  onSend={sendWithRetry}
                />
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      )}
    </div>
  );
}
