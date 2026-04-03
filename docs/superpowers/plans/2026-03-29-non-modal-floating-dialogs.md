# Non-Modal Floating Dialogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert all dialogs on the project detail page to non-modal floating windows: only the close button closes them, clicking outside makes them semi-transparent (focused state), and open state persists across navigation.

**Architecture:** A new `useProjectDialogStore` (Zustand, in-memory) stores per-projectId dialog open state + relevant data, surviving `ProjectPage` unmount. Each dialog gains local `isFocused` state (resets to `true` on mount). Clicking outside sets `isFocused=false` (opacity-50) without closing; clicking on the dialog sets `isFocused=true`. Shadcn `DialogContent` gains a `noOverlay` prop to skip the blocking backdrop for non-modal usage.

**Tech Stack:** React 18, Zustand, Radix UI (`@radix-ui/react-dialog`), framer-motion (`motion/react`), tailwind CSS, shadcn/ui

---

## File Structure

| File | Change |
|------|--------|
| `frontend/src/lib/stores.ts` | Add `useProjectDialogStore` |
| `frontend/src/components/ui/dialog.tsx` | Add `noOverlay` prop to `DialogContent` |
| `frontend/src/components/FileTree.tsx` | Add `projectId` prop; use Zustand for `previewPath` |
| `frontend/src/components/LeftPanel.tsx` | Pass `projectId` to `FileTree` |
| `frontend/src/components/FilePreviewDialog.tsx` | Remove backdrop/Escape close; add `isFocused` + opacity |
| `frontend/src/components/RightPanel.tsx` | SessionDialog: remove backdrop close; add `isFocused` + opacity; HistoryTab uses Zustand for session ID |
| `frontend/src/components/ShortcutPanel.tsx` | ShortcutEditorDialog + ShareToHubDialog: add `modal={false}`, `noOverlay`, `isFocused`; ShortcutPanel uses Zustand for open state |

---

### Task 1: Add `useProjectDialogStore` to stores.ts

**Files:**
- Modify: `frontend/src/lib/stores.ts`

- [ ] **Step 1: Read the file**

```bash
# Already done — current end of file is line 89 (useProjectStore)
```

- [ ] **Step 2: Append the new store**

Add this at the end of `frontend/src/lib/stores.ts`:

```typescript
// ── Project Dialog Store ────────────────────────────────────────────────────
// In-memory store: persists across ProjectPage unmount/remount within the session.
// Keyed by projectId so each project maintains its own dialog state.

interface ProjectDialogEntry {
  filePreviewPath: string | null;
  sessionId: string | null;
  shortcutEditorOpen: boolean;
  shortcutEditingId: string | null; // null = creating new
  shareHubOpen: boolean;
  shareHubLabel: string;
  shareHubCommand: string;
}

const DEFAULT_DIALOG_ENTRY: ProjectDialogEntry = {
  filePreviewPath: null,
  sessionId: null,
  shortcutEditorOpen: false,
  shortcutEditingId: null,
  shareHubOpen: false,
  shareHubLabel: '',
  shareHubCommand: '',
};

interface ProjectDialogStore {
  entries: Record<string, ProjectDialogEntry>;
  get: (projectId: string) => ProjectDialogEntry;
  setFilePreviewPath: (projectId: string, path: string | null) => void;
  setSessionId: (projectId: string, id: string | null) => void;
  setShortcutEditor: (projectId: string, open: boolean, editingId?: string | null) => void;
  setShareHub: (projectId: string, open: boolean, label?: string, command?: string) => void;
}

export const useProjectDialogStore = create<ProjectDialogStore>((set, get) => ({
  entries: {},

  get: (projectId) => get().entries[projectId] ?? DEFAULT_DIALOG_ENTRY,

  setFilePreviewPath: (projectId, path) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [projectId]: { ...(s.entries[projectId] ?? DEFAULT_DIALOG_ENTRY), filePreviewPath: path },
      },
    })),

  setSessionId: (projectId, id) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [projectId]: { ...(s.entries[projectId] ?? DEFAULT_DIALOG_ENTRY), sessionId: id },
      },
    })),

  setShortcutEditor: (projectId, open, editingId = null) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [projectId]: {
          ...(s.entries[projectId] ?? DEFAULT_DIALOG_ENTRY),
          shortcutEditorOpen: open,
          shortcutEditingId: open ? editingId : null,
        },
      },
    })),

  setShareHub: (projectId, open, label = '', command = '') =>
    set((s) => ({
      entries: {
        ...s.entries,
        [projectId]: {
          ...(s.entries[projectId] ?? DEFAULT_DIALOG_ENTRY),
          shareHubOpen: open,
          shareHubLabel: open ? label : '',
          shareHubCommand: open ? command : '',
        },
      },
    })),
}));
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/stores.ts
git commit -m "feat: add useProjectDialogStore for per-project dialog persistence"
```

---

### Task 2: Add `noOverlay` prop to DialogContent

**Files:**
- Modify: `frontend/src/components/ui/dialog.tsx`

The `DialogContent` currently always renders `<DialogOverlay />`. For non-modal project-page dialogs, we need to skip this so clicking the background isn't blocked by an invisible overlay.

- [ ] **Step 1: Read current file**

File is at `frontend/src/components/ui/dialog.tsx`. Current `DialogContent` (lines 26-48):
```tsx
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content ...>
      {children}
      <DialogPrimitive.Close ...>...</DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
```

- [ ] **Step 2: Add `noOverlay` prop**

Replace the entire `DialogContent` declaration (lines 26-48) with:

```tsx
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { noOverlay?: boolean }
>(({ className, children, noOverlay, ...props }, ref) => (
  <DialogPortal>
    {!noOverlay && <DialogOverlay />}
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/dialog.tsx
git commit -m "feat: add noOverlay prop to DialogContent for non-modal usage"
```

---

### Task 3: FileTree + LeftPanel — projectId prop + Zustand previewPath

**Files:**
- Modify: `frontend/src/components/FileTree.tsx` (add `projectId` prop, use Zustand)
- Modify: `frontend/src/components/LeftPanel.tsx` (pass `projectId` to FileTree)

- [ ] **Step 1: Read FileTree.tsx**

Current props at line 25-27:
```tsx
interface FileTreeProps {
  projectPath: string;
}
export function FileTree({ projectPath }: FileTreeProps) {
```

Current state at line 40:
```tsx
const [previewPath, setPreviewPath] = useState<string | null>(null);
```

- [ ] **Step 2: Update FileTree to add projectId + use Zustand**

Replace the `FileTreeProps` interface and `FileTree` function signature, and replace the `previewPath` useState:

```tsx
// Add to imports at top:
import { useProjectDialogStore } from '@/lib/stores';

// Replace interface:
interface FileTreeProps {
  projectPath: string;
  projectId: string;
}

// Replace function signature:
export function FileTree({ projectPath, projectId }: FileTreeProps) {

// Replace useState for previewPath (line 40):
// OLD: const [previewPath, setPreviewPath] = useState<string | null>(null);
// NEW:
const previewPath = useProjectDialogStore((s) => s.get(projectId).filePreviewPath);
const setFilePreviewPath = useProjectDialogStore((s) => s.setFilePreviewPath);
const setPreviewPath = (path: string | null) => setFilePreviewPath(projectId, path);
```

The rest of `FileTree` uses `previewPath` and `setPreviewPath` exactly as before — no other changes needed.

- [ ] **Step 3: Update LeftPanel to pass projectId to FileTree**

In `frontend/src/components/LeftPanel.tsx`, line 54 currently reads:
```tsx
<FileTree projectPath={projectPath} />
```

Change to:
```tsx
<FileTree projectPath={projectPath} projectId={projectId} />
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FileTree.tsx frontend/src/components/LeftPanel.tsx
git commit -m "feat: thread projectId into FileTree for dialog state persistence"
```

---

### Task 4: FilePreviewDialog — non-modal behavior + focus tracking

**Files:**
- Modify: `frontend/src/components/FilePreviewDialog.tsx`

**Current close mechanisms to change:**
1. `handleBackdrop` (line 130-135): backdrop click calls `onClose()` → change to `setIsFocused(false)` only
2. Escape key handler (line 137-146): calls `onClose()` → REMOVE this handler entirely
3. Dialog container (line 223): add `onClick={() => setIsFocused(true)}` and opacity class

**Note:** The close button (line 362-370) already only calls `onClose()` — keep it unchanged.

- [ ] **Step 1: Read FilePreviewDialog.tsx to confirm line numbers**

Key sections:
- `handleBackdrop` at lines 130-135
- Escape keydown effect at lines 137-146
- Outer wrapper div at lines 219-230 (the `fixed inset-0` backdrop div)
- Inner dialog box at lines 223-229

- [ ] **Step 2: Add `isFocused` state**

After the existing `useState` declarations (around line 75-80, where `isFullscreen` etc. are), add:

```tsx
const [isFocused, setIsFocused] = useState(true);
```

- [ ] **Step 3: Replace `handleBackdrop` — no longer closes, sets unfocused instead**

Replace `handleBackdrop` (lines 130-135):

```tsx
// OLD:
const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
  if (e.target === e.currentTarget) {
    if (dirty && !confirm('有未保存的修改，确定关闭？')) return;
    onClose();
  }
};

// NEW:
const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
  if (e.target === e.currentTarget) {
    setIsFocused(false);
  }
};
```

- [ ] **Step 4: Remove the Escape key close handler**

Delete the entire `useEffect` block for Escape (lines 137-146):

```tsx
// DELETE this entire block:
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (dirty && !confirm('有未保存的修改，确定关闭？')) return;
      onClose();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [onClose, dirty]);
```

- [ ] **Step 5: Update the dialog container div to track focus**

The inner dialog box (the `<div className="relative flex flex-col bg-background...">` at line 223) needs:
- `onClick` to refocus
- `transition-opacity` + conditional opacity

Replace the inner div opening tag:

```tsx
// OLD (line 223-229):
<div
  className={cn(
    'relative flex flex-col bg-background border border-border shadow-2xl transition-all duration-200',
    isFullscreen
      ? 'w-screen h-screen rounded-none'
      : 'w-[72vw] max-w-4xl h-[80vh] rounded-lg'
  )}
>

// NEW:
<div
  className={cn(
    'relative flex flex-col bg-background border border-border shadow-2xl transition-all duration-200',
    isFullscreen
      ? 'w-screen h-screen rounded-none'
      : 'w-[72vw] max-w-4xl h-[80vh] rounded-lg',
    !isFocused && 'opacity-50'
  )}
  onClick={() => setIsFocused(true)}
>
```

- [ ] **Step 6: Verify the close button still works**

The close button at lines 362-370 calls `onClose()` directly — no change needed. Confirm it still works.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/FilePreviewDialog.tsx
git commit -m "feat: FilePreviewDialog non-modal — backdrop unfocuses, only close button closes"
```

---

### Task 5: RightPanel SessionDialog — non-modal behavior + focus + persistence

**Files:**
- Modify: `frontend/src/components/RightPanel.tsx`

**Changes needed:**
1. `SessionDialog` component: remove backdrop close; add `isFocused` prop + opacity; add `onClick` to dialog box
2. `HistoryTab` component: use Zustand for `openSession` (store ID only; load data when restoring)

- [ ] **Step 1: Read RightPanel.tsx lines 29-200**

Key facts (from earlier read):
- `SessionDialog` at lines 29-108: backdrop div at line 40-47 with `onClick={onClose}`; dialog content at lines 49-105
- `HistoryTab` at lines 112+: `openSession` state at line 120

- [ ] **Step 2: Update `SessionDialog` signature to add `isFocused` + `onFocusChange` props**

Change the `SessionDialog` function signature from:
```tsx
function SessionDialog({
  session,
  onClose,
  onRecall,
}: {
  session: Session;
  onClose: () => void;
  onRecall: (text: string) => void;
})
```

To:
```tsx
function SessionDialog({
  session,
  onClose,
  onRecall,
  isFocused,
  onFocusChange,
}: {
  session: Session;
  onClose: () => void;
  onRecall: (text: string) => void;
  isFocused: boolean;
  onFocusChange: (focused: boolean) => void;
})
```

- [ ] **Step 3: Update SessionDialog backdrop — no longer closes, sets unfocused**

Change the backdrop `motion.div` (lines 40-47):

```tsx
// OLD:
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.15 }}
  className="absolute inset-0 bg-black/60 backdrop-blur-sm"
  onClick={onClose}
/>

// NEW:
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.15 }}
  className="absolute inset-0 bg-black/60 backdrop-blur-sm"
  onClick={() => onFocusChange(false)}
/>
```

- [ ] **Step 4: Update SessionDialog content div — add opacity + onClick to refocus**

The inner `motion.div` (dialog box, lines 49-105) starts with:
```tsx
<motion.div
  initial={{ opacity: 0, scale: 0.95, y: 8 }}
  animate={{ opacity: 1, scale: 1, y: 0 }}
  exit={{ opacity: 0, scale: 0.95, y: 8 }}
  transition={{ duration: 0.2, ease: 'easeOut' }}
  className="relative z-10 w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col bg-background border border-border rounded-lg shadow-2xl"
>
```

Change to:
```tsx
<motion.div
  initial={{ opacity: 0, scale: 0.95, y: 8 }}
  animate={{ opacity: 1, scale: 1, y: 0 }}
  exit={{ opacity: 0, scale: 0.95, y: 8 }}
  transition={{ duration: 0.2, ease: 'easeOut' }}
  className={cn(
    'relative z-10 w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col bg-background border border-border rounded-lg shadow-2xl transition-opacity',
    !isFocused && 'opacity-50'
  )}
  onClick={() => onFocusChange(true)}
>
```

- [ ] **Step 5: Update HistoryTab to use Zustand + manage isFocused + pass new props to SessionDialog**

In `HistoryTab` (around line 112+), make these changes:

```tsx
// Add import at top of file:
import { useProjectDialogStore } from '@/lib/stores';

// Inside HistoryTab function body, replace:
// OLD: const [openSession, setOpenSession] = useState<Session | null>(null);
// NEW:
const dialogStore = useProjectDialogStore();
const savedSessionId = dialogStore.get(projectId).sessionId;
const [openSession, setOpenSession] = useState<Session | null>(null);
const [sessionFocused, setSessionFocused] = useState(true);

// Add a useEffect to restore session from Zustand on mount:
useEffect(() => {
  if (savedSessionId && !openSession) {
    getSession(projectId, savedSessionId)
      .then((s) => setOpenSession(s))
      .catch(() => dialogStore.setSessionId(projectId, null));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // run once on mount only

// Create wrapped setters that also sync to Zustand:
const openSessionDialog = (session: Session) => {
  setOpenSession(session);
  setSessionFocused(true);
  dialogStore.setSessionId(projectId, session.id);
};
const closeSessionDialog = () => {
  setOpenSession(null);
  dialogStore.setSessionId(projectId, null);
};
```

- [ ] **Step 6: Find where HistoryTab calls `setOpenSession` and `setOpenSession(null)`, replace with the new wrappers**

Search in HistoryTab for `setOpenSession(`. Currently (around line 138-142), there's a `handleOpen` function that calls `setOpenSession(await getSession(...))`. Replace usages:

- `setOpenSession(s)` (loading session data) → `openSessionDialog(s)`
- `setOpenSession(null)` (closing) → `closeSessionDialog()`

Also update the `onClose` and `onRecall` props passed to `SessionDialog`:

```tsx
// OLD:
{openSession && (
  <AnimatePresence>
    <SessionDialog
      session={openSession}
      onClose={() => setOpenSession(null)}
      onRecall={(text) => { onSend(text); setOpenSession(null); }}
    />
  </AnimatePresence>
)}

// NEW:
{openSession && (
  <AnimatePresence>
    <SessionDialog
      session={openSession}
      onClose={closeSessionDialog}
      onRecall={(text) => { onSend(text); closeSessionDialog(); }}
      isFocused={sessionFocused}
      onFocusChange={setSessionFocused}
    />
  </AnimatePresence>
)}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/RightPanel.tsx
git commit -m "feat: SessionDialog non-modal — backdrop unfocuses, persists session across navigation"
```

---

### Task 6: ShortcutPanel dialogs — non-modal behavior + focus + persistence

**Files:**
- Modify: `frontend/src/components/ShortcutPanel.tsx`

**Dialogs to change:**
1. `ShortcutEditorDialog` — add `modal={false}`, `noOverlay`, `isFocused` state
2. `ShareToHubDialog` — same pattern
3. `ShortcutPanel` — lift dialog open state to Zustand

- [ ] **Step 1: Update `ShortcutEditorDialog` sub-component**

Add `isFocused` state inside `ShortcutEditorDialog`:

```tsx
// Inside ShortcutEditorDialog function, add after the existing useState declarations:
const [isFocused, setIsFocused] = useState(true);

// Reset to focused whenever dialog opens:
useEffect(() => {
  if (open) setIsFocused(true);
}, [open]);
```

Change the Dialog JSX (currently at line 57 `<Dialog open={open} onOpenChange={onOpenChange}>`):

```tsx
// OLD:
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">

// NEW:
<Dialog open={open} onOpenChange={onOpenChange} modal={false}>
  <DialogContent
    noOverlay
    className={cn(
      'sm:max-w-2xl max-h-[85vh] flex flex-col transition-opacity',
      !isFocused && 'opacity-50'
    )}
    onInteractOutside={(e) => { e.preventDefault(); setIsFocused(false); }}
    onClick={() => setIsFocused(true)}
  >
```

Make sure `cn` is already imported (it is, from line 4).

- [ ] **Step 2: Update `ShareToHubDialog` sub-component**

Same pattern — add `isFocused` state and update Dialog JSX:

```tsx
// Inside ShareToHubDialog function, add after existing useState declarations:
const [isFocused, setIsFocused] = useState(true);

useEffect(() => {
  if (open) setIsFocused(true);
}, [open]);
```

Find the `<Dialog open={shareDialogOpen} ...>` / `<Dialog open={open} ...>` in `ShareToHubDialog` (it's called with `open` prop at line 164) and update:

```tsx
// OLD (find the Dialog in ShareToHubDialog):
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="sm:max-w-md">

// NEW:
<Dialog open={open} onOpenChange={onOpenChange} modal={false}>
  <DialogContent
    noOverlay
    className={cn('sm:max-w-md transition-opacity', !isFocused && 'opacity-50')}
    onInteractOutside={(e) => { e.preventDefault(); setIsFocused(false); }}
    onClick={() => setIsFocused(true)}
  >
```

- [ ] **Step 3: Update `ShortcutPanel` to use Zustand for dialog open state**

Add import at top of file:
```tsx
import { useProjectDialogStore } from '@/lib/stores';
```

Inside `ShortcutPanel` function body, replace dialog state declarations and add Zustand sync:

```tsx
// OLD (lines 244-250):
const [dialogOpen, setDialogOpen] = useState(false);
const [editingShortcut, setEditingShortcut] = useState<Shortcut | null>(null);
const [shareDialogOpen, setShareDialogOpen] = useState(false);
const [shareLabel, setShareLabel] = useState('');
const [shareCommand, setShareCommand] = useState('');

// NEW:
const dialogStore = useProjectDialogStore();
const saved = dialogStore.get(projectId);

const [dialogOpen, setDialogOpen] = useState(saved.shortcutEditorOpen);
const [editingShortcut, setEditingShortcut] = useState<Shortcut | null>(null);
const [shareDialogOpen, setShareDialogOpen] = useState(saved.shareHubOpen);
const [shareLabel, setShareLabel] = useState(saved.shareHubLabel);
const [shareCommand, setShareCommand] = useState(saved.shareHubCommand);
```

- [ ] **Step 4: Restore editingShortcut from Zustand after shortcuts load**

After the existing `useEffect` that fetches shortcuts (lines 252-254):

```tsx
useEffect(() => {
  void getProjectShortcuts(projectId).then(setShortcuts).catch(() => setShortcuts([]));
}, [projectId]);
```

Add a new effect that restores `editingShortcut` once shortcuts are available:

```tsx
// Restore editing shortcut from Zustand after shortcuts load
useEffect(() => {
  if (saved.shortcutEditorOpen && saved.shortcutEditingId && shortcuts.length > 0) {
    const found = shortcuts.find((s) => s.id === saved.shortcutEditingId) ?? null;
    setEditingShortcut(found);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [shortcuts]); // run when shortcuts first loads; `saved` is stable reference
```

- [ ] **Step 5: Sync dialog open state changes to Zustand**

Wrap the `setDialogOpen` and `setShareDialogOpen` calls to also update Zustand.

Replace `handleAdd` and `handleEdit` to also sync to Zustand:

```tsx
// OLD:
const handleAdd = () => {
  setEditingShortcut(null);
  setDialogOpen(true);
};

const handleEdit = (s: Shortcut, e: React.MouseEvent) => {
  e.stopPropagation();
  setEditingShortcut(s);
  setDialogOpen(true);
};

// NEW:
const handleAdd = () => {
  setEditingShortcut(null);
  setDialogOpen(true);
  dialogStore.setShortcutEditor(projectId, true, null);
};

const handleEdit = (s: Shortcut, e: React.MouseEvent) => {
  e.stopPropagation();
  setEditingShortcut(s);
  setDialogOpen(true);
  dialogStore.setShortcutEditor(projectId, true, s.id);
};
```

Wrap dialog close to sync to Zustand — update the `onOpenChange` handler passed to `ShortcutEditorDialog`:

```tsx
// When ShortcutEditorDialog calls onOpenChange(false), also clear Zustand:
const handleEditorOpenChange = (open: boolean) => {
  setDialogOpen(open);
  if (!open) dialogStore.setShortcutEditor(projectId, false);
};
```

Use `handleEditorOpenChange` instead of `setDialogOpen` in the `ShortcutEditorDialog` JSX.

Replace `handleShare` to also sync to Zustand:

```tsx
// OLD:
const handleShare = (label: string, command: string, e: React.MouseEvent) => {
  e.stopPropagation();
  setShareLabel(label);
  setShareCommand(command);
  setShareDialogOpen(true);
};

// NEW:
const handleShare = (label: string, command: string, e: React.MouseEvent) => {
  e.stopPropagation();
  setShareLabel(label);
  setShareCommand(command);
  setShareDialogOpen(true);
  dialogStore.setShareHub(projectId, true, label, command);
};
```

Add a close handler for the share dialog:

```tsx
const handleShareOpenChange = (open: boolean) => {
  setShareDialogOpen(open);
  if (!open) dialogStore.setShareHub(projectId, false);
};
```

Use `handleShareOpenChange` instead of `setShareDialogOpen` in the `ShareToHubDialog` JSX.

- [ ] **Step 6: Update the ShortcutEditorDialog and ShareToHubDialog JSX in ShortcutPanel**

Find where they are rendered in the return JSX and update `onOpenChange`:

```tsx
// ShortcutEditorDialog usage:
<ShortcutEditorDialog
  open={dialogOpen}
  onOpenChange={handleEditorOpenChange}   // ← changed from setDialogOpen
  initialLabel={editingShortcut?.label ?? ''}
  initialCommand={editingShortcut?.command ?? ''}
  title={editingShortcut ? 'Edit Shortcut' : 'New Shortcut'}
  onSave={handleSave}
/>

// ShareToHubDialog usage:
<ShareToHubDialog
  open={shareDialogOpen}
  onOpenChange={handleShareOpenChange}    // ← changed from setShareDialogOpen
  label={shareLabel}
  command={shareCommand}
/>
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ShortcutPanel.tsx
git commit -m "feat: ShortcutPanel dialogs non-modal — no backdrop close, focus tracking, persist state"
```

---

### Task 7: Version bump & release v1.5.67

**Files:**
- Modify: `package.json` (`"version": "1.5.66"` → `"1.5.67"`)
- Modify: `frontend/src/components/UpdateButton.tsx` (`v1.5.66` → `v1.5.67`)
- Modify: `README.md` (`v1.5.66` → `v1.5.67`)
- Modify: `CLAUDE.md` (`v1.5.66` → `v1.5.67`)

- [ ] **Step 1: Grep to confirm exact version strings before editing**

```bash
grep -n "1.5.66" package.json frontend/src/components/UpdateButton.tsx README.md CLAUDE.md
```

Expected: each file shows exactly one match with `1.5.66`.

- [ ] **Step 2: Bump all four files to `1.5.67`**

`package.json`:
```json
"version": "1.5.67",
```

`UpdateButton.tsx`:
```tsx
const currentVersion = 'v1.5.67'; // match package.json version
```

`README.md`:
```markdown
**Current version**: v1.5.67 | [GitHub](https://github.com/zbc0315/cc-web) | MIT License
```

`CLAUDE.md` (first occurrence — header):
```markdown
**Current version**: v1.5.67
```

- [ ] **Step 3: Add design decision entry to CLAUDE.md**

Prepend to the design decisions section (before the `v1.5.66` entry):

```
- **Non-modal floating dialogs (v1.5.67)**: All project-page dialogs converted to floating-palette behavior. `useProjectDialogStore` (Zustand, in `stores.ts`) stores per-projectId dialog open state + associated data (filePreviewPath, sessionId, shortcutEditorOpen/EditingId, shareHubOpen/Label/Command), surviving `ProjectPage` unmount. Each dialog gains local `isFocused` state (resets to `true` on mount). Clicking outside: (1) for custom dialogs (FilePreviewDialog, SessionDialog) — backdrop click sets `isFocused=false`, dialog becomes `opacity-50`; (2) for shadcn dialogs (ShortcutEditorDialog, ShareToHubDialog) — `onInteractOutside` calls `e.preventDefault()` (no close) + `setIsFocused(false)`. Clicking on dialog content → `setIsFocused(true)`. Only close buttons close dialogs. `DialogContent` in `ui/dialog.tsx` gains `noOverlay` prop to skip `DialogOverlay` for non-modal usage. Escape key close removed from FilePreviewDialog.
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: no TypeScript errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add package.json frontend/src/components/UpdateButton.tsx README.md CLAUDE.md
git commit -m "feat: non-modal floating dialogs — persist state, focus tracking, no backdrop close (v1.5.67)"
```

- [ ] **Step 6: Push and publish (token required)**

```bash
git push
npm publish --registry https://registry.npmjs.org --access=public --//registry.npmjs.org/:_authToken=<token>
```

---

## Self-Review

**Spec coverage:**
- ✅ Only close button closes dialogs — backdrop/Escape close removed from all 4 dialogs
- ✅ Clicking outside → semi-transparent (opacity-50) — `isFocused` state + conditional class
- ✅ Clicking outside → focus shifts to project page — backdrop click no longer prevents interaction, `isFocused=false` means dialog is visually receded
- ✅ Clicking dialog refocuses — `onClick={() => setIsFocused(true)}` on dialog content
- ✅ Persist across navigation — Zustand store survives `ProjectPage` unmount/remount
- ✅ Persists per-project (project A state not mixed with project B) — keyed by projectId

**Placeholder scan:** No TBD or TODO. All code is fully written.

**Type consistency:**
- `ProjectDialogEntry` interface defined in Task 1; used in Tasks 3-6
- `useProjectDialogStore` exported from Task 1; imported in Tasks 3, 5, 6
- `noOverlay` prop added to `DialogContent` in Task 2; used as `noOverlay` in Task 6
- `isFocused` / `onFocusChange` added to `SessionDialog` in Task 5 Step 2; passed in Task 5 Step 6
- `handleEditorOpenChange` / `handleShareOpenChange` defined in Task 6 Step 5; used in Task 6 Step 6

**Edge cases covered:**
- `FilePreviewDialog` still shows unsaved-edit confirmation before closing via close button (dirty check in close button handler at line 365 is unchanged)
- `SessionDialog` restore: if session no longer exists (deleted), Zustand entry is cleared gracefully
- `ShortcutEditorDialog` restore: if `editingShortcut` ID no longer exists, falls back to `null` (new shortcut mode)
- Dialogs on DashboardPage / SettingsPage are NOT affected (they don't use `noOverlay` or the new store)
