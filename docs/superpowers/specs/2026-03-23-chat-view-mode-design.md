# Chat View Mode — Design Spec

## Goal

Add a "chat mode" to the project page that renders Claude Code conversations as a clean chat interface, alongside the existing terminal mode. Users switch between modes via tabs. Chat mode reads messages from Claude's JSONL files in real-time via WebSocket push, and sends user input through the existing PTY.

## Architecture

```
ProjectPage
├── Tab bar: Terminal | Chat
├── WebTerminal (always mounted, hidden when chat active)
└── ChatView (new component)
    ├── Message list (scrollable)
    │   ├── UserBubble (right-aligned)
    │   └── AssistantBubble (left-aligned)
    │       ├── text blocks (visible)
    │       └── thinking/tool_use blocks (collapsed, expandable)
    └── Input bar (textarea + send button)
```

## Data Flow

```
User types in ChatView input
  → sendTerminalInput(text + '\r')     // reuse existing WS
  → PTY stdin
  → Claude CLI processes
  → Claude writes JSONL to ~/.claude/projects/.../
  → SessionManager polls JSONL (every 2s), parses new lines
  → Calls registered chat listener callback
  → WS sends { type: 'chat_message', ... } to subscribed clients
  → ChatView appends message to list
```

## Backend Changes

### SessionManager (`backend/src/session-manager.ts`)

**New: chat listener registry**

```typescript
// Per-project listener set
private chatListeners = new Map<string, Set<(msg: ChatBlock) => void>>();

registerChatListener(projectId: string, cb: (msg: ChatBlock) => void): void
unregisterChatListener(projectId: string, cb: (msg: ChatBlock) => void): void
```

**Modify: `readNewLines`**

After parsing new messages, invoke all registered listeners for that projectId. Each listener receives structured message blocks.

**Modify: `parseLine`**

Expand to extract all block types, not just text:

```typescript
interface ChatBlock {
  role: 'user' | 'assistant';
  timestamp: string;
  blocks: { type: 'text' | 'thinking' | 'tool_use' | 'tool_result'; content: string }[];
}
```

- `user` messages: single text block from `message.content`
- `assistant` messages: iterate `message.content` array, emit blocks for each type
- Skip internal messages (slash commands, `<command-` prefixed)
- The existing `parseLine` (returns `SessionMessage`) stays unchanged for file persistence; new method `parseLineBlocks` returns `ChatBlock`

### WebSocket (`backend/src/index.ts`)

**New message type: `chat_subscribe`**

When client sends `{ type: 'chat_subscribe' }`:
1. Register a chat listener on SessionManager for this projectId
2. The listener calls `ws.send(JSON.stringify({ type: 'chat_message', ...block }))`
3. On WS close, unregister the listener

**New server→client message:**

```json
{
  "type": "chat_message",
  "role": "user" | "assistant",
  "timestamp": "2026-03-23T12:00:00Z",
  "blocks": [
    { "type": "text", "content": "..." },
    { "type": "thinking", "content": "..." },
    { "type": "tool_use", "content": "search_files({...})" }
  ]
}
```

## Frontend Changes

### `lib/websocket.ts`

Extend `useProjectWebSocket` hook:
- Add `subscribeChatMessages()` method — sends `{ type: 'chat_subscribe' }`
- Add `onChatMessage?: (msg: ChatMessage) => void` callback option
- Handle incoming `chat_message` type in message router

### `pages/ProjectPage.tsx`

- New state: `viewMode: 'terminal' | 'chat'`
- Tab bar above the terminal area with two tabs
- WebTerminal always mounted (keeps PTY alive), toggled via `display: none`
- ChatView mounted when chat tab active
- Pass `sendTerminalInput` to ChatView for sending messages
- Call `subscribeChatMessages()` on WS connected

### `components/ChatView.tsx` (new)

**Props:**
```typescript
interface ChatViewProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;  // calls sendTerminalInput(text + '\r')
}
```

**Message list:**
- User messages: right-aligned bubble, zinc background
- Assistant messages: left-aligned bubble
  - `text` blocks: rendered inline
  - `thinking` blocks: collapsed `<details>` with "Thinking..." summary
  - `tool_use` blocks: collapsed `<details>` with tool name as summary
  - `tool_result` blocks: collapsed, shown after corresponding tool_use
- Auto-scroll to bottom on new message
- Markdown rendering for assistant text blocks (reuse ReactMarkdown + remarkGfm)

**Input bar:**
- `<textarea>` with auto-grow
- Enter to send, Shift+Enter for newline
- Send button (disabled when empty or view-only shared project)
- Clear input after send

## WS Protocol Extension

| Direction | Type | Payload |
|-----------|------|---------|
| Client→Server | `chat_subscribe` | `{}` |
| Server→Client | `chat_message` | `{ role, timestamp, blocks: [{type, content}] }` |

## Constraints

- Terminal stays mounted in background — PTY connection unaffected by tab switch
- Chat mode is display-only overlay; all actual execution happens through PTY
- SessionManager's 2-second JSONL poll frequency determines chat message latency
- View-only shared users can see chat but input is disabled (consistent with terminal read-only)
- `codex` and `qwen` tools don't produce Claude-format JSONL — chat mode may show no messages for them
