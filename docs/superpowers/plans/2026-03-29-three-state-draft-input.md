# Three-State Draft Input (Ctrl+I) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change Ctrl+I in TerminalView from a boolean toggle to a three-state cycle (`bottom → float → hidden → bottom`) that renders `TerminalDraftInput` in three distinct visual modes: docked at the bottom, centered floating capsule, or not rendered.

**Architecture:** `TerminalView` replaces `showDraft: boolean` with `draftMode: 'bottom' | 'float' | 'hidden'` and wraps `TerminalDraftInput` in `<AnimatePresence>` using `key={draftMode}` so each mode transition is a fresh mount (auto-focus fires, no stale height). `TerminalDraftInput` receives a `displayMode: 'bottom' | 'float'` prop and switches its root element from a plain `<div>` to a `<motion.div>` to unify the enter/exit animation with framer-motion while keeping the float `left` offset in `style` (not `transform`) to avoid conflict with motion's `y` transform.

**Tech Stack:** React 18, framer-motion (`motion/react`), Tailwind CSS, TypeScript

---

## File Structure

| File | Change |
|------|--------|
| `frontend/src/components/TerminalView.tsx` | Replace `showDraft` bool state with `draftMode` three-value state; update Ctrl+I handler; wrap render in `<AnimatePresence key={draftMode}>`; pass `displayMode` prop |
| `frontend/src/components/TerminalDraftInput.tsx` | Add `displayMode` prop; change root to `<motion.div>`; conditional class/style/height/font for bottom vs float; mount-time auto-focus |
| `package.json` | Version bump 1.5.67 → 1.5.68 |
| `frontend/src/components/UpdateButton.tsx` | Version string bump |
| `README.md` | Version badge bump |
| `CLAUDE.md` | Version field bump + prepend design-decisions entry |

---

### Task 1: Update TerminalView — three-state Ctrl+I

**Files:**
- Modify: `frontend/src/components/TerminalView.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat -n /Users/tom/Projects/cc-web/frontend/src/components/TerminalView.tsx
```

Expected: 136 lines, `showDraft` boolean state, Ctrl+I toggles it.

- [ ] **Step 2: Replace the file with the updated version**

Replace `/Users/tom/Projects/cc-web/frontend/src/components/TerminalView.tsx` with:

```tsx
import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { AnimatePresence } from 'motion/react';
import { WebTerminal, WebTerminalHandle } from '@/components/WebTerminal';
import { TerminalSearch } from '@/components/TerminalSearch';
import { TerminalDraftInput } from '@/components/TerminalDraftInput';
import { UsageBadge } from '@/components/UsageBadge';
import { useProjectWebSocket, ChatMessage } from '@/lib/websocket';
import { Project } from '@/types';

export interface TerminalViewHandle {
  sendTerminalInput: (data: string) => void;
}

interface TerminalViewProps {
  projectId: string;
  project: Project;
  onStatusChange: (status: string) => void;
}

type DraftMode = 'bottom' | 'float' | 'hidden';

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  ({ projectId, project, onStatusChange }, ref) => {
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [showSearch, setShowSearch] = useState(false);
    const [draftMode, setDraftMode] = useState<DraftMode>('bottom');

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
          e.preventDefault();
          setShowSearch((v) => !v);
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
          e.preventDefault();
          setDraftMode((m) => m === 'bottom' ? 'float' : m === 'float' ? 'hidden' : 'bottom');
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
                onSend={sendTerminalInput}
                readOnly={project?._sharedPermission === 'view'}
                displayMode={draftMode}
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
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: one error about `displayMode` prop not yet existing on `TerminalDraftInput` (Task 2 will fix it). No other errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/TerminalView.tsx
git commit -m "feat: replace showDraft bool with three-state draftMode (bottom/float/hidden)"
```

---

### Task 2: Update TerminalDraftInput — displayMode prop, motion root, float styles

**Files:**
- Modify: `frontend/src/components/TerminalDraftInput.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat -n /Users/tom/Projects/cc-web/frontend/src/components/TerminalDraftInput.tsx
```

Expected: 261 lines. Root element is `<div ref={containerRef} className="absolute bottom-0 left-0 right-0 z-10 border-t border-white/10">`. Textarea has `style={{ height: '84px' }}` and hardcoded `min-h-[84px] max-h-[160px]`. `handleSend` resets height to `'84px'`. `adjustHeight` hardcodes `160` as max.

- [ ] **Step 2: Replace the file with the updated version**

Replace `/Users/tom/Projects/cc-web/frontend/src/components/TerminalDraftInput.tsx` with:

```tsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { SendHorizonal, StopCircle, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { getGlobalShortcuts, type GlobalShortcut } from '@/lib/api';
import { STORAGE_KEYS, getStorage, setStorage, removeStorage } from '@/lib/storage';
import { cn } from '@/lib/utils';

interface SkillsPanelProps {
  skills: GlobalShortcut[];
  activeTabId: string | null;
  onTabChange: (id: string) => void;
  onCommand: (command: string) => void;
}

function SkillsPanel({ skills, activeTabId, onTabChange, onCommand }: SkillsPanelProps) {
  // Categories = shortcuts without parentId
  const categories = skills.filter((s) => !s.parentId);
  // Commands for active tab
  const commands = activeTabId
    ? skills.filter((s) => s.parentId === activeTabId)
    : [];

  if (categories.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground/50 text-center">
        暂无 Skills — 请先在快捷命令面板中添加带分类的快捷键
      </div>
    );
  }

  return (
    <div className="flex flex-col max-h-[260px]">
      {/* Tab row */}
      <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-1 border-b border-white/5 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onTabChange(cat.id)}
            className={cn(
              'px-2 py-0.5 rounded text-xs transition-colors whitespace-nowrap',
              activeTabId === cat.id
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-muted-foreground/60 hover:text-foreground hover:bg-white/5',
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>
      {/* Commands list */}
      <div className="overflow-y-auto flex-1">
        {commands.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground/40 text-center">
            该分类下暂无命令
          </div>
        ) : (
          <div className="py-1">
            {commands.map((cmd) => (
              <button
                key={cmd.id}
                onClick={() => onCommand(cmd.command)}
                className="w-full flex items-baseline gap-3 px-3 py-1.5 text-left hover:bg-white/5 transition-colors group"
              >
                <span className="font-mono text-xs text-blue-400/80 group-hover:text-blue-400 shrink-0 min-w-[80px]">
                  {cmd.command}
                </span>
                <span className="text-xs text-muted-foreground/70 group-hover:text-muted-foreground truncate">
                  {cmd.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface TerminalDraftInputProps {
  projectId: string;
  onSend: (text: string) => void;
  readOnly?: boolean;
  displayMode: 'bottom' | 'float';
}

export function TerminalDraftInput({ projectId, onSend, readOnly, displayMode }: TerminalDraftInputProps) {
  const isFloat = displayMode === 'float';
  const maxHeight = isFloat ? 300 : 160;
  const initialHeight = isFloat ? 120 : 84;

  const storageKey = STORAGE_KEYS.terminalDraft(projectId);
  const [value, setValue] = useState(() => getStorage(storageKey, ''));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skills, setSkills] = useState<GlobalShortcut[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Auto-focus on mount (fires on every mode transition because TerminalView uses key={draftMode})
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-resize textarea height to content
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
  }, [maxHeight]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setValue(text);
    // Persist every keystroke
    if (text) {
      setStorage(storageKey, text);
    } else {
      removeStorage(storageKey);
    }
    adjustHeight();
  };

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || readOnly) return;
    // Send text and Enter as separate PTY writes — matches how xterm sends keystrokes one at a time
    const toType = value.replace(/\n/g, '\r');
    onSend(toType);
    onSend('\r');
    setValue('');
    removeStorage(storageKey);
    // Reset height to initial
    if (textareaRef.current) textareaRef.current.style.height = initialHeight + 'px';
  }, [value, readOnly, onSend, storageKey, initialHeight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter sends; plain Enter inserts newline
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCommand = useCallback((command: string) => {
    if (readOnly) return;
    onSend(command.replace(/\n/g, '\r'));
    onSend('\r');
    setSkillsOpen(false);
  }, [readOnly, onSend]);

  useEffect(() => {
    if (!skillsOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSkillsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [skillsOpen]);

  const handleToggleSkills = useCallback(async () => {
    if (skillsOpen) {
      setSkillsOpen(false);
      return;
    }
    // Lazy load on first open
    if (!skillsLoaded) {
      try {
        const data = await getGlobalShortcuts();
        setSkills(data);
        setSkillsLoaded(true);
        // Auto-select first category tab
        const firstCat = data.find((s) => !s.parentId);
        if (firstCat) setActiveTabId(firstCat.id);
      } catch {
        // ignore — show empty panel
        setSkillsLoaded(true);
      }
    }
    setSkillsOpen(true);
  }, [skillsOpen, skillsLoaded]);

  const rootClassName = isFloat
    ? 'fixed bottom-[20vh] z-50 w-[50vw] rounded-2xl border border-white/20 shadow-2xl overflow-hidden'
    : 'absolute bottom-0 left-0 right-0 z-10 border-t border-white/10';

  const rootStyle = isFloat ? { left: '25vw' } : undefined;

  return (
    <motion.div
      ref={containerRef}
      className={rootClassName}
      style={rootStyle}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
    >
      {/* Skills panel — slides up above toolbar */}
      <AnimatePresence>
        {skillsOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="bg-background/95 backdrop-blur-sm border-b border-white/10"
          >
            <SkillsPanel
              skills={skills}
              activeTabId={activeTabId}
              onTabChange={setActiveTabId}
              onCommand={handleCommand}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {/* Toolbar row */}
      <div className="bg-background/80 backdrop-blur-sm px-2 py-0.5 flex items-center gap-1 border-b border-white/5">
        <button
          onClick={() => void handleToggleSkills()}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors',
            skillsOpen
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-muted-foreground/60 hover:text-foreground hover:bg-white/5',
          )}
        >
          <Sparkles className="h-3 w-3" />
          Skills
        </button>
      </div>
      {/* Input row */}
      <div className="bg-background/80 backdrop-blur-sm px-2 py-2 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          readOnly={readOnly}
          rows={2}
          placeholder={readOnly ? '只读模式' : '输入内容… Shift+Enter 发送，Enter 换行'}
          className={cn(
            'flex-1 resize-none bg-transparent font-mono text-foreground',
            'placeholder:text-muted-foreground/50 outline-none',
            'overflow-y-auto leading-5 py-1',
            isFloat
              ? 'text-base min-h-[120px] max-h-[300px]'
              : 'text-sm min-h-[84px] max-h-[160px]',
            readOnly && 'opacity-50 cursor-not-allowed',
          )}
          style={{ height: initialHeight + 'px' }}
        />
        <button
          onClick={() => !readOnly && onSend('\x03')}
          disabled={readOnly}
          className={cn(
            'flex-shrink-0 p-1.5 rounded transition-colors mb-0.5',
            !readOnly
              ? 'text-red-400/70 hover:text-red-400 hover:bg-white/10'
              : 'text-muted-foreground/30 cursor-not-allowed',
          )}
          title="发送 Ctrl+C（中断）"
        >
          <StopCircle className="h-4 w-4" />
        </button>
        <button
          onClick={handleSend}
          disabled={!value.trim() || readOnly}
          className={cn(
            'flex-shrink-0 p-1.5 rounded transition-colors mb-0.5',
            value.trim() && !readOnly
              ? 'text-blue-400 hover:text-blue-300 hover:bg-white/10'
              : 'text-muted-foreground/30 cursor-not-allowed',
          )}
          title="发送 (Shift+Enter)"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 3: TypeScript check — expect zero errors**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: no output (zero errors). Both files now agree on the `displayMode` prop type.

- [ ] **Step 4: Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/TerminalDraftInput.tsx
git commit -m "feat: add displayMode prop to TerminalDraftInput — bottom/float layouts with motion root and auto-focus"
```

---

### Task 3: Version bump v1.5.67 → v1.5.68

**Files:**
- Modify: `package.json`
- Modify: `frontend/src/components/UpdateButton.tsx`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Bump package.json**

In `/Users/tom/Projects/cc-web/package.json`, change:

```json
  "version": "1.5.68",
```

- [ ] **Step 2: Bump UpdateButton.tsx**

In `/Users/tom/Projects/cc-web/frontend/src/components/UpdateButton.tsx`, change:

```ts
const currentVersion = 'v1.5.68'; // match package.json version
```

- [ ] **Step 3: Bump README.md**

In `/Users/tom/Projects/cc-web/README.md`, change:

```md
**Current version**: v1.5.68 | [GitHub](https://github.com/zbc0315/cc-web) | MIT License
```

- [ ] **Step 4: Bump CLAUDE.md version field and prepend design-decisions entry**

In `/Users/tom/Projects/cc-web/CLAUDE.md`:

Change the `**Current version**` line to:

```md
**Current version**: v1.5.68
```

Then prepend the following bullet immediately before the `- **Non-modal floating dialogs (v1.5.67)**` line:

```md
- **Three-state draft input Ctrl+I (v1.5.68)**: `TerminalView` replaces `showDraft: boolean` / `useState(true)` with `draftMode: 'bottom' | 'float' | 'hidden'` / `useState<DraftMode>('bottom')`. Ctrl+I cycles `bottom → float → hidden → bottom`. `TerminalDraftInput` is wrapped in `<AnimatePresence>` with `key={draftMode}` — each state transition unmounts/remounts the component so auto-focus fires on every visible state and no height state leaks. `TerminalDraftInput` gains `displayMode: 'bottom' | 'float'` prop. Root element changed from `<div>` to `<motion.div>` with `initial/animate/exit={{ opacity, y }}`. bottom mode: `absolute bottom-0 left-0 right-0 z-10 border-t border-white/10`. float mode: `fixed bottom-[20vh] z-50 w-[50vw] rounded-2xl border border-white/20 shadow-2xl overflow-hidden` with `style={{ left: '25vw' }}` (avoids CSS transform conflict with framer-motion y). float: `text-base`, `min-h-[120px] max-h-[300px]`, initialHeight 120px. bottom: `text-sm`, `min-h-[84px] max-h-[160px]`, initialHeight 84px. `adjustHeight` and `handleSend` use `maxHeight`/`initialHeight` derived from `isFloat`.
```

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: no output.

- [ ] **Step 6: Build**

```bash
cd /Users/tom/Projects/cc-web && npm run build 2>&1 | tail -10
```

Expected: `✓ built in ...` and `tsc` success.

- [ ] **Step 7: Commit and push**

```bash
cd /Users/tom/Projects/cc-web
git add package.json frontend/src/components/UpdateButton.tsx README.md CLAUDE.md
git commit -m "chore: bump version to v1.5.68 — three-state draft input"
git push
```
