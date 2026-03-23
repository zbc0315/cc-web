# Chat View Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chat display mode to the project page that shows Claude conversations as a clean chat UI alongside the existing terminal.

**Architecture:** SessionManager gets a listener registry to push parsed JSONL messages through the existing WebSocket. Frontend adds a ChatView component next to WebTerminal, switchable via tabs. User input flows through PTY via sendTerminalInput.

**Tech Stack:** React, xterm.js (existing), WebSocket (existing), ReactMarkdown + remarkGfm (existing)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/session-manager.ts` | Modify | Add `ChatBlock` type, `parseLineBlocks()`, chat listener registry, emit in `readNewLines` |
| `backend/src/index.ts` | Modify | Handle `chat_subscribe` WS message, register/unregister listeners on connect/close |
| `frontend/src/lib/websocket.ts` | Modify | Add `subscribeChatMessages()`, `onChatMessage` callback, handle `chat_message` type |
| `frontend/src/components/ChatView.tsx` | Create | Chat message list + input bar component |
| `frontend/src/pages/ProjectPage.tsx` | Modify | Add tab bar, viewMode state, wire ChatView |

---

### Task 1: Backend — ChatBlock type and parseLineBlocks

**Files:**
- Modify: `backend/src/session-manager.ts:29-44` (types section)
- Modify: `backend/src/session-manager.ts:243-262` (after existing parseLine)

- [ ] **Step 1: Add ChatBlock type and parseLineBlocks method**

Add after the existing `ClaudeRecord` interface (line 44):

```typescript
export interface ChatBlockItem {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  content: string;
}

export interface ChatBlock {
  role: 'user' | 'assistant';
  timestamp: string;
  blocks: ChatBlockItem[];
}
```

Add new method after `parseLine` (line 262):

```typescript
private parseLineBlocks(line: string): ChatBlock | null {
  let record: ClaudeRecord;
  try { record = JSON.parse(line) as ClaudeRecord; } catch { return null; }
  const ts = record.timestamp ?? new Date().toISOString();

  if (record.type === 'user' && record.message?.role === 'user') {
    const text = extractText(record.message.content);
    if (!text || isInternalUserMessage(text)) return null;
    return { role: 'user', timestamp: ts, blocks: [{ type: 'text', content: text }] };
  }

  if (record.type === 'assistant' && record.message?.role === 'assistant') {
    const content = record.message.content;
    if (!content) return null;
    if (typeof content === 'string') {
      const trimmed = content.trim();
      return trimmed ? { role: 'assistant', timestamp: ts, blocks: [{ type: 'text', content: trimmed }] } : null;
    }
    const blocks: ChatBlockItem[] = [];
    for (const b of content) {
      if (b.type === 'text' && b.text?.trim()) {
        blocks.push({ type: 'text', content: b.text.trim() });
      } else if (b.type === 'thinking' && b.text?.trim()) {
        blocks.push({ type: 'thinking', content: b.text.trim() });
      } else if (b.type === 'tool_use') {
        const name = (b as any).name ?? 'tool';
        const input = (b as any).input ? JSON.stringify((b as any).input).slice(0, 200) : '';
        blocks.push({ type: 'tool_use', content: `${name}(${input})` });
      } else if (b.type === 'tool_result' && b.text?.trim()) {
        blocks.push({ type: 'tool_result', content: b.text.trim() });
      }
    }
    return blocks.length > 0 ? { role: 'assistant', timestamp: ts, blocks } : null;
  }

  return null;
}
```

- [ ] **Step 2: Build backend and verify no errors**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/session-manager.ts
git commit -m "feat: add ChatBlock type and parseLineBlocks to SessionManager"
```

---

### Task 2: Backend — Chat listener registry and emission

**Files:**
- Modify: `backend/src/session-manager.ts` (class body: listener map + register/unregister + readNewLines modification)

- [ ] **Step 1: Add listener registry to SessionManager class**

Add as class fields (after `private watchers` on line 109):

```typescript
private chatListeners = new Map<string, Set<(msg: ChatBlock) => void>>();

registerChatListener(projectId: string, cb: (msg: ChatBlock) => void): void {
  if (!this.chatListeners.has(projectId)) this.chatListeners.set(projectId, new Set());
  this.chatListeners.get(projectId)!.add(cb);
}

unregisterChatListener(projectId: string, cb: (msg: ChatBlock) => void): void {
  const listeners = this.chatListeners.get(projectId);
  if (!listeners) return;
  listeners.delete(cb);
  if (listeners.size === 0) this.chatListeners.delete(projectId);
}
```

- [ ] **Step 2: Emit chat blocks in readNewLines**

In `readNewLines` method (around line 222), after the `for (const line of lines)` loop that builds `newMsgs`, add a second loop that parses blocks and emits to listeners:

```typescript
// Emit to chat listeners
const listeners = this.chatListeners.get(projectId);
if (listeners && listeners.size > 0) {
  for (const line of lines) {
    const block = this.parseLineBlocks(line);
    if (block) {
      for (const cb of listeners) {
        try { cb(block); } catch { /**/ }
      }
    }
  }
}
```

Insert this right after `if (newMsgs.length > 0) { this.appendMessages(...); changed = true; }` and before the `if (changed)` log.

- [ ] **Step 3: Build and verify**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/session-manager.ts
git commit -m "feat: add chat listener registry and emit in readNewLines"
```

---

### Task 3: Backend — WS chat_subscribe handler

**Files:**
- Modify: `backend/src/index.ts:425-465` (WS message switch + close handler)

- [ ] **Step 1: Add chat_subscribe case and cleanup**

In the WS message switch (after `terminal_resize` case, around line 450), add:

```typescript
case 'chat_subscribe':
  sessionManager.registerChatListener(projectId, chatListener);
  break;
```

Before the switch block (inside the `ws.on('message', ...)` handler, after `authenticated` is confirmed), define the listener closure. Add it near line 410 (after the `wsReadOnly` declaration area, but accessible by the switch):

Actually, the cleanest place: add the `chatListener` as a per-connection variable next to `wsReadOnly`. Near line 348:

```typescript
let wsReadOnly = false;
const chatListener = (msg: ChatBlock) => {
  try { ws.send(JSON.stringify({ type: 'chat_message', ...msg })); } catch { /**/ }
};
```

Add import of `ChatBlock` from session-manager at the top of index.ts:

```typescript
import { sessionManager, ChatBlock } from './session-manager';
```

(Verify sessionManager is already imported — just add `ChatBlock` to the import.)

In the `ws.on('close', ...)` handler (line 458), add cleanup:

```typescript
sessionManager.unregisterChatListener(projectId, chatListener);
```

- [ ] **Step 2: Build and verify**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat: handle chat_subscribe in WS, push chat_message to clients"
```

---

### Task 4: Frontend — Extend WebSocket hook

**Files:**
- Modify: `frontend/src/lib/websocket.ts`

- [ ] **Step 1: Add ChatMessage type and extend hook**

Add type at top (after imports):

```typescript
export interface ChatBlockItem {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  content: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  timestamp: string;
  blocks: ChatBlockItem[];
}
```

Add to `UseProjectWebSocketOptions`:

```typescript
onChatMessage?: (msg: ChatMessage) => void;
```

Add to `IncomingMessage` union:

```typescript
| { type: 'chat_message'; role: string; timestamp: string; blocks: ChatBlockItem[] }
```

Add new case in `ws.onmessage` switch (after `status` case):

```typescript
case 'chat_message': {
  const cm = parsed as { type: 'chat_message'; role: 'user' | 'assistant'; timestamp: string; blocks: ChatBlockItem[] };
  optionsRef.current.onChatMessage?.(cm);
  break;
}
```

Add `subscribeChatMessages` function (after `sendTerminalResize`):

```typescript
const subscribeChatMessages = useCallback(() => {
  rawSend({ type: 'chat_subscribe' });
}, [rawSend]);
```

Update the return statement:

```typescript
return { subscribeTerminal, sendTerminalInput, sendTerminalResize, subscribeChatMessages };
```

- [ ] **Step 2: Build frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (ProjectPage doesn't use new fields yet)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/websocket.ts
git commit -m "feat: add chat_subscribe and onChatMessage to WS hook"
```

---

### Task 5: Frontend — ChatView component

**Files:**
- Create: `frontend/src/components/ChatView.tsx`

- [ ] **Step 1: Create ChatView component**

```tsx
import { useState, useRef, useEffect } from 'react';
import { Send, ChevronRight, Brain, Wrench, FileOutput } from 'lucide-react';
import { ChatMessage, ChatBlockItem } from '@/lib/websocket';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatViewProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  readOnly?: boolean;
}

function CollapsibleBlock({ icon: Icon, label, content }: { icon: typeof Brain; label: string; content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded mt-1.5">
      <button
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
        <Icon className="h-3 w-3" />
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <pre className="px-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-40 overflow-auto">
          {content}
        </pre>
      )}
    </div>
  );
}

function MessageBlocks({ blocks }: { blocks: ChatBlockItem[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'text') {
          return (
            <div key={i} className="prose dark:prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.content}</ReactMarkdown>
            </div>
          );
        }
        if (b.type === 'thinking') {
          return <CollapsibleBlock key={i} icon={Brain} label="Thinking..." content={b.content} />;
        }
        if (b.type === 'tool_use') {
          return <CollapsibleBlock key={i} icon={Wrench} label={b.content.split('(')[0]} content={b.content} />;
        }
        if (b.type === 'tool_result') {
          return <CollapsibleBlock key={i} icon={FileOutput} label="Result" content={b.content} />;
        }
        return null;
      })}
    </>
  );
}

export function ChatView({ messages, onSend, readOnly }: ChatViewProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text + '\r');
    setInput('');
    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">等待对话...</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              )}
            >
              <MessageBlocks blocks={msg.blocks} />
              <div className="text-[10px] opacity-50 mt-1">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      {!readOnly && (
        <div className="border-t border-border p-3 flex gap-2 items-end flex-shrink-0">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); autoGrow(e.target); }}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={1}
            className="flex-1 resize-none bg-muted rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex-shrink-0"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChatView.tsx
git commit -m "feat: create ChatView component with message list and input bar"
```

---

### Task 6: Frontend — Wire ChatView into ProjectPage

**Files:**
- Modify: `frontend/src/pages/ProjectPage.tsx`

- [ ] **Step 1: Add imports, state, and chat message handler**

Add imports at top:

```typescript
import { ChatView } from '@/components/ChatView';
import { ChatMessage } from '@/lib/websocket';
import { Terminal, MessageSquare } from 'lucide-react';
```

Add state in ProjectPage function (after existing state declarations, ~line 53):

```typescript
const [viewMode, setViewMode] = useState<'terminal' | 'chat'>('terminal');
const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
```

- [ ] **Step 2: Wire WS hook with onChatMessage and subscribeChatMessages**

Update the `useProjectWebSocket` call to include `onChatMessage`:

```typescript
onChatMessage: (msg) => {
  setChatMessages((prev) => [...prev, msg]);
},
```

Destructure `subscribeChatMessages` from the hook return.

In the `onConnected` callback (or `handleTerminalReady`), after subscribing terminal, call:

```typescript
subscribeChatMessages();
```

- [ ] **Step 3: Add tab bar and ChatView to the center column**

Replace the center column (lines 313-324):

```tsx
{/* Center: Terminal + Chat */}
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
  <div className={cn('flex-1 min-h-0', viewMode !== 'terminal' && 'hidden')}>
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

  {/* Chat view */}
  {viewMode === 'chat' && (
    <div className="flex-1 min-h-0">
      <ChatView
        messages={chatMessages}
        onSend={sendTerminalInput}
        readOnly={project?._sharedPermission === 'view'}
      />
    </div>
  )}
</div>
```

- [ ] **Step 4: Build full project**

Run: `npm run build`
Expected: success

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ProjectPage.tsx
git commit -m "feat: add terminal/chat tab switching in ProjectPage"
```

---

### Task 7: Integration test and version bump

- [ ] **Step 1: Manual test**

1. Start dev servers (`npm run dev:backend` + `npm run dev:frontend`)
2. Open a project
3. Verify terminal tab works as before
4. Switch to chat tab
5. Type a message in chat input → verify it appears in terminal PTY
6. Wait for Claude response → verify chat messages appear with ~2s delay
7. Verify thinking/tool_use blocks are collapsed and expandable
8. Switch back to terminal → verify terminal still functional

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: success

- [ ] **Step 3: Version bump and publish**

Bump version in 4 files (package.json, UpdateButton.tsx, README.md, CLAUDE.md), commit, push, publish.
