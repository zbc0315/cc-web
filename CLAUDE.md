# CC Web — Development Guide

## Overview

CC Web is a self-hosted web application (distributed as npm package) that lets users create "projects". Each project opens a persistent terminal session running `claude` CLI, with a real-time terminal UI forwarding I/O between the browser and the PTY via WebSocket.

**Current version**: v1.5.71
**GitHub**: https://github.com/zbc0315/cc-web
**License**: MIT

## CLI Usage (npm / npx)

```bash
# Run without installing (npx)
npx ccweb

# Install globally
npm install -g @tom2012/cc-web
ccweb                      # start (interactive: asks access mode + background)
ccweb start --daemon       # always start in background
ccweb start --foreground   # always start in foreground
ccweb start --local        # local only (default, most secure)
ccweb start --lan          # allow LAN access
ccweb start --public       # allow public access
ccweb stop                 # stop background server
ccweb status               # show PID and port
ccweb open                 # open browser to running server
ccweb setup                # reconfigure admin username/password
ccweb register             # register a new user (interactive)
ccweb update               # stop server & update to latest version
ccweb enable-autostart     # macOS launchd / Linux systemd auto-start on login
ccweb disable-autostart    # remove auto-start
ccweb logs                 # tail background log file
```

All user data is stored in `~/.ccweb/` (survives package updates).

## Quick Start (Development)

```bash
# 1. Install dependencies
npm run install:all

# 2. First-time setup (create credentials)
npm run setup

# 3. Start backend (Terminal 1)
npm run dev:backend

# 4. Start frontend (Terminal 2)
npm run dev:frontend
```

Open http://localhost:5173 in your browser.

## Architecture

```
Browser (React/Vite :5173 dev | Express :3001 prod)
    │
    ├── REST API ──────────► Express (:3001, auto-switches port if busy)
    │                              │
    └── WebSocket ─────────► ws server (same port)
                                   │
                              TerminalManager
                                   │
                              node-pty (PTY, user's $SHELL -ilc "claude")
                                   │
                              claude / claude --dangerously-skip-permissions
```

### Backend (`backend/src/`)

| File | Purpose |
|------|---------|
| `index.ts` | Express + WS server, route mounting, static frontend serving, auto port switching, project config migration, `chat_subscribe` WS handler |
| `auth.ts` | JWT middleware (header + query param token), localhost auto-auth (`isLocalRequest`), `generateLocalToken()` |
| `config.ts` | File-based JSON store (cached getConfig), shared helpers (`isAdminUser`, `isProjectOwner`, `getUserWorkspace`), `.ccweb/` per-project config |
| `terminal-manager.ts` | PTY lifecycle (`$SHELL -ilc "claude"`), scrollback buffer (5MB), auto-restart with `--continue`, activity tracking, `killForUpdate()` (keep status for resume) |
| `session-manager.ts` | Tails Claude's JSONL files (path encoding: `/ ` `_` → `-`), stores sessions in `.ccweb/sessions/`, chat listener registry + chat history replay, semantic status tracking (thinking/tool_use/text), prunes to latest 20 |
| `usage-terminal.ts` | Claude Code OAuth usage stats |
| `routes/auth.ts` | `POST /login`, `GET /local-token` (localhost only), multi-user login (config.json + users.json) |
| `routes/projects.ts` | CRUD + start/stop + `POST /open` + sharing (`PUT /:id/shares`) + workspace isolation + `GET /users` |
| `routes/update.ts` | `GET /check-running`, `POST /prepare` (send memory-save cmd → wait idle → keep running for resume) |
| `routes/filesystem.ts` | Directory browser, file read/write, raw file streaming (images/office), file upload (multer) |
| `routes/shortcuts.ts` | Global + project shortcut CRUD with inheritance |
| `routes/backup.ts` | Cloud backup provider CRUD, built-in OAuth credentials, OAuth2 callback, backup trigger, schedule, history |
| `backup/types.ts` | CloudProvider interface, config types, backup state types |
| `backup/config.ts` | Backup config and history persistence (`~/.ccweb/backup-config.json`) |
| `backup/engine.ts` | Incremental backup engine (scan, diff, parallel upload) |
| `backup/scheduler.ts` | Scheduled backup timer |
| `backup/providers/` | Google Drive, OneDrive, Dropbox CloudProvider implementations |
| `routes/sounds.ts` | Sound file API: presets, download, upload, streaming |
| `routes/skillhub.ts` | SkillHub API: fetch skills index, submit via GitHub Issue, download to global shortcuts |
| `hooks-manager.ts` | Manages `~/.claude/settings.json` hooks lifecycle — idempotent install/uninstall with `# ccweb-hook` marker, atomic write, crash-safe |
| `chat-process-manager.ts` | Chat SDK mode — manages `claude --print --output-format stream-json` subprocess per project, streaming token parsing, crash-restart, mode switch |
| `routes/hooks.ts` | `POST /api/hooks` — receives Claude Code lifecycle hook events (PreToolUse/PostToolUse/Stop), localhost-only, no JWT |

### Frontend (`frontend/src/`)

| File/Dir | Purpose |
|----------|---------|
| `App.tsx` | Router with auto-auth `PrivateRoute`, global `<ErrorBoundary>`, `<Toaster>` (sonner) |
| `pages/LoginPage.tsx` | Login form, auto-login on localhost |
| `pages/DashboardPage.tsx` | Project grid (own + shared), new/open project, fullscreen toggle, SkillHub nav, semantic status stack with motion animations |
| `pages/ProjectPage.tsx` | Three-panel layout: FileTree | Terminal+Chat (tab switch, persisted per project) | RightPanel |
| `components/WebTerminal.tsx` | xterm.js terminal with fit addon |
| `components/ChatView.tsx` | Chat display mode: real-time message bubbles with history replay, Markdown rendering, collapsible thinking/tool blocks, motion entrance animations |
| `components/RightPanel.tsx` | Three tabs: 快捷命令 / 历史记录 / 图谱 |
| `components/ShortcutPanel.tsx` | Project + global shortcuts, dialog editor for add/edit, share to SkillHub |
| `components/GraphPreview.tsx` | SVG topology graph of `.notebook/graph.yaml` (layered DAG layout, zoom/pan) |
| `components/FileTree.tsx` | Expandable directory tree, right-click download, upload button + drag-and-drop upload |
| `components/FilePreviewDialog.tsx` | File viewer: plain/rendered/edit modes, image preview, Office file preview (docx/xlsx/pptx), zoom memory |
| `components/OfficePreview.tsx` | Office file preview: docx (mammoth.js→HTML), xlsx (SheetJS→table), pptx (JSZip→slide text) |
| `components/ErrorBoundary.tsx` | React error boundary with toast notification and fallback UI |
| `components/UpdateButton.tsx` | Version display and update check |
| `pages/SkillHubPage.tsx` | SkillHub browse, search, tag filter, download page |
| `components/OpenProjectDialog.tsx` | Open existing project from `.ccweb/` folder |
| `components/NewProjectDialog.tsx` | 3-step wizard: name → folder → permissions |
| `components/ShareDialog.tsx` | Project sharing dialog: add users, set view/edit permissions |
| `lib/api.ts` | Typed REST client, dynamic base URL (relative in prod, localhost:3001 in dev), `SemanticStatus` + `ProjectActivity` types |
| `lib/websocket.ts` | `useProjectWebSocket` hook, dynamic WS URL, `subscribeChatMessages` + `onChatMessage` for chat mode |
| `lib/storage.ts` | Typed localStorage abstraction (`STORAGE_KEYS`, `getStorage`/`setStorage`/`removeStorage`, `usePersistedState` hook) |
| `lib/stores.ts` | Zustand global state: `useAuthStore` (token management), `useProjectStore` (project list CRUD) |
| `components/ProjectHeader.tsx` | Project page header bar: status badge, backup, sound, start/stop, panel toggles, fullscreen |
| `components/TerminalView.tsx` | Terminal + Chat main panel: owns WebSocket connection, xterm rendering, chat view, viewMode switching, LLM activity detection |
| `pages/SettingsPage.tsx` | Settings page: cloud accounts, backup strategy, backup history |
| `components/AddProviderDialog.tsx` | Add cloud provider: one-click with built-in OAuth or manual credentials |
| `components/BackupProviderCard.tsx` | Cloud account card with auth status |
| `components/BackupHistoryTable.tsx` | Backup history table |
| `components/SoundPlayer.tsx` | Audio playback engine (fade in/out, loop/interval modes) |
| `components/SoundSelector.tsx` | Sound selection and configuration UI popover |
| `components/ui/` | shadcn/ui components (zinc theme) |

### Data Storage

**Application data** (`~/.ccweb/` for npm install, `data/` for dev):
```
data/
├── config.json                    ← admin credentials & JWT secret
├── users.json                     ← registered users (from `ccweb register`)
├── projects.json                  ← registered project list (with owner & shares)
├── global-shortcuts.json          ← admin's global shortcut commands
├── global-shortcuts-{user}.json   ← per-user global shortcut commands
├── backup-config.json             ← cloud backup providers, built-in OAuth, schedule, exclude patterns
└── backup-history.json            ← backup event history (latest 100)
```

**Per-project data** (inside each project folder, portable):
```
your-project/
├── .ccweb/
│   ├── project.json         ← project metadata (id, name, mode, created)
│   ├── shortcuts.json       ← project-level shortcut commands
│   ├── backup-state.json    ← incremental backup file snapshots (mtime, size, hash)
│   └── sessions/            ← conversation history (max 20, auto-pruned)
│       └── {timestamp}-{uuid}.json
└── .notebook/               ← structured notes
    ├── pages/
    └── graph.yaml
```

`data/sessions/{projectId}/` is legacy — `session-manager` reads from both locations but only writes to `.ccweb/sessions/`. On startup, `migrateProjectConfigs()` backfills `.ccweb/project.json` for older projects.

## WebSocket Protocol

**Client → Server:**
| Type | Payload | Purpose |
|------|---------|---------|
| `auth` | `{ token }` | Authenticate (skipped for localhost) |
| `terminal_subscribe` | `{ cols, rows }` | Subscribe + replay scrollback |
| `terminal_input` | `{ data }` | Keystrokes to PTY |
| `terminal_resize` | `{ cols, rows }` | Resize PTY |
| `chat_subscribe` | `{}` | Subscribe to chat messages (replays history first, then real-time from JSONL) |
| `chat_input` | `{ text }` | Send message to Chat SDK subprocess (Chat mode only) |
| `chat_interrupt` | `{}` | Interrupt current generation and restart with --continue (Chat mode only) |

**Server → Client:**
| Type | Payload | Purpose |
|------|---------|---------|
| `connected` | `{ projectId, readOnly? }` | Ready (readOnly=true for view-only shared) |
| `status` | `{ status }` | running/stopped/restarting |
| `terminal_data` | `{ data }` | PTY output |
| `terminal_subscribed` | `{}` | Subscription confirmed |
| `chat_message` | `{ role, timestamp, blocks[] }` | Parsed JSONL message for chat view |
| `chat_stream` | `{ delta, contentType }` | Chat SDK streaming token (text/thinking) |
| `chat_tool_start` | `{ name, input }` | Chat SDK tool call started |
| `chat_tool_end` | `{ name, output }` | Chat SDK tool call completed |
| `chat_turn_end` | `{ cost_usd }` | Chat SDK turn complete |
| `error` | `{ message }` | Error |

Localhost WebSocket connections are pre-authenticated — no `auth` message needed.

## Key Design Decisions

- **PTY-first**: Spawns real `claude` CLI via `node-pty` using user's `$SHELL -ilc`. All Claude Code features work natively.
- **Open-with-continue**: Opening an existing project (`POST /api/projects/open`) and manually starting a stopped project (`PATCH /api/projects/:id/start`) both launch with `--continue`, restoring the previous conversation. Only brand-new projects (`POST /api/projects`) start without `--continue`.
- **No database**: Pure JSON files, in-memory CRUD.
- **Per-project `.ccweb/`**: Data travels with the project folder, survives app reinstall. Use "Open Project" to restore.
- **Session tailing**: Reads Claude Code's native JSONL (`~/.claude/projects/`) rather than parsing PTY output. Path encoding replaces `/`, ` `, and `_` with `-`. Extracts semantic status (thinking/tool_use/tool_result/text) from the last assistant message block. Thinking blocks use `b.thinking` field, tool_result blocks use `b.content` field.
- **Combined activity detection**: Dashboard cards use PTY `onData` timestamps for glow animation (real-time) + JSONL semantic status for phase labels (Thinking/Writing/Tool). Activity API: `GET /api/projects/activity` returns `{ [id]: { lastActivityAt, semantic? } }`.
- **Chat history replay**: `chat_subscribe` replays all existing JSONL messages before registering for real-time updates (analogous to terminal scrollback replay).
- **Auto port switching**: Backend tries ports 3001-3020, reports actual port via IPC.
- **Localhost auto-auth**: Local requests skip JWT verification entirely. Login only required for remote/network access. Auth middleware supports both `Authorization: Bearer` header and `?token=` query param (for `<img>`/`<audio>` elements that can't set headers).
- **CLI update**: `ccweb update` sends SIGUSR2 (update mode) — PTYs are killed but project status stays 'running'. After update, `resumeAll()` restarts all sessions with `--continue`. No conversation loss.
- **Scrollback buffer**: 5MB per terminal for client reconnect replay.
- **Session pruning**: Keeps latest 20 sessions per project, deletes oldest on new session start.
- **Zoom memory**: `FilePreviewDialog` persists zoom level per file path in `localStorage`.
- **SkillHub**: Community shortcut sharing via GitHub repo `zbc0315/ccweb-skillhub`. Built-in bot token (zero config). Skills support `parentId` inheritance — downloading a child auto-downloads its parent chain. Submissions create GitHub Issues for review.
- **Multi-user**: Admin created via `ccweb setup`, additional users via `ccweb register`. Each user has isolated workspace (`~/Projects` for admin, `~/Projects{username}` for others). Admin has no workspace path restriction.
- **Project sharing**: Owners can share projects with other users (view/edit). View-only users see terminal output but can't send input. Edit users have full access. Shares stored in `projects.json` per project.
- **Per-user shortcuts**: Global shortcuts isolated per user. Admin uses `global-shortcuts.json`, others use `global-shortcuts-{username}.json`.
- **Micro-animations**: Uses `motion` (framer-motion) for UI transitions: staggered card entrance, panel slide, chat message slide-in, collapsible sections, status badge stack AnimatePresence, hover lift, button tap feedback. All 150-350ms with easeOut.
- **Toast notifications**: Uses `sonner` for all error/success feedback (no `alert()` calls). `<Toaster>` mounted in App.tsx.
- **localStorage abstraction**: All localStorage access goes through `lib/storage.ts` — typed `STORAGE_KEYS` constants, `getStorage`/`setStorage` helpers with try-catch, `usePersistedState` hook for React state + localStorage sync.
- **Error boundaries**: Global `<ErrorBoundary>` wraps the app in App.tsx. Panel-level boundaries planned for FileTree/Terminal/Chat isolation.
- **Zustand global state**: `useAuthStore` (token management, replaces localStorage-based getToken/setToken/clearToken) and `useProjectStore` (project list CRUD, shared between Dashboard and ProjectPage). Non-hook accessors (`getTokenFromStore` etc.) for use in api.ts request function.
- **Component split**: ProjectPage is a layout shell (~120 lines). `ProjectHeader` handles the top bar (backup, sound, start/stop). `TerminalView` owns the WebSocket connection, terminal rendering, chat view, and LLM activity detection. Communication via `forwardRef` + `useImperativeHandle`.
- **Code splitting**: Route-level lazy loading (ProjectPage, SettingsPage, SkillHubPage via `React.lazy`). Component-level lazy loading (ChatView, OfficePreview, GraphPreview). Heavy deps (xlsx, jszip, mammoth, react-syntax-highlighter) only loaded on demand.
- **Activity push via WebSocket**: Dashboard uses `/ws/dashboard` endpoint instead of polling `GET /api/projects/activity`. Backend `TerminalManager` and `SessionManager` extend `EventEmitter`, emit `'activity'` (500ms throttle) and `'semantic'` events. Frontend `useDashboardWebSocket` hook receives real-time `activity_update` messages.
- **Claude Code Hooks**: `PreToolUse`/`PostToolUse`/`Stop` hooks in `~/.claude/settings.json` fire `curl POST /api/hooks` (localhost-only). `HooksManager` installs/uninstalls idempotently on server start/stop — handles crash-without-cleanup via `# ccweb-hook` marker. `PreToolUse` updates semantic status directly (no JSONL read yet); `PostToolUse`/`Stop` call `triggerRead()` to read new JSONL lines. Replaces the old 2s `setInterval` polling in SessionManager.
- **Chat SDK mode**: Project type `mode: 'chat'` uses `claude --print --output-format stream-json --input-format stream-json --include-partial-messages --verbose` as a persistent subprocess with stdin/stdout pipes. `ChatProcessManager` parses JSONL lines to emit `stream`/`tool_start`/`tool_end`/`turn_end` events forwarded to WebSocket clients. Mode switch (`POST /api/projects/:id/switch-mode`) stops current process and restarts with `--continue` — context preserved via same session JSONL. Port file `~/.ccweb/port` lets hook curl commands discover the server port.
- **Chat input separation**: In Chat SDK mode, `ChatView` renders with `hideInput={true}` (suppresses its built-in textarea) and `ChatInputBar` below is the sole input path — sending via `chat_input` WS message to `ChatProcessManager`. In Terminal mode's chat history view, `ChatView` renders its own input sending `terminal_input` to PTY with `\r`.
- **Project ID validation**: All `/:id` routes in `routes/projects.ts` use `router.param('id', ...)` middleware to validate UUID format before hitting any handler — prevents log injection from malformed IDs.
- **JSON safety**: `getProjects()` and `getGlobalShortcuts()` in `config.ts` wrap JSON.parse in try-catch, returning `[]` on corrupt files instead of crashing the server. Atomic writes (`atomicWriteSync`) via temp+rename prevent mid-write corruption.
- **Graceful shutdown**: SIGTERM/SIGINT calls `chatProcessManager.stopAll()` in addition to `terminalManager.stop()` per project — all `claude --print` subprocesses are killed cleanly on server exit.
- **triggerRead retries**: `SessionManager.triggerRead()` retries JSONL discovery up to 3 times (500ms / 1s / 2s) when the file doesn't exist yet — handles the race where a hook fires before Claude writes the first JSONL line.
- **Dashboard card glow border-radius**: `.card-active-glow > *` (the inner `motion.div`) sets `border-radius: var(--radius)` and `overflow: hidden` so the animated gradient background matches the outer container's rounded corners instead of covering them.
- **Semantic status activity timestamp**: `broadcastDashboardSemantic` uses `Date.now()` when `status` is non-null (hook just fired = LLM actively working), rather than the stale PTY `lastActivityAt`. This ensures the frontend marks the project as active during thinking/tool phases when PTY output is silent.
- **Dashboard status badge overflow fix**: The status stack container previously had `overflow-hidden` + `h-5`, clipping badges that animated upward (`y: -(depth * 18)`). Fixed in v1.5.44 by replacing the multi-layer stack with a single latest-badge display using `AnimatePresence mode="wait"` — no overflow clipping, clean fade transition between phases.
- **Chat SDK mode removed (v1.5.46)**: `ChatProcessManager` (`claude --print --output-format stream-json`), `ChatInputBar`, `mode: 'terminal'|'chat'` field, and `switch-mode` endpoint were all deleted. Root cause: 5 fundamental conflicts with ccweb's architecture (start/stop/delete only called terminalManager, limited mode caused infinite crash-restart loops, resumeAll() would create PTYs for chat projects, trust prompt detection was fragile, Hooks caused double event processing). The JSONL history tab (`ChatView` + `chat_message` WS + `subscribeChatMessages`) is **kept** — it reads Claude's native session files, no subprocess needed.
- **React.lazy named export pattern**: `ChatView` has only a named export (`export function ChatView`), no default export. The lazy import requires `.then((m) => ({ default: m.ChatView }))` — do not remove this wrapper.
- **index.ts helper extraction (v1.5.47)**: `initProjectTerminal(project, projectId)` encapsulates the two-line PTY init (getOrCreate + updateBroadcast). `sendActivitySnapshot(ws)` encapsulates the dashboard initial snapshot loop. Both deduplicate code that previously appeared twice in the WS connection handler.
- **Project tags, todo board, session share (v1.5.51)**: P2 features. `tags?: string[]` added to Project type (both backend `types.ts` and frontend `types.ts`); `PATCH /:id/tags` endpoint (owner/admin only, trims+dedups). DashboardPage: tag filter chips (OR logic) using `useMemo`; ProjectCard shows up to 3 tag pills + overflow count. `GET /:id/todos` scans latest 5 sessions newest-first, finds last TodoWrite tool_use input, returns todo list (2MB file guard). `TodoPanel` polls every 5s, groups by status (进行中/待处理/已完成). RightPanel gains "任务" tab. Session share: `POST /api/sessions/:sessionId/share` generates 32-char base64url token (192-bit entropy), persists to `session-shares.json` with 7-day expiry; `GET /api/share/:token` is public (no auth). Frontend: `ShareViewPage` public read-only chat bubble view at `/share/:token`; HistoryTab share button copies URL to clipboard; `getSharedSession` handles non-JSON error responses safely.
- **P1: Session search, Git panel, mobile layout (v1.5.50)**: Global session search `GET /api/projects/sessions/search?q=` scans all accessible projects' `.ccweb/sessions/` files with permission checks, 50-result cap, 3-per-session limit. Backend `routes/git.ts` adds `simple-git`-powered status/diff/add/commit endpoints at `GET/POST /api/projects/:id/git/...`. Frontend: `GitPanel.tsx` in RightPanel's new "Git" tab shows branch, staged/modified/untracked files, per-file git add, commit UI, and diff overlay. DashboardPage adds debounced session search box in header. `ProjectPage` detects `window.innerWidth < 768` and switches to single-column + bottom Tab nav (文件/终端/面板) on mobile, restoring 3-column layout on resize.
- **Task completion notifications + terminal search (v1.5.49)**: `NotifyService` (EventEmitter) fires browser push notification via `project_stopped` WS message to all dashboardClients + optional webhook POST when Claude Code Stop hook fires (300ms delay). `GET/PUT /api/notify/config` persists config to `~/.ccweb/notify-config.json`. Frontend: `SettingsPage` adds "通知" tab with webhook URL config; `DashboardPage` wires `handleProjectStopped` to show `new Notification()`; `WebTerminal` gains `SearchAddon` (`search`/`searchNext`/`searchPrevious`/`clearSearch` via `useImperativeHandle`); new `TerminalSearch` floating overlay component (Ctrl+F, regex/case-sensitive toggles, Prev/Next navigation).
- **Security & stability hardening (v1.5.48)**: Comprehensive bug-fix release. (1) `/sessions` endpoints now enforce project ownership/share permission. (2) Broken symlinks denied in `isPathAllowed` (was silently allowed via catch). (3) Filename validation adds `*?<>|"` Windows-invalid chars. (4) UUID regex is now case-insensitive (`/i`). (5) `sound` PATCH validates config shape before writing. (6) Login rate-limiter Map pruned on 5-min interval instead of every request. (7) `activityThrottles` Map cleaned up in `stop()`/`killForUpdate()` to prevent memory leak. (8) `computeHash` in backup engine uses `createReadStream` (streaming) to avoid OOM on large files. (9) `HooksManager.readSettings()` returns `null` on JSON corruption; `install`/`uninstall`/`isInstalled` bail early to avoid overwriting user config. (10) WebSocket hooks add `connectingRef` guard to prevent multiple simultaneous connections during reconnect flapping. (11) `api.ts` 401 redirect skips when already on `/login`. (12) `triggerRead` adds `retrying` flag to prevent parallel retry chains; logs warning when all retries exhausted.

## Build & Release Workflow

```bash
# Full build (frontend + backend)
npm run build

# Release checklist:
# 1. Bump version in package.json, UpdateButton.tsx, README.md, CLAUDE.md (all 4 must match)
# 2. Update docs with new features
# 3. npm run build
# 4. git add <specific files>  ← never use git add -A (risk: committing scripts/ or token-containing docs)
# 5. git commit && git push
# 6. npm publish --registry https://registry.npmjs.org --access=public --//registry.npmjs.org/:_authToken=<token>
#    ⚠️  token must NOT appear in any git-tracked file (GitHub Push Protection blocks the push)
```

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `CCWEB_DATA_DIR` | Override data directory | `backend/../../data` (relative) |
| `CCWEB_PORT` | Preferred server port | `3001` |
| `CCWEB_ACCESS_MODE` | Network access mode (`local`/`lan`/`public`) | `local` |

## Server Deployment

```bash
# Option 1: npm package (recommended)
npm install -g @tom2012/cc-web
ccweb start --daemon

# Option 2: from source
npm run build
cd backend && npm start

# Option 3: pm2
pm2 start backend/dist/index.js --name cc-web
```

Express auto-serves `frontend/dist/` when it exists. Frontend uses relative URLs in production.
- **Remove built-in global shortcuts (v1.5.52)**: Deleted `seedPresetShortcuts()` and its call from `index.ts`. The two auto-seeded shortcuts (`[Built-in] 图关系笔记本操作规范` and `[Built-in] 小说模式`) are no longer injected on startup. Existing data must be cleaned manually by the user.
- **Dashboard card drag-and-drop ordering + project status sync fix (v1.5.55)**: (1) Project cards support HTML5 native drag-and-drop reordering. Order persisted in `localStorage` under `STORAGE_KEYS.projectOrder` (JSON array of IDs). `usePersistedState` with `{ parse: true }` manages the array. Sync effect keeps order in sync when projects are added/removed. `orderedActive` sorts `filteredActive` by stored order. Dragged card shows 40% opacity; drag target gets `ring-2 ring-blue-500/50`. (2) Fixed stale status bug: `activity_update` WS messages now include `status: getProject(id)?.status` from all three broadcast paths (activity, semantic, snapshot). Frontend `handleActivityUpdate` calls `updateProject` when status differs from store — keeps card status badges live without polling.
- **Remove ambient sound feature (v1.5.54)**: Deleted `SoundPlayer.tsx`, `SoundSelector.tsx`, `routes/sounds.ts`. Removed `SoundConfig`/`SoundPreset`/`AvailableSound` types and all 6 sound API functions from `api.ts`. Stripped `soundConfig` prop from `TerminalView`, sound state and `SoundSelector` from `ProjectHeader`, `/api/sounds` route from `index.ts`, and `SoundConfig` interface + `PATCH /:id` sound handler from `routes/projects.ts`. Also cleaned up `llmActive` state and `llmIdleTimerRef` from `TerminalView` (previously used only to trigger the sound player).
- **Input UX + Skills/Model redesign (v1.5.71)**: (1) Textarea font size bumped: bottom mode `text-sm`→`text-base`, float mode `text-base`→`text-lg`; line-height changed to `leading-6`. (2) Skills panel now shows Claude Code's actual installed skills instead of global shortcuts: `GET /api/claude/skills` (new backend endpoint in `routes/claude.ts`) returns `{ builtin, custom, mcp }` — `builtin` is a hardcoded list of 16 Claude Code slash commands (`/help`, `/clear`, `/memory`, etc.), `custom` scans `~/.claude/commands/*.md` (filename = command, first non-empty line = description), `mcp` reads `mcpServers` keys from `~/.claude/settings.json`. Frontend `ClaudeSkillsPanel` replaces `SkillsPanel`; tabs only shown when multiple sections present. `getClaudeSkills()` added to `api.ts`. Used/unused state uses command string as key (same `STORAGE_KEYS.usedSkills` array). (3) Model button changed from single-click cycle to dropdown: `activePanel: 'skills' | 'model' | null` state replaces `skillsOpen: boolean` — only one panel open at a time. Clicking model button opens `ModelPanel` (Sonnet/Opus/Haiku list with dot indicator for active); clicking a model sends `/model <name>\r` + closes panel. `ChevronDown` icon rotates 180° when panel is open.
- **Fix: dashboard status shows Stopped for running projects (v1.5.70)**: `broadcastDashboardActivity`, `broadcastDashboardSemantic`, and `sendActivitySnapshot` all called `getProject(id)?.status` which reads `projects.json` from disk on every broadcast. `saveProject()` is a non-atomic read-modify-write, so concurrent start/stop/restart operations could race and leave stale `'stopped'` status on disk while PTY was actually running. Fix: added `terminalManager.getProjectStatus(id)` which derives status from in-memory `terminals` Map (`has` → running) and `restartTimers` Map (`has` → restarting), else stopped. All three broadcast functions now use this instead of disk reads. Also fixed `sendActivitySnapshot` to include running projects with `lastActivityAt === null` (freshly started, no PTY output yet) via `getAllRunningIds()`.
- **Model switch button (v1.5.69)**: Toolbar row in `TerminalDraftInput` gains a second button (after Skills) showing the current Claude model name. Click cycles through `sonnet → opus → haiku → sonnet` by sending `/model <name>\r` to PTY via `onSend`. Initial model read from `GET /api/claude/model` (new `backend/src/routes/claude.ts`, reads `~/.claude/settings.json`, defaults to `'sonnet'`). Current selection persisted per-project in localStorage under `STORAGE_KEYS.projectModel(id)`. `displayModelName()` normalizes model strings to display names (Sonnet/Opus/Haiku). Button disabled in read-only mode. `getClaudeModel()` added to `frontend/src/lib/api.ts`. Skill command cards gain used/unused visual state: unused = `bg-blue-500/10` light blue, used = `bg-muted/30` light gray, persisted in `STORAGE_KEYS.usedSkills` (ID array in localStorage).
- **Three-state draft input Ctrl+I (v1.5.68)**: `TerminalView` replaces `showDraft: boolean` / `useState(true)` with `draftMode: 'bottom' | 'float' | 'hidden'` / `useState<DraftMode>('bottom')`. Ctrl+I cycles `bottom → float → hidden → bottom`. `TerminalDraftInput` is wrapped in `<AnimatePresence>` with `key={draftMode}` — each state transition unmounts/remounts the component so auto-focus fires on every visible state and no height state leaks. `TerminalDraftInput` gains `displayMode: 'bottom' | 'float'` prop. Root element changed from `<div>` to `<motion.div>` with `initial/animate/exit={{ opacity, y }}`. bottom mode: `absolute bottom-0 left-0 right-0 z-10 border-t border-white/10`. float mode: `fixed bottom-[20vh] z-50 w-[50vw] rounded-2xl border border-white/20 shadow-2xl overflow-hidden` with `style={{ left: '25vw' }}` (avoids CSS transform conflict with framer-motion y). float: `text-base`, `min-h-[120px] max-h-[300px]`, initialHeight 120px. bottom: `text-sm`, `min-h-[84px] max-h-[160px]`, initialHeight 84px. `adjustHeight` and `handleSend` use `maxHeight`/`initialHeight` derived from `isFloat`.
- **Non-modal floating dialogs (v1.5.67)**: All project-page dialogs converted to IDE-style floating palettes. `useProjectDialogStore` (Zustand, keyed by `projectId`) persists open state across `ProjectPage` unmount/remount — navigating away and back restores previously-open dialogs. `DialogContent` gains `noOverlay` prop (skips `<DialogOverlay />`) paired with `modal={false}` on Radix `Dialog` root to disable focus trap and overlay blocking. Pattern applied to: `FilePreviewDialog` (custom div-based, not Radix — outer backdrop goes `pointer-events-none bg-transparent` when unfocused so page is interactive), `ShortcutEditorDialog`, `ShareToHubDialog`, `SessionDialog` (in RightPanel HistoryTab). All dialogs: clicking outside → `isFocused=false` (opacity-50, page interactive); clicking dialog → `isFocused=true` (full opacity); Escape closes when focused; close button (X) is the only unmount trigger. `onFocus` capture on dialog div ensures Tab navigation refocuses.
- **Terminal skills toolbar (v1.5.66)**: `TerminalDraftInput` gains a toolbar row (`py-0.5` strip) above the input area, visible/hidden together with the input (gated by `showDraft` in `TerminalView`). Toolbar contains a "Skills" button (Sparkles icon) that opens a `SkillsPanel` sub-component with `AnimatePresence` slide-up animation (`y: 8→0`, 150ms). `SkillsPanel` fetches `getGlobalShortcuts()` lazily on first open and splits shortcuts into categories (no `parentId`) and commands (with `parentId`). Tab row selects active category; command list shows `command` (monospace, blue) + `label` (Chinese description). Clicking a command calls `onSend(command.replace(/\n/g,'\r'))` + `onSend('\r')` then closes panel. Panel closes on outside `mousedown` via `containerRef` + `useEffect` listener (active only while panel is open).
- **Fix: LAN mode task completion notification falls back to toast (v1.5.65)**: `handleProjectStopped` in DashboardPage now falls back to `toast.success()` when browser Notification API is unavailable (LAN HTTP access). Root cause: `new Notification()` requires a secure context (HTTPS or localhost). On LAN via `http://192.168.x.x:PORT`, browsers block `Notification.requestPermission()` silently — `permission` never reaches `'granted'`, so the notification was completely silent. Server-side outgoing webhook POST and Claude Code hook curl calls are unaffected (both use localhost and are server-side only).
- **Global Pomodoro timer (v1.5.64)**: Refactored `PomodoroTimer` into a global architecture. `usePomodoroStore` (Zustand) holds `running/phase/secondsLeft`. `PomodoroController` (mounted once in App.tsx) drives the countdown `useEffect`. `PomodoroOverlay` (mounted once in App.tsx, `createPortal` to body) renders the full-screen countdown on ALL pages. `PomodoroTimer` export is now just the toggle button (no longer manages state or overlay). Button added to `DashboardPage` header (next to ThemeToggle). Opacity changed: work=0.1 (10%), break=0.6 (60%).
- **Fix: image preview cache not refreshed after file change (v1.5.63)**: `FilePreviewDialog` adds `&t=Date.now()` to `getRawFileUrl()` result so each dialog open generates a unique URL, bypassing browser HTTP cache. Possible because the dialog component is unmounted on close (`{previewPath && ...}` in FileTree) — every open is a fresh mount, so `useMemo` always recomputes with the current timestamp.
- **Remove Stop button from project header (v1.5.62)**: `ProjectHeader` no longer renders a Stop button when the project is running/restarting. Only the Start button (shown when `status === 'stopped'`) remains — users can still restart a manually-stopped project. `handleStop`, `stopProject` import, and `Square` icon import all removed. `actionLoading` state is kept for the Start button's loading feedback.
- **Remove chat mode tab from project page (v1.5.61)**: Removed the 终端/对话 tab bar, `viewMode` persisted state (`STORAGE_KEYS.viewMode`), `ChatView` lazy import and AnimatePresence render block from `TerminalView`. Terminal is now always shown directly with no mode switching. Chat subscription logic (`chatMessages` state, `subscribeChatMessages`, `onChatMessage`, `subscribeChatMessagesRef`) is intentionally kept — data is still collected from JSONL via WS for future use (e.g. right panel history). `void chatMessages` suppresses unused-variable warning while signaling the data is available. Ctrl+F / Ctrl+I `keydown` handlers simplified: `viewMode` guard removed, shortcuts now always active.
- **Terminal status bar + draft input UX refinements (v1.5.60)**: (1) `UsageBadge` moved from `ProjectHeader` to a new bottom status bar inside `TerminalView` — a `h-7 flex-shrink-0` strip below the terminal/chat area with `bg-muted/30 border-t border-border`. Header no longer imports `UsageBadge`. (2) `TerminalDraftInput` key bindings swapped: plain `Enter` now inserts newline (default textarea behavior, no handler needed), `Shift+Enter` sends. (3) Added `StopCircle` interrupt button to the right of the draft input — clicking sends `\x03` (Ctrl+C) to PTY; always enabled unless read-only, styled red to distinguish from the send button.
- **Resizable panels + terminal draft input (v1.5.59)**: (1) Left/right panels are now drag-resizable. `ProjectPage` adds `leftWidth`/`rightWidth` state (persisted in `localStorage` under `STORAGE_KEYS.panelLeftWidth`/`panelRightWidth`, defaults 224/208px, clamped 150–520px). Resize handles are 4px `w-1` divs between panels and `TerminalView`; `onMouseDown` captures startX + startWidth, `mousemove`/`mouseup` on `window` update DOM directly via ref (`el.style.width`) for zero re-renders during drag, `mouseup` commits to state. framer-motion `animate={{ width: leftWidth }}` uses dynamic state so show/hide animation opens to the last-dragged width. Borders removed from `motion.div`s — the handle itself acts as the separator. (2) `TerminalDraftInput.tsx` — absolute-positioned textarea overlay at terminal bottom (`absolute bottom-0 left-0 right-0 z-10`, `bg-background/80 backdrop-blur-sm`). Multi-line: `Shift+Enter` inserts newline, `Enter` sends. Auto-height via `scrollHeight` capped at 160px. Persisted per-project in localStorage under `cc_terminal_draft_${projectId}` (`STORAGE_KEYS.terminalDraft`). Send converts `\n`→`\r` then appends `\r` for PTY execution. `Ctrl+I` / `Cmd+I` toggles show/hide (default visible). Read-only when `_sharedPermission === 'view'`.
- **Fix: stopped project opened via WS not starting with --continue (v1.5.58)**: `initProjectTerminal()` in `index.ts` called `terminalManager.getOrCreate(project, fn)` without `continueSession=true`. When a user navigated to a stopped project page, the WS connection triggered this function which spawned Claude without `--continue`, discarding conversation history. Fix: always pass `true` — safe because if a terminal already exists `getOrCreate` returns early and the flag is never consumed; brand-new projects are pre-started in `POST /api/projects` before any WS connects so their terminal already exists when the WS arrives.
- **Pomodoro timer (v1.5.57)**: `PomodoroTimer.tsx` component — toggle button in `ProjectHeader` (between `UsageBadge` and `ThemeToggle`). Click starts a fresh work countdown; click again stops and resets. Uses `setTimeout`-based countdown (re-runs each second via effect) instead of `setInterval` to avoid stale closure bugs. Phase auto-switches on zero: work → break (`休息一下 ☕`) and break → work (`该工作了 💻`) with browser `Notification`. Full-screen fixed overlay rendered via `createPortal` to `document.body` with `pointer-events: none` so it doesn't block interaction. Opacity 0.8 during work, 0.5 during break. Font size responsive via `clamp(72px, 18vw, 220px)`. Config (`workMinutes`, `breakMinutes`) persisted in `localStorage` under `STORAGE_KEYS.pomodoroConfig`; read fresh on each start so settings take effect immediately. New "番茄钟" tab in `SettingsPage` (default 30 min work / 5 min break).
- **LAN access fix — dev mode WebSocket and REST hardcoded localhost (v1.5.56)**: Fixed two `import.meta.env.DEV` branches that hardcoded `localhost:3001`, causing all WebSocket and REST connections to resolve to the client machine's localhost when accessing from LAN. (1) `lib/websocket.ts`: `WS_BASE` now always uses `window.location.host` instead of the `'ws://localhost:3001'` branch. (2) `lib/api.ts`: `BASE_URL` simplified to `''` (relative URLs) — Vite proxy handles `/api` in dev, Express handles in prod. (3) `vite.config.ts`: Added `/ws` WebSocket proxy (`ws: true`, target `ws://localhost:3001`) so dev-mode WS connections route correctly via Vite. Production (built bundle) was unaffected; this only impacted dev-mode LAN access.
- **Left/Right panel vertical tabs (v1.5.53)**: Introduced `LeftPanel.tsx` — wraps `FileTree` and `GitPanel` with a 28px vertical tab strip on the left edge (writing-mode: vertical-rl, active indicator is right-border `border-r-2 border-blue-500`). `RightPanel` removed Git tab and moved its tab strip to the right edge (active indicator is left-border `border-l-2 border-blue-500`). `ProjectPage` now imports `LeftPanel` instead of `FileTree` for both desktop and mobile layouts.
