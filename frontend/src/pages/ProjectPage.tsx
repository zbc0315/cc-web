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

type ApprovalEventWithSeq = (ApprovalRequestEvent | ApprovalResolvedEvent) & { seq: number };
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
  // Approval events: each is tagged with a monotonic `seq` so the consumer can
  // advance a cursor instead of using `array.length`. The old
  // `slice(-50)` + length-counter approach silently broke: once the array hit 50,
  // length stopped growing and every subsequent approval was ignored forever.
  const [approvalEvents, setApprovalEvents] = useState<ApprovalEventWithSeq[]>([]);
  const approvalSeqRef = useRef(0);
  const pushApprovalEvent = useCallback(
    (evt: ApprovalRequestEvent | ApprovalResolvedEvent) => {
      approvalSeqRef.current += 1;
      const tagged: ApprovalEventWithSeq = { ...evt, seq: approvalSeqRef.current };
      setApprovalEvents((prev) => {
        // Cap far above what any realistic session produces; just a leak guard.
        const next = [...prev, tagged];
        return next.length > 500 ? next.slice(-500) : next;
      });
    },
    [],
  );
  const [semanticUpdate, setSemanticUpdate] = useState<SemanticUpdate | null>(null);
  const handleApprovalRequest = useCallback(
    (evt: ApprovalRequestEvent) => pushApprovalEvent(evt),
    [pushApprovalEvent],
  );
  const handleApprovalResolved = useCallback(
    (evt: ApprovalResolvedEvent) => pushApprovalEvent(evt),
    [pushApprovalEvent],
  );
  const handleChatMessage = useCallback((msg: ChatMessage) => {
    // Cap at 200 so long sessions don't grow this array unbounded — useChatSession
    // treats it as live tail and does its own block-id dedup against paged history.
    setChatMessages((prev) => {
      const next = [...prev, msg];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);
  const handleWsConnected = useCallback(() => {
    setChatMessages([]);
    setSemanticUpdate(null);
    setWsConnected(true);
  }, []);
  const handleWsDisconnected = useCallback(() => {
    setWsConnected(false);
  }, []);

  // Route shortcut/panel "onSend" through the right pipeline:
  //   - user message (ends with \r) + ChatOverlay mounted → useChatSession.sendMessage
  //     via `chatOverlayRef.sendCommand` (proper condition-driven retry, wake-if-stopped,
  //     queue-on-disconnect, own-echo cleanup). Strip the trailing \r — sendMessage adds it.
  //   - otherwise (control keys, or overlay closed) → raw PTY write, no retry.
  // Deleted the previous ProjectPage-local `sendWithRetry`: its fixed-count retry
  // and "any chat_message clears timer" cleanup were the reincarnation of the
  // pattern called out in CLAUDE.md #19 (cross-turn assistant blocks erase an
  // un-echoed user retry).
  const handlePanelSend = useCallback((data: string) => {
    const isUserMessage = data.endsWith('\r');
    if (isUserMessage && chatOverlayRef.current) {
      chatOverlayRef.current.sendCommand(data.slice(0, -1));
      return;
    }
    terminalViewRef.current?.sendTerminalInput(data);
  }, []);
  const toggleFileTree = () => setShowFileTree((v) => v === 'true' ? 'false' : 'true');
  const toggleShortcuts = () => setShowShortcuts((v) => v === 'true' ? 'false' : 'true');

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
                onSend={handlePanelSend}
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
                onSend={handlePanelSend}
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
                  onSend={handlePanelSend}
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
                  onSend={handlePanelSend}
                />
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      )}
    </div>
  );
}
