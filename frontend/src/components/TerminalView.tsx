import React, { Suspense, useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Terminal, MessageSquare } from 'lucide-react';
import { WebTerminal, WebTerminalHandle } from '@/components/WebTerminal';
import { TerminalSearch } from '@/components/TerminalSearch';
import { TerminalDraftInput } from '@/components/TerminalDraftInput';
import { UsageBadge } from '@/components/UsageBadge';
const ChatView = React.lazy(() => import('@/components/ChatView').then((m) => ({ default: m.ChatView })));
import { useProjectWebSocket, ChatMessage } from '@/lib/websocket';
import { Project } from '@/types';
import { cn } from '@/lib/utils';
import { STORAGE_KEYS, usePersistedState } from '@/lib/storage';

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
    const [viewMode, setViewMode] = usePersistedState(STORAGE_KEYS.viewMode(projectId), 'terminal');
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [showSearch, setShowSearch] = useState(false);
    const [showDraft, setShowDraft] = useState(true);

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
          if (viewMode === 'terminal') {
            e.preventDefault();
            setShowSearch((v) => !v);
          }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
          if (viewMode === 'terminal') {
            e.preventDefault();
            setShowDraft((v) => !v);
          }
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [viewMode]);

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
      <>
        <div className="flex-1 overflow-hidden min-w-0 flex flex-col">
          {/* Tab bar */}
          <div className="flex items-center border-b border-border bg-muted/30 px-2 h-8 flex-shrink-0">
            <button
              onClick={() => setViewMode('terminal')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 text-xs rounded-t transition-colors',
                viewMode === 'terminal'
                  ? 'bg-background text-foreground border border-b-0 border-border -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Terminal className="h-3 w-3" />
              终端
            </button>
            <button
              onClick={() => setViewMode('chat')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 text-xs rounded-t transition-colors',
                viewMode === 'chat'
                  ? 'bg-background text-foreground border border-b-0 border-border -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <MessageSquare className="h-3 w-3" />
              对话
            </button>
          </div>

          {/* Terminal (always mounted, hidden when chat active) */}
          <div className={cn('relative flex-1 min-h-0', viewMode !== 'terminal' && 'hidden')}>
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
            {showDraft && (
              <TerminalDraftInput
                projectId={projectId}
                onSend={sendTerminalInput}
                readOnly={project?._sharedPermission === 'view'}
              />
            )}
          </div>

          {/* Chat history view */}
          <AnimatePresence>
            {viewMode === 'chat' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex-1 min-h-0"
              >
                <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
                  <ChatView
                    messages={chatMessages}
                    onSend={sendTerminalInput}
                    readOnly={project?._sharedPermission === 'view'}
                  />
                </Suspense>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom status bar */}
          <div className="flex-shrink-0 flex items-center px-3 h-7 border-t border-border bg-muted/30">
            <UsageBadge />
          </div>
        </div>

      </>
    );
  }
);

TerminalView.displayName = 'TerminalView';
