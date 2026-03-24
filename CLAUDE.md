# CC Web — Development Guide

## Overview

CC Web is a self-hosted web application (distributed as npm package) that lets users create "projects". Each project opens a persistent terminal session running `claude` CLI, with a real-time terminal UI forwarding I/O between the browser and the PTY via WebSocket.

**Current version**: v1.5.39
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

**Server → Client:**
| Type | Payload | Purpose |
|------|---------|---------|
| `connected` | `{ projectId, readOnly? }` | Ready (readOnly=true for view-only shared) |
| `status` | `{ status }` | running/stopped/restarting |
| `terminal_data` | `{ data }` | PTY output |
| `terminal_subscribed` | `{}` | Subscription confirmed |
| `chat_message` | `{ role, timestamp, blocks[] }` | Parsed JSONL message for chat view |
| `error` | `{ message }` | Error |

Localhost WebSocket connections are pre-authenticated — no `auth` message needed.

## Key Design Decisions

- **PTY-first**: Spawns real `claude` CLI via `node-pty` using user's `$SHELL -ilc`. All Claude Code features work natively.
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

## Build & Release Workflow

```bash
# Full build (frontend + backend)
npm run build

# Release checklist:
# 1. Bump version in package.json, UpdateButton.tsx, README.md, CLAUDE.md
# 2. Update docs with new features
# 3. npm run build
# 4. git add -A && git commit && git push
# 5. npm publish --registry https://registry.npmjs.org --access=public
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
