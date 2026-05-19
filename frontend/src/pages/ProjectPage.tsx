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
import { PreviewDock } from '@/components/PreviewDock';
import { TrackEditorDialog } from '@/components/tracks/flow/TrackEditorDialog';
import { FlowUserInputDialog } from '@/components/tracks/flow/FlowUserInputDialog';
import { useFlowRun } from '@/components/tracks/flow/useFlowRun';
import { runFlow as apiRunFlow, cancelFlow as apiCancelFlow, submitUserInput as apiSubmitUserInput, getFlow as apiGetFlow, getRunState as apiGetRunState } from '@/components/tracks/api';
import { decodeFlow } from '@/components/tracks/flow/flow-sidecar-io';
import type { FlowV3 } from '@/components/tracks/flow/flow-types-v3';
import { Project } from '@/types';
import { ChatMessage, ApprovalRequestEvent, ApprovalResolvedEvent, SemanticUpdate } from '@/lib/websocket';

type ApprovalEventWithSeq = (ApprovalRequestEvent | ApprovalResolvedEvent) & { seq: number };
import { STORAGE_KEYS, usePersistedState } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { bracketedPaste } from '@/lib/ptyPaste';

const LEFT_WIDTH_DEFAULT = 224;
const RIGHT_WIDTH_DEFAULT = 208;
// Left/right panels each host a 36px vertical tab rail; min 200 keeps the
// content area usable at ~164px before truncation gets ugly.
const PANEL_WIDTH_MIN = 200;
const PANEL_WIDTH_MAX = 520;

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);


  // v3 工作轨：监听 ccweb:flow-msg lifecycle 得到 flowActive（锁 chat 输入避免与
  // flow 注入 prompt 串扰 PTY）。v-k 起 minimap 实时可视化移到左侧栏的"工作轨" tab
  // 内（见 TracksLeftPanelContent），ProjectPage 不再渲染右下角悬浮 card。
  const [flowActive, setFlowActive] = useState(false);
  // v-k：编辑工作轨走顶层 Dialog；列表 / 运行可视化都在左侧栏内
  const [editingFlow, setEditingFlow] = useState<{ filename: string } | null>(null);
  const openTrackEditor = useCallback((filename: string) => {
    setEditingFlow({ filename });
  }, []);

  // v-l：抽独立运行 driver — 列表 ▶ 不再弹编辑器 Dialog，运行状态在顶层 useFlowRun
  // 维护，user_input dialog / cancel 都从顶层出。runningFlow 跟踪当前正在跑哪个
  // filename（决定 submitUserInput / cancelFlow API 调用的 filename）。
  const { state: runState, attachRunId: attachTopRun, reset: resetTopRun, hydrateFromBackend: hydrateTopRun } = useFlowRun();
  const [runningFlow, setRunningFlow] = useState<{ filename: string; flow: FlowV3 | null } | null>(null);

  useEffect(() => {
    const onMsg = (ev: Event) => {
      const msg = (ev as CustomEvent<{ type?: string; runId?: string }>).detail;
      if (!msg?.type) return;
      if (msg.type.startsWith('flow_') && !msg.runId) return;
      if (msg.type === 'flow_started' || msg.type === 'flow_user_input_required') setFlowActive(true);
      else if (msg.type === 'flow_done' || msg.type === 'flow_cancelled' ||
               msg.type === 'flow_error' || msg.type === 'flow_node_failed') setFlowActive(false);
    };
    window.addEventListener('ccweb:flow-msg', onMsg);
    return () => window.removeEventListener('ccweb:flow-msg', onMsg);
  }, []);

  // v-l 顶层运行 driver：列表 ▶ / 编辑器 ▶ 都 dispatch ccweb:flow-run-request；
  // cancel 走 ccweb:flow-cancel-request；统一在 ProjectPage 启动 / 取消，
  // FlowUserInputDialog 也在这里渲染（顶层，不依赖编辑器 mount）。
  useEffect(() => {
    if (!id) return;
    const projectId = id;
    const onRunRequest = (ev: Event) => {
      const { filename } = (ev as CustomEvent<{ filename: string }>).detail ?? {};
      if (!filename) return;
      void (async () => {
        try {
          // 同时拉 .flow 给 FlowUserInputDialog 用（拿变量 description 渲染 label）
          const flowRes = await apiGetFlow(projectId, filename);
          const decoded = decodeFlow(flowRes.flow);
          if (!decoded.ok || !decoded.flow) {
            alert(`加载 flow 失败：${decoded.reason ?? 'unknown'}`);
            return;
          }
          setRunningFlow({ filename, flow: decoded.flow });
          const { runId } = await apiRunFlow(projectId, filename);
          attachTopRun(runId);
        } catch (e) {
          const err = e as Error & { status?: number; detail?: { code?: string; runId?: string } };
          if (err.status === 409 && err.detail?.code === 'FLOW_ALREADY_RUNNING' && err.detail.runId) {
            try {
              const state = await apiGetRunState(projectId, err.detail.runId);
              const feStatus = state.status === 'pending' ? 'running' : state.status;
              hydrateTopRun({ ...state, status: feStatus });
            } catch {
              attachTopRun(err.detail.runId);
            }
            return;
          }
          alert(`运行失败：${err.message}`);
          setRunningFlow(null);
        }
      })();
    };
    const onCancelRequest = () => {
      const filename = runningFlow?.filename;
      if (!filename) return;
      // codex P1 #2：runId 可能在 apiRunFlow await 期间还没设；backend 路由支持
      // runId 缺省时按 (projectId, basename) 找 active run 取消，覆盖该 race。
      void apiCancelFlow(projectId, filename, runState.runId ?? undefined).catch(() => {/* WS emits */});
    };
    window.addEventListener('ccweb:flow-run-request', onRunRequest);
    window.addEventListener('ccweb:flow-cancel-request', onCancelRequest);
    return () => {
      window.removeEventListener('ccweb:flow-run-request', onRunRequest);
      window.removeEventListener('ccweb:flow-cancel-request', onCancelRequest);
    };
  }, [id, attachTopRun, hydrateTopRun, runState.runId, runningFlow?.filename]);

  // run 终态后清 runningFlow（让 user_input dialog / cancel 知道没活跃 run）
  useEffect(() => {
    if (runState.status === 'completed' || runState.status === 'failed' || runState.status === 'cancelled') {
      const t = setTimeout(() => { resetTopRun(); setRunningFlow(null); }, 100);
      return () => clearTimeout(t);
    }
  }, [runState.status, resetTopRun]);

  const handleTopSubmitUserInput = async (values: Record<string, unknown>) => {
    if (!id || !runState.runId || !runningFlow) return;
    try {
      await apiSubmitUserInput(id, runningFlow.filename, runState.runId, values);
    } catch (e) {
      alert(`提交失败：${(e as Error).message}`);
    }
  };
  const handleTopCancelUserInput = async () => {
    if (!id || !runState.runId || !runningFlow) return;
    try {
      await apiCancelFlow(id, runningFlow.filename, runState.runId);
    } catch {/* WS will emit */}
    resetTopRun();
    setRunningFlow(null);
  };


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
  //     via `chatOverlayRef.sendCommand`. Strip trailing \r — sendMessage adds it.
  //   - user message + overlay CLOSED → still must wrap in bracketed-paste
  //     markers before raw write, otherwise Ink's paste heuristic leaves
  //     the message stuck in the TUI input box (this is a known regression
  //     path: same user action, but different PTY bytes depending on
  //     overlay visibility). Slash commands bypass bracketed paste
  //     because Claude's `/` picker parses char-by-char.
  //   - non-user data (control keys, arrow keys, Ctrl+C, etc.) → raw PTY write.
  const handlePanelSend = useCallback(async (data: string): Promise<void> => {
    const isUserMessage = data.endsWith('\r');
    if (isUserMessage) {
      const text = data.slice(0, -1);
      if (chatOverlayRef.current) {
        // Await echo confirmation so callers (e.g., ShortcutPanel inheritance
        // chain) can serialize commands instead of guessing with setTimeout.
        // Throw on 'failed' so the caller's try/catch sees the abort signal —
        // a silently-resolved Promise<void> would let an inheritance chain
        // continue past a broken link.
        const result = await chatOverlayRef.current.sendCommand(text);
        if (result === 'failed') throw new Error('chat send failed');
        return;
      }
      // Overlay-closed fallback — bracketed paste for normal text, raw
      // for slash commands. Echo tracking isn't useful here (no UI to
      // consume it), so just wrap + write.
      const isSlash = text.trimStart().startsWith('/');
      const payload = isSlash
        ? text.replace(/\n/g, '\r') + '\r'
        : bracketedPaste(text);
      terminalViewRef.current?.sendTerminalInput(payload);
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

  // When the CLI tool changes (user-driven switch via SwitchCliDialog), the
  // server kills the old PTY and spawns a new one. The xterm scrollback is
  // wiped via the WS `terminal_reset` message, but live in-memory chat /
  // approval / semantic state in this component is from the previous CLI's
  // session and would otherwise linger as stale entries on the new one.
  // Keying on cliTool only — not the whole project — so unrelated mutations
  // (rename, share changes) don't trash the live feed.
  const lastCliToolRef = useRef<string | null>(null);
  useEffect(() => {
    const current = project?.cliTool ?? null;
    if (current && lastCliToolRef.current && current !== lastCliToolRef.current) {
      setChatMessages([]);
      setApprovalEvents([]);
      approvalSeqRef.current = 0;
      setSemanticUpdate(null);
    }
    lastCliToolRef.current = current;
  }, [project?.cliTool]);

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
                cliTool={project.cliTool}
                onSend={handlePanelSend}
                onOpenTrackEditor={openTrackEditor}
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
                  cliTool={project.cliTool}
                  onSend={handlePanelSend}
                  onOpenTrackEditor={openTrackEditor}
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
            <PreviewDock projectId={id} />
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
                  flowActive={flowActive}
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

      {editingFlow && (
        <TrackEditorDialog
          projectId={id}
          filename={editingFlow.filename}
          /* 只有"当前编辑的 flow"和"当前正在运行的 flow"匹配时才透传 runState；否则
             编辑器内显示 idle（避免编辑别的 flow 时显示这条 flow 的运行状态串台）。 */
          runState={runningFlow?.filename === editingFlow.filename ? runState : null}
          open
          onClose={() => setEditingFlow(null)}
        />
      )}

      {/* v-l：顶层 user_input dialog —— 不依赖编辑器 mount，列表 ▶ 启动的
          run 在 user_input 节点也能弹窗收集用户输入 */}
      {runState.pendingUserInput && runningFlow?.flow && (
        <FlowUserInputDialog
          open
          flow={runningFlow.flow}
          pending={runState.pendingUserInput}
          onSubmit={(values) => void handleTopSubmitUserInput(values)}
          onCancel={() => void handleTopCancelUserInput()}
        />
      )}
    </div>
  );
}
