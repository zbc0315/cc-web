# Model Switch Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a model-switch button to the toolbar row in `TerminalDraftInput`, showing the current Claude model and cycling through models on click by sending `/model <name>` to PTY.

**Architecture:** Backend adds a `GET /api/claude/model` endpoint that reads `~/.claude/settings.json` and returns the `model` field (defaults to `'sonnet'`). Frontend `TerminalDraftInput` adds a second toolbar button after the Skills button. On mount, fetches the default model; tracks current selection per-project in localStorage. Click cycles through `['sonnet', 'opus', 'haiku']` and sends `/model <name>\r` to PTY via `onSend`.

**Tech Stack:** Express (backend), React 18, TypeScript, Tailwind CSS

---

## File Structure

| File | Change |
|------|--------|
| `backend/src/routes/claude.ts` | **Create** — `GET /api/claude/model` reads `~/.claude/settings.json`, returns `{ model: string }` |
| `backend/src/index.ts` | Mount `/api/claude` route |
| `frontend/src/lib/api.ts` | Add `getClaudeModel(): Promise<{ model: string }>` |
| `frontend/src/lib/storage.ts` | Add `projectModel` storage key |
| `frontend/src/components/TerminalDraftInput.tsx` | Add model button to toolbar row, cycle logic, persist per-project |

---

### Task 1: Backend — GET /api/claude/model

**Files:**
- Create: `backend/src/routes/claude.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Create the route file**

Create `/Users/tom/Projects/cc-web/backend/src/routes/claude.ts`:

```ts
import { Router } from 'express';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const router = Router();

router.get('/model', (_req, res) => {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    res.json({ model: settings.model || 'sonnet' });
  } catch {
    res.json({ model: 'sonnet' });
  }
});

export default router;
```

- [ ] **Step 2: Mount the route in index.ts**

In `/Users/tom/Projects/cc-web/backend/src/index.ts`, find the existing route import block (look for `import xxxRoutes from './routes/xxx'`). Add:

```ts
import claudeRoutes from './routes/claude';
```

Then find where routes are mounted (look for `app.use('/api/...', authMiddleware, ...Routes)`) and add:

```ts
app.use('/api/claude', authMiddleware, claudeRoutes);
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/tom/Projects/cc-web/backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/tom/Projects/cc-web
git add backend/src/routes/claude.ts backend/src/index.ts
git commit -m "feat: add GET /api/claude/model — reads ~/.claude/settings.json"
```

---

### Task 2: Frontend API + storage key

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/storage.ts`

- [ ] **Step 1: Add storage key**

In `/Users/tom/Projects/cc-web/frontend/src/lib/storage.ts`, add to `STORAGE_KEYS` (after the `usedSkills` line):

```ts
  projectModel: (id: string) => `cc_project_model_${id}`,
```

- [ ] **Step 2: Add API function**

In `/Users/tom/Projects/cc-web/frontend/src/lib/api.ts`, find the other `export async function` declarations and add:

```ts
export async function getClaudeModel(): Promise<{ model: string }> {
  return request('/api/claude/model');
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/lib/api.ts frontend/src/lib/storage.ts
git commit -m "feat: add getClaudeModel API + projectModel storage key"
```

---

### Task 3: Model button in toolbar

**Files:**
- Modify: `frontend/src/components/TerminalDraftInput.tsx`

This is the main task. The model button sits in the existing toolbar row (line 255), right after the Skills button.

- [ ] **Step 1: Read the current file**

Read `/Users/tom/Projects/cc-web/frontend/src/components/TerminalDraftInput.tsx` in full.

- [ ] **Step 2: Add import for `getClaudeModel`**

In the import block, change:

```ts
import { getGlobalShortcuts, type GlobalShortcut } from '@/lib/api';
```

to:

```ts
import { getGlobalShortcuts, getClaudeModel, type GlobalShortcut } from '@/lib/api';
```

- [ ] **Step 3: Add the model cycle constant**

After the `import` block (before `interface SkillsPanelProps`), add:

```ts
const MODEL_CYCLE = ['sonnet', 'opus', 'haiku'] as const;

function displayModelName(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'Opus';
  if (m.includes('haiku')) return 'Haiku';
  return 'Sonnet';
}
```

- [ ] **Step 4: Add model state inside `TerminalDraftInput`**

Inside the `TerminalDraftInput` function, after the `[activeTabId, setActiveTabId]` state declaration, add:

```ts
  const modelStorageKey = STORAGE_KEYS.projectModel(projectId);
  const [currentModel, setCurrentModel] = useState(() => getStorage(modelStorageKey, ''));
  const [modelLoaded, setModelLoaded] = useState(false);

  // Fetch default model from ~/.claude/settings.json on first render
  useEffect(() => {
    if (currentModel) { setModelLoaded(true); return; }
    getClaudeModel()
      .then((r) => {
        const m = r.model || 'sonnet';
        setCurrentModel(m);
        setStorage(modelStorageKey, m);
      })
      .catch(() => {
        setCurrentModel('sonnet');
        setStorage(modelStorageKey, 'sonnet');
      })
      .finally(() => setModelLoaded(true));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleModelCycle = useCallback(() => {
    if (readOnly) return;
    const normalized = currentModel.toLowerCase();
    const idx = MODEL_CYCLE.findIndex((m) => normalized.includes(m));
    const next = MODEL_CYCLE[(idx + 1) % MODEL_CYCLE.length];
    setCurrentModel(next);
    setStorage(modelStorageKey, next);
    onSend(`/model ${next}`);
    onSend('\r');
  }, [currentModel, readOnly, onSend, modelStorageKey]);
```

- [ ] **Step 5: Add the model button to the toolbar row**

Find the toolbar row `<div>` (the one with `bg-background/80 backdrop-blur-sm px-2 py-0.5 flex items-center gap-1 border-b border-white/5`). After the Skills `</button>` closing tag and before the `</div>` that closes the toolbar row, add:

```tsx
        {modelLoaded && currentModel && (
          <button
            onClick={handleModelCycle}
            disabled={readOnly}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors',
              readOnly
                ? 'text-muted-foreground/30 cursor-not-allowed'
                : 'text-muted-foreground/60 hover:text-foreground hover:bg-white/5',
            )}
            title={`当前模型: ${currentModel} — 点击切换`}
          >
            {displayModelName(currentModel)}
          </button>
        )}
```

- [ ] **Step 6: TypeScript check**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/TerminalDraftInput.tsx
git commit -m "feat: model switch button in toolbar — cycle sonnet/opus/haiku via /model command"
```

---

### Task 4: Version bump v1.5.68 → v1.5.69

**Files:**
- Modify: `package.json`
- Modify: `frontend/src/components/UpdateButton.tsx`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Bump all four files**

In `package.json`: `"version": "1.5.68"` → `"version": "1.5.69"`

In `UpdateButton.tsx`: `'v1.5.68'` → `'v1.5.69'`

In `README.md`: `v1.5.68` → `v1.5.69`

In `CLAUDE.md`: `**Current version**: v1.5.68` → `**Current version**: v1.5.69`

- [ ] **Step 2: Add CLAUDE.md design decisions entry**

Prepend immediately before the `- **Three-state draft input Ctrl+I (v1.5.68)**` line:

```
- **Model switch button (v1.5.69)**: Toolbar row in `TerminalDraftInput` gains a second button (after Skills) showing the current Claude model name. Click cycles through `sonnet → opus → haiku → sonnet` by sending `/model <name>\r` to PTY via `onSend`. Initial model read from `GET /api/claude/model` (new `backend/src/routes/claude.ts`, reads `~/.claude/settings.json`, defaults to `'sonnet'`). Current selection persisted per-project in localStorage under `STORAGE_KEYS.projectModel(id)`. `displayModelName()` normalizes model strings to display names (Sonnet/Opus/Haiku). Button disabled in read-only mode. `getClaudeModel()` added to `frontend/src/lib/api.ts`.
```

- [ ] **Step 3: Build**

```bash
cd /Users/tom/Projects/cc-web && npm run build 2>&1 | tail -10
```

Expected: success.

- [ ] **Step 4: Commit and push**

```bash
cd /Users/tom/Projects/cc-web
git add package.json frontend/src/components/UpdateButton.tsx README.md CLAUDE.md
git commit -m "chore: bump version to v1.5.69 — model switch button"
git push
```

---

## Self-Review

| Requirement | Task |
|---|---|
| Button in toolbar row showing current model | Task 3, Step 5 |
| Click cycles model | Task 3, Step 4 (`handleModelCycle`) |
| Sends `/model <name>\r` to PTY | Task 3, Step 4 (`onSend`) |
| Initial model from `~/.claude/settings.json` | Task 1 (backend) + Task 3 Step 4 (fetch on mount) |
| Per-project persistence | Task 2 (storage key) + Task 3 Step 4 (localStorage) |
| Model list: sonnet, opus, haiku | Task 3, Step 3 (`MODEL_CYCLE`) |
| Version bump | Task 4 |

**Placeholder scan:** No TBDs. All code blocks complete. No "similar to Task N" references.

**Type consistency:** `getClaudeModel` returns `{ model: string }` in both backend route and frontend API function. `MODEL_CYCLE` uses lowercase strings matching Claude Code's `/model` command format. `displayModelName` handles the display → Sonnet/Opus/Haiku.
