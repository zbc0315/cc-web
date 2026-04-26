import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { WebTerminal, WebTerminalHandle } from '@/components/WebTerminal';
import { TerminalSearch } from '@/components/TerminalSearch';
import { UsageBadge } from '@/components/UsageBadge';
import { useProjectWebSocket, ChatMessage, ContextUpdate, SemanticUpdate, ApprovalRequestEvent, ApprovalResolvedEvent } from '@/lib/websocket';
import { Project } from '@/types';

export interface TerminalViewHandle {
  sendTerminalInput: (data: string) => void;
}

interface TerminalViewProps {
  projectId: string;
  project: Project;
  onStatusChange: (status: string) => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onWsConnected?: () => void;
  onWsDisconnected?: () => void;
  onApprovalRequest?: (evt: ApprovalRequestEvent) => void;
  onApprovalResolved?: (evt: ApprovalResolvedEvent) => void;
  onSemanticUpdate?: (data: SemanticUpdate) => void;
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  ({ projectId, project, onStatusChange, onChatMessage, onWsConnected, onWsDisconnected, onApprovalRequest, onApprovalResolved, onSemanticUpdate }, ref) => {
    const chatMessagesRef = useRef<ChatMessage[]>([]);
    const [showSearch, setShowSearch] = useState(false);
    const [contextData, setContextData] = useState<ContextUpdate | null>(null);

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

    const handleTerminalReset = useCallback(() => {
      webTerminalRef.current?.reset();
    }, []);

    const { subscribeTerminal, sendTerminalInput, sendTerminalResize, subscribeChatMessages } = useProjectWebSocket(
      projectId,
      {
        onTerminalData: handleTerminalData,
        onTerminalReset: handleTerminalReset,
        onStatus: onStatusChange,
        onConnected: () => {
          chatMessagesRef.current = [];
          onWsConnected?.();
          doSubscribe();
        },
        onDisconnected: () => { onWsDisconnected?.(); },
        onChatMessage: (msg) => {
          chatMessagesRef.current.push(msg);
          onChatMessage?.(msg);
        },
        onApprovalRequest: (evt) => onApprovalRequest?.(evt),
        onApprovalResolved: (evt) => onApprovalResolved?.(evt),
        onContextUpdate: (data) => setContextData(data),
        onSemanticUpdate: (data) => onSemanticUpdate?.(data),
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
            cliTool={project?.cliTool}
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
        </div>

        {/* Bottom status bar */}
        <div className="flex-shrink-0 flex items-center px-3 h-7 border-t border-border bg-muted/30 gap-3">
          <UsageBadge />
          {contextData && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">上下文</span>
              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    contextData.usedPercentage < 50 ? 'bg-green-500'
                    : contextData.usedPercentage < 80 ? 'bg-yellow-500'
                    : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(contextData.usedPercentage, 100)}%` }}
                />
              </div>
              <span className={`font-medium ${
                contextData.usedPercentage < 50 ? 'text-green-500'
                : contextData.usedPercentage < 80 ? 'text-yellow-500'
                : 'text-red-500'
              }`}>
                {Math.round(contextData.usedPercentage)}%
              </span>
              <span className="text-muted-foreground/50">
                {contextData.contextWindowSize >= 1000000
                  ? `${(contextData.contextWindowSize / 1000000).toFixed(0)}M`
                  : `${Math.round(contextData.contextWindowSize / 1000)}K`}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }
);

TerminalView.displayName = 'TerminalView';
