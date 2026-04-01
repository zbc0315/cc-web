import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { AnimatePresence } from 'motion/react';
import { WebTerminal, WebTerminalHandle } from '@/components/WebTerminal';
import { TerminalSearch } from '@/components/TerminalSearch';
import { TerminalDraftInput, type FloatPosition } from '@/components/TerminalDraftInput';
import { UsageBadge } from '@/components/UsageBadge';
import { useProjectWebSocket, ChatMessage } from '@/lib/websocket';
import { notifyProjectStopped } from '@/lib/notify';
import { Project } from '@/types';
import { STORAGE_KEYS, getStorage, setStorage } from '@/lib/storage';

type DraftMode = 'bottom' | 'float' | 'hidden';

export interface TerminalViewHandle {
  sendTerminalInput: (data: string) => void;
}

interface TerminalViewProps {
  projectId: string;
  project: Project;
  onStatusChange: (status: string) => void;
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  ({ projectId, project, onStatusChange }, ref) => {
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [showSearch, setShowSearch] = useState(false);

    const draftStateKey = STORAGE_KEYS.draftState(projectId);
    const [draftMode, setDraftModeRaw] = useState<DraftMode>(() => {
      const saved = getStorage<{ mode: DraftMode }>(draftStateKey, { mode: 'float' }, true);
      return saved.mode ?? 'float';
    });
    const setDraftMode = useCallback((updater: DraftMode | ((prev: DraftMode) => DraftMode)) => {
      setDraftModeRaw((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        const saved = getStorage<Record<string, unknown>>(draftStateKey, {}, true);
        setStorage(draftStateKey, { ...saved, mode: next }, true);
        return next;
      });
    }, [draftStateKey]);

    // Default float center: 25vw left, 80vh top (≈ bottom-[20vh])
    const defaultFloatPos = useCallback((): FloatPosition => ({
      x: window.innerWidth * 0.25,
      y: window.innerHeight * 0.8 - 200,
    }), []);

    const [floatPosition, setFloatPositionRaw] = useState<FloatPosition>(() => {
      const saved = getStorage<{ floatX?: number; floatY?: number }>(draftStateKey, {}, true);
      if (saved.floatX != null && saved.floatY != null) return { x: saved.floatX, y: saved.floatY };
      return defaultFloatPos();
    });

    const handleFloatPositionChange = useCallback((pos: FloatPosition) => {
      setFloatPositionRaw(pos);
      const saved = getStorage<Record<string, unknown>>(draftStateKey, {}, true);
      setStorage(draftStateKey, { ...saved, floatX: pos.x, floatY: pos.y }, true);
    }, [draftStateKey]);

    const webTerminalRef = useRef<WebTerminalHandle>(null);
    const terminalDimsRef = useRef<{ cols: number; rows: number } | null>(null);
    const subscribeTerminalRef = useRef<((cols: number, rows: number) => void) | null>(null);
    const subscribeChatMessagesRef = useRef<(() => void) | null>(null);

    const handleTerminalData = useCallback((data: string) => {
      webTerminalRef.current?.write(data);
    }, []);

    const doSubscribe = useCallback(() => {
      const dims = terminalDimsRef.current;
      if (dims && subscribeTerminalRef.current) {
        subscribeTerminalRef.current(dims.cols, dims.rows);
      }
      subscribeChatMessagesRef.current?.();
    }, []);

    const handleProjectStopped = useCallback((stoppedProjectId: string, projectName: string) => {
      notifyProjectStopped(stoppedProjectId, projectName);
    }, []);

    const { subscribeTerminal, sendTerminalInput, sendTerminalResize, subscribeChatMessages } = useProjectWebSocket(
      projectId,
      {
        onTerminalData: handleTerminalData,
        onStatus: onStatusChange,
        onConnected: () => {
          setChatMessages([]);
          doSubscribe();
        },
        onChatMessage: (msg) => {
          setChatMessages((prev) => [...prev, msg]);
        },
        onProjectStopped: handleProjectStopped,
      }
    );

    useEffect(() => {
      subscribeTerminalRef.current = subscribeTerminal;
    }, [subscribeTerminal]);

    useEffect(() => {
      subscribeChatMessagesRef.current = subscribeChatMessages;
    }, [subscribeChatMessages]);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
          e.preventDefault();
          setShowSearch((v) => !v);
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
          e.preventDefault();
          setDraftMode((m) => m === 'float' ? 'hidden' : m === 'hidden' ? 'bottom' : 'float');
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleTerminalReady = useCallback(
      (cols: number, rows: number) => {
        terminalDimsRef.current = { cols, rows };
        doSubscribe();
      },
      [doSubscribe]
    );

    useImperativeHandle(ref, () => ({
      sendTerminalInput,
    }), [sendTerminalInput]);

    // Expose chatMessages for future use (e.g. right panel history tab)
    void chatMessages;

    return (
      <div className="flex-1 overflow-hidden min-w-0 flex flex-col">
        {/* Terminal */}
        <div className="relative flex-1 min-h-0">
          <WebTerminal
            ref={webTerminalRef}
            onInput={sendTerminalInput}
            onResize={(cols, rows) => {
              terminalDimsRef.current = { cols, rows };
              sendTerminalResize(cols, rows);
            }}
            onReady={handleTerminalReady}
          />
          {showSearch && (
            <TerminalSearch
              onSearch={(t, o) => webTerminalRef.current?.search(t, o) ?? false}
              onSearchNext={(t, o) => webTerminalRef.current?.searchNext(t, o) ?? false}
              onSearchPrev={(t, o) => webTerminalRef.current?.searchPrevious(t, o) ?? false}
              onClear={() => webTerminalRef.current?.clearSearch()}
              onClose={() => setShowSearch(false)}
            />
          )}
          <AnimatePresence>
            {draftMode !== 'hidden' && (
              <TerminalDraftInput
                key={draftMode}
                projectId={projectId}
                cliTool={project?.cliTool}
                onSend={sendTerminalInput}
                readOnly={project?._sharedPermission === 'view'}
                displayMode={draftMode}
                floatPosition={floatPosition}
                onFloatPositionChange={handleFloatPositionChange}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Bottom status bar */}
        <div className="flex-shrink-0 flex items-center px-3 h-7 border-t border-border bg-muted/30">
          <UsageBadge />
        </div>
      </div>
    );
  }
);

TerminalView.displayName = 'TerminalView';
