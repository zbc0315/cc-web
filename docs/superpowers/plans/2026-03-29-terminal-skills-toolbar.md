# Terminal Skills Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shortcut toolbar row above `TerminalDraftInput` with a "Skills" button that opens an upward-expanding hierarchical skills panel — tabs for categories, commands with `/xxx` + Chinese description, click-to-send.

**Architecture:** All changes are self-contained in `TerminalDraftInput.tsx`. A new `SkillsPanel` sub-component lives in the same file. Data comes from `getGlobalShortcuts()` (lazy, fetched once on first open). The toolbar row and panel share `showDraft` visibility (the parent `TerminalView` already gates the whole component).

**Tech Stack:** React 18, framer-motion (`motion/react`), lucide-react, shadcn/ui, `getGlobalShortcuts` from `@/lib/api`, tailwind CSS, `cn` from `@/lib/utils`

---

### Task 1: Add Toolbar Row to TerminalDraftInput

**Files:**
- Modify: `frontend/src/components/TerminalDraftInput.tsx`

Add a thin toolbar strip (`h-7`) above the existing input row. No functional changes yet — just the layout wrapper.

- [ ] **Step 1: Read current file**

```bash
# Already done — current structure is:
# <div absolute bottom-0 border-t>
#   <div bg-background/80 px-2 py-2 flex items-end gap-2>
#     <textarea /> <StopCircle button /> <SendHorizonal button />
#   </div>
# </div>
```

- [ ] **Step 2: Restructure JSX to add toolbar row**

Replace the return in `TerminalDraftInput`:

```tsx
return (
  <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-white/10">
    {/* Toolbar row */}
    <div className="bg-background/80 backdrop-blur-sm px-2 py-0.5 flex items-center gap-1 border-b border-white/5">
      {/* Skills button — placeholder for Task 2 */}
      <span className="text-xs text-muted-foreground/40 select-none">toolbar</span>
    </div>
    {/* Input row (unchanged) */}
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
          'flex-1 resize-none bg-transparent text-sm font-mono text-foreground',
          'placeholder:text-muted-foreground/50 outline-none',
          'min-h-[84px] max-h-[160px] overflow-y-auto leading-5 py-1',
          readOnly && 'opacity-50 cursor-not-allowed',
        )}
        style={{ height: '84px' }}
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
  </div>
);
```

- [ ] **Step 3: Verify visually**

Start dev server (`npm run dev:frontend`) and open a project page. The input bar should now have a thin toolbar strip above the textarea. No functional change yet.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TerminalDraftInput.tsx
git commit -m "feat: add toolbar row placeholder above terminal draft input"
```

---

### Task 2: Skills Button + State

**Files:**
- Modify: `frontend/src/components/TerminalDraftInput.tsx`

Add the Skills button to the toolbar row and wire up open/close state. No panel yet.

- [ ] **Step 1: Add imports**

At the top of `TerminalDraftInput.tsx`, add to existing imports:

```tsx
import { useState, useRef, useCallback } from 'react';
import { SendHorizonal, StopCircle, Sparkles } from 'lucide-react';
import { getGlobalShortcuts, type GlobalShortcut } from '@/lib/api';
import { STORAGE_KEYS, getStorage, setStorage, removeStorage } from '@/lib/storage';
import { cn } from '@/lib/utils';
```

- [ ] **Step 2: Add state for panel open + skills data**

Inside `TerminalDraftInput`, after the existing state declarations:

```tsx
const [skillsOpen, setSkillsOpen] = useState(false);
const [skills, setSkills] = useState<GlobalShortcut[]>([]);
const [skillsLoaded, setSkillsLoaded] = useState(false);
const [activeTabId, setActiveTabId] = useState<string | null>(null);
```

- [ ] **Step 3: Add handleToggleSkills function**

```tsx
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
```

- [ ] **Step 4: Replace toolbar placeholder with Skills button**

```tsx
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
```

- [ ] **Step 5: Verify button renders and toggles `skillsOpen` state**

Open browser devtools React DevTools and confirm `skillsOpen` toggles on click. No panel yet.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/TerminalDraftInput.tsx
git commit -m "feat: add Skills button with lazy-load state to terminal toolbar"
```

---

### Task 3: SkillsPanel Component (in same file)

**Files:**
- Modify: `frontend/src/components/TerminalDraftInput.tsx`

Build the `SkillsPanel` sub-component with tabs + commands list. Add `motion` from framer-motion for the slide-up animation.

- [ ] **Step 1: Add motion import**

```tsx
import { AnimatePresence, motion } from 'motion/react';
```

(Verify `motion/react` is already used in project — yes, confirmed in `DashboardPage.tsx` and others.)

- [ ] **Step 2: Build SkillsPanel sub-component**

Add this **above** the `TerminalDraftInput` function declaration:

```tsx
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
```

- [ ] **Step 3: Wire SkillsPanel into TerminalDraftInput with AnimatePresence**

Inside `TerminalDraftInput`, add a `handleCommand` callback:

```tsx
const handleCommand = useCallback((command: string) => {
  if (readOnly) return;
  onSend(command);
  onSend('\r');
  setSkillsOpen(false);
}, [readOnly, onSend]);
```

Then, in the JSX, add the animated panel **above** the toolbar row (so it slides up from the toolbar):

```tsx
return (
  <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-white/10">
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
    {/* Input row (unchanged) */}
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
          'flex-1 resize-none bg-transparent text-sm font-mono text-foreground',
          'placeholder:text-muted-foreground/50 outline-none',
          'min-h-[84px] max-h-[160px] overflow-y-auto leading-5 py-1',
          readOnly && 'opacity-50 cursor-not-allowed',
        )}
        style={{ height: '84px' }}
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
  </div>
);
```

- [ ] **Step 4: Test the full flow**

1. Open a project page
2. Press Ctrl+I to show draft input (if hidden)
3. Click "Skills" button — panel should slide up
4. If global shortcuts have categories (parentId-less items) and child commands, they appear as tabs + list
5. Click a command — it should be sent to terminal and panel should close
6. Click "Skills" again — panel should close

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TerminalDraftInput.tsx
git commit -m "feat: Skills panel with tab categories and click-to-send commands"
```

---

### Task 4: Close Panel on Outside Click

**Files:**
- Modify: `frontend/src/components/TerminalDraftInput.tsx`

Close the skills panel when clicking outside the toolbar/panel area.

- [ ] **Step 1: Add containerRef and outside-click handler**

Add a ref to the outer container div:

```tsx
const containerRef = useRef<HTMLDivElement>(null);
```

Add a useEffect after the state declarations:

```tsx
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
```

- [ ] **Step 2: Attach containerRef to outer div**

```tsx
<div ref={containerRef} className="absolute bottom-0 left-0 right-0 z-10 border-t border-white/10">
```

- [ ] **Step 3: Test**

1. Open skills panel
2. Click anywhere outside the terminal draft input area (e.g., on the terminal itself)
3. Panel should close

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TerminalDraftInput.tsx
git commit -m "feat: close Skills panel on outside click"
```

---

### Task 5: Version Bump & Release

**Files:**
- Modify: `package.json` (version: `1.5.65` → `1.5.66`)
- Modify: `frontend/src/components/UpdateButton.tsx` (currentVersion: `v1.5.65` → `v1.5.66`)
- Modify: `README.md` (**Current version**: `v1.5.65` → `v1.5.66`)
- Modify: `CLAUDE.md` (**Current version**: `v1.5.65` → `v1.5.66`)

- [ ] **Step 1: Grep to confirm exact strings before editing**

```bash
grep -n "1.5.65" package.json frontend/src/components/UpdateButton.tsx README.md CLAUDE.md
```

Expected: each file shows exactly one match with `1.5.65`.

- [ ] **Step 2: Bump all four files to v1.5.66**

`package.json`:
```json
"version": "1.5.66",
```

`UpdateButton.tsx`:
```tsx
const currentVersion = 'v1.5.66'; // match package.json version
```

`README.md`:
```markdown
**Current version**: v1.5.66 | [GitHub](https://github.com/zbc0315/cc-web) | MIT License
```

`CLAUDE.md` (two occurrences — version line and CLI section):
```markdown
**Current version**: v1.5.66
```

- [ ] **Step 3: Add design decision to CLAUDE.md**

Append to the design decisions section in `CLAUDE.md`:

```
- **Terminal skills toolbar (v1.5.66)**: `TerminalDraftInput` gains a toolbar row (`h-7`) above the input area, visible/hidden together with the input (gated by `showDraft` in `TerminalView`). Toolbar contains a "Skills" button (Sparkles icon) that opens a `SkillsPanel` sub-component with `AnimatePresence` slide-up animation. `SkillsPanel` fetches `getGlobalShortcuts()` lazily on first open and splits shortcuts into categories (no `parentId`) and commands (with `parentId`). Tab row selects active category; command list shows `command` (monospace, blue) + `label` (Chinese description). Clicking a command calls `onSend(command)` + `onSend('\r')` then closes panel. Panel closes on outside click via `mousedown` listener.
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: no TypeScript errors, frontend and backend build successfully.

- [ ] **Step 5: Commit**

```bash
git add package.json frontend/src/components/UpdateButton.tsx README.md CLAUDE.md
git commit -m "feat: terminal skills toolbar with hierarchical panel (v1.5.66)"
```

- [ ] **Step 6: Push and publish**

```bash
git push
npm publish --registry https://registry.npmjs.org --access=public
```

(Token must be provided separately — do NOT include in any committed file.)

---

## Self-Review

**Spec coverage:**
- ✅ Toolbar row above input, shows/hides with input — implemented via same `showDraft` parent gate
- ✅ "Skills" button as first toolbar item
- ✅ Upward-expanding hierarchical panel
- ✅ Tab switching between skill categories
- ✅ Commands show `/xxx` format + Chinese description (label)
- ✅ Click-to-send fires `onSend(command)` + `onSend('\r')`
- ✅ Animation (slide-up with AnimatePresence)
- ✅ Outside-click close

**Placeholder scan:** No TBD or TODO in plan — all code is fully written.

**Type consistency:**
- `GlobalShortcut` from `@/lib/api` used consistently: `id`, `label`, `command`, `parentId?`
- `SkillsPanelProps` matches usage in `TerminalDraftInput`
- `handleCommand(command: string)` signature matches `onCommand` prop

No gaps found.
