# CC Web

A self-hosted web application (distributed as npm package) that provides a browser-based interface for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI sessions. Create projects, each with a persistent terminal running Claude Code, and interact with them through a real-time terminal UI.

**Current version**: v1.5.32 | [GitHub](https://github.com/zbc0315/cc-web) | MIT License

## Features

- **Project Management**: Create, open, start, stop, and delete projects from a dashboard
- **Real-time Terminal**: Full xterm.js terminal in the browser, connected to Claude Code via WebSocket
- **Persistent Sessions**: Conversation history stored in each project's `.ccweb/` folder — survives uninstall/reinstall (max 20 sessions per project, auto-pruned)
- **Permission Modes**: Run Claude in limited mode (asks before acting) or unlimited mode (`--dangerously-skip-permissions`)
- **Shortcuts Panel**: Define reusable prompt commands at project or global level with inheritance
- **Session History**: Browse past conversations with full message history
- **Graph Visualization**: Topology graph from `.notebook/graph.yaml` with zoom/pan (layered DAG layout)
- **File Browser**: Browse directories and preview/edit files with zoom-level memory per file
- **Auto-restart**: Terminals automatically recover from crashes
- **Usage Tracking**: Monitor Claude Code plan usage directly from the dashboard
- **CLI Update**: `ccweb update` stops the server and updates to the latest npm version
- **Localhost Auto-auth**: Local access skips login entirely; JWT only required for remote access
- **Auto Port Switching**: Backend tries ports 3001–3020 and reports the actual port
- **Network Access Modes**: Local only (127.0.0.1), LAN (private IPs), or public — selectable at startup
- **Cloud Backup**: Incremental backup to Google Drive, OneDrive, or Dropbox (multi-provider parallel upload, scheduled or manual)
- **SkillHub**: Browse, search, and download community-shared shortcut commands from GitHub; share your own with one click
- **Ambient Sound**: Background sounds (singing bowl, rain, wind, stream, etc.) that play when LLM is active, with custom upload support
- **Dark/Light Theme**: Toggle between themes

## Prerequisites

- **Node.js** >= 18
- **Claude Code CLI** installed and authenticated (`claude` command available in PATH)

## Quick Start — npm / npx

The fastest way to get running:

```bash
# Try without installing (one-time)
npx @tom2012/cc-web

# Or install globally
npm install -g @tom2012/cc-web
ccweb
```

On first launch you'll be prompted to set a username and password. The server auto-selects an available port (starting from 3001) and opens your browser automatically.

### CLI Commands

```bash
ccweb                      # start (interactive prompts)
ccweb start --daemon       # start in background, no prompts
ccweb start --foreground   # start in foreground, no prompts
ccweb start --local        # local only (default, most secure)
ccweb start --lan          # allow LAN access
ccweb start --public       # allow public access
ccweb stop                 # stop background server
ccweb status               # show PID, port, data location
ccweb open                 # open browser to running server
ccweb setup                # reconfigure admin username / password
ccweb register             # register a new user (interactive)
ccweb update               # stop server & update to latest version
ccweb enable-autostart     # start automatically on login
ccweb disable-autostart    # remove auto-start
ccweb logs                 # tail background log file
```

All user data (credentials, projects, sessions) is stored in `~/.ccweb/` and survives package updates.

**Auto-start on login**: `ccweb enable-autostart` registers a launchd agent (macOS) or systemd user service (Linux) so the server starts automatically when you log in.

## Quick Start — from source (development)

```bash
# 1. Clone the repository
git clone https://github.com/zbc0315/cc-web.git
cd cc-web

# 2. Install dependencies
npm run install:all

# 3. First-time setup (creates login credentials)
npm run setup

# 4. Start backend (Terminal 1)
npm run dev:backend

# 5. Start frontend (Terminal 2)
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
| `index.ts` | Express + WS server, route mounting, static frontend serving, auto port switching, project config migration |
| `auth.ts` | JWT middleware, localhost auto-auth (`isLocalRequest`), `generateLocalToken()` |
| `config.ts` | File-based JSON store, `.ccweb/` per-project config helpers |
| `terminal-manager.ts` | PTY lifecycle (`$SHELL -ilc "claude"`), scrollback buffer (5 MB), auto-restart, activity tracking |
| `session-manager.ts` | Tails Claude's JSONL files, stores sessions in `.ccweb/sessions/`, prunes to latest 20 per project |
| `usage-terminal.ts` | Claude Code OAuth usage stats |
| `routes/auth.ts` | `POST /login`, `GET /local-token` (localhost only) |
| `routes/projects.ts` | CRUD + start/stop + `POST /open` (restore from `.ccweb/`) |
| `routes/update.ts` | `GET /check-running`, `POST /prepare` (save memory → wait idle → stop all, used by in-app update flow) |
| `routes/filesystem.ts` | Directory browser, file read/write |
| `routes/shortcuts.ts` | Global shortcut CRUD with inheritance |
| `routes/backup.ts` | Cloud backup API (providers, OAuth, backup trigger, schedule) |
| `routes/sounds.ts` | Sound file API: presets, download, upload, streaming |
| `routes/skillhub.ts` | SkillHub API: fetch skills index, submit via GitHub Issue, download to global shortcuts |
| `backup/` | CloudProvider implementations (Google Drive, OneDrive, Dropbox), engine, scheduler |

### Frontend (`frontend/src/`)

| File/Dir | Purpose |
|----------|---------|
| `App.tsx` | Router with auto-auth `PrivateRoute` (local token for localhost) |
| `pages/LoginPage.tsx` | Login form, auto-login on localhost |
| `pages/DashboardPage.tsx` | Project grid, new/open project, fullscreen toggle, update button |
| `pages/ProjectPage.tsx` | Three-panel layout: FileTree \| WebTerminal \| RightPanel |
| `pages/SettingsPage.tsx` | Settings: cloud accounts, backup strategy, backup history |
| `components/SoundPlayer.tsx` | Audio playback engine (fade in/out, loop/interval modes) |
| `components/SoundSelector.tsx` | Sound selection and configuration UI popover |
| `components/WebTerminal.tsx` | xterm.js terminal with fit addon |
| `components/RightPanel.tsx` | Three tabs: Shortcuts / History / Graph |
| `components/ShortcutPanel.tsx` | Project + global shortcuts, dialog editor for add/edit |
| `components/GraphPreview.tsx` | SVG topology graph of `.notebook/graph.yaml` (layered DAG, zoom/pan) |
| `components/FileTree.tsx` | Expandable directory tree |
| `components/FilePreviewDialog.tsx` | File viewer with plain/rendered/edit modes, zoom memory per file |
| `components/UpdateButton.tsx` | Version display and update check |
| `pages/SkillHubPage.tsx` | SkillHub browse, search, tag filter, download page |
| `components/OpenProjectDialog.tsx` | Open existing project from `.ccweb/` folder |
| `components/NewProjectDialog.tsx` | 3-step wizard: name → folder → permissions |
| `lib/api.ts` | Typed REST client, dynamic base URL (relative in prod, localhost:3001 in dev) |
| `lib/websocket.ts` | `useProjectWebSocket` hook, dynamic WS URL |
| `components/ui/` | shadcn/ui components (zinc theme) |

### Data Storage

**Application data** (`~/.ccweb/` for npm install, `data/` for dev):

```
data/
├── config.json              ← credentials & JWT secret
├── projects.json            ← registered project list
└── global-shortcuts.json    ← shared shortcut commands
```

**Per-project data** (inside each project folder, portable):

```
your-project/
├── .ccweb/
│   ├── project.json         ← project metadata (id, name, mode, created)
│   └── sessions/            ← conversation history (max 20, auto-pruned)
│       └── {timestamp}-{uuid}.json
└── .notebook/               ← structured notes
    ├── pages/
    └── graph.yaml
```

The `.ccweb/` folder travels with the project. If you reinstall CC Web later, use **Open Project** to point at the folder and all history is restored.

## WebSocket Protocol

**Client → Server:**

| Type | Payload | Purpose |
|------|---------|---------|
| `auth` | `{ token }` | Authenticate (skipped for localhost) |
| `terminal_subscribe` | `{ cols, rows }` | Subscribe + replay scrollback |
| `terminal_input` | `{ data }` | Keystrokes to PTY |
| `terminal_resize` | `{ cols, rows }` | Resize PTY |

**Server → Client:**

| Type | Payload | Purpose |
|------|---------|---------|
| `connected` | `{ projectId }` | Ready |
| `status` | `{ status }` | running/stopped/restarting |
| `terminal_data` | `{ data }` | PTY output |
| `terminal_subscribed` | `{}` | Subscription confirmed |
| `error` | `{ message }` | Error |

Localhost WebSocket connections are pre-authenticated — no `auth` message needed.

## REST API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/auth/login` | Login, returns JWT |
| `GET` | `/api/auth/local-token` | Get local token (localhost only) |
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create new project |
| `POST` | `/api/projects/open` | Open existing project by folder path |
| `DELETE` | `/api/projects/:id` | Delete project |
| `PATCH` | `/api/projects/:id/start` | Start project terminal |
| `PATCH` | `/api/projects/:id/stop` | Stop project terminal |
| `GET` | `/api/projects/:id/sessions` | List sessions |
| `GET` | `/api/projects/:id/sessions/:sid` | Get session with messages |
| `GET` | `/api/projects/activity` | Terminal activity timestamps |
| `GET` | `/api/projects/usage` | Claude Code usage stats |
| `GET/POST/PUT/DELETE` | `/api/shortcuts` | Global shortcut CRUD |
| `GET` | `/api/filesystem` | Browse directories |
| `POST` | `/api/filesystem/mkdir` | Create folder |
| `GET/PUT` | `/api/filesystem/file` | Read/write files |
| `GET` | `/api/update/check-running` | Check if processes are running |
| `POST` | `/api/update/prepare` | Save memory, wait idle, stop all |
| `GET/POST/DELETE` | `/api/backup/providers` | Cloud backup provider CRUD |
| `GET` | `/api/backup/auth/:id/url` | Get OAuth2 authorization URL |
| `GET` | `/api/backup/auth/callback` | OAuth2 redirect callback |
| `POST` | `/api/backup/run/:projectId` | Trigger manual backup |
| `GET/PUT` | `/api/backup/schedule` | Backup schedule config |
| `GET/PUT` | `/api/backup/excludes` | Exclude patterns |
| `GET` | `/api/backup/history` | Backup history |
| `GET` | `/api/skillhub/skills` | Fetch SkillHub index (cached 5 min) |
| `POST` | `/api/skillhub/submit` | Submit skill via GitHub Issue |
| `POST` | `/api/skillhub/download/:id` | Download skill as global shortcut |

## Server Deployment

```bash
# Build everything
npm run build

# Run backend (serves built frontend statically)
cd backend
npm start

# Or use pm2
pm2 start backend/dist/index.js --name cc-web
pm2 save
pm2 startup
```

Environment variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `CCWEB_DATA_DIR` | Override data directory | `data/` relative to backend |
| `CCWEB_PORT` | Preferred server port | `3001` |
| `CCWEB_ACCESS_MODE` | Network access mode (`local`/`lan`/`public`) | `local` |

## Build & Release

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

## Development Guide

### Project Structure

```
cc-web/
├── package.json         ← Root scripts + npm package config
├── bin/ccweb.js         ← CLI entry point (ccweb command)
├── setup.js             ← Interactive credential setup
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/             ← TypeScript source
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/             ← React + TypeScript source
```

### Key Design Decisions

- **PTY-first**: Spawns the real `claude` CLI via `node-pty` using the user's `$SHELL -ilc`. All Claude Code features (slash commands, MCP, hooks, etc.) work natively.
- **No database**: Pure JSON files, in-memory CRUD. Simple to understand, back up, and debug.
- **Per-project `.ccweb/`**: Data travels with the project folder, survives app reinstall.
- **Session tailing**: Reads Claude Code's native JSONL (`~/.claude/projects/`) rather than parsing PTY output.
- **Scrollback buffer**: 5 MB per terminal for client reconnect replay.
- **Session pruning**: Keeps latest 20 sessions per project, deletes oldest on new session start.
- **Zoom memory**: `FilePreviewDialog` persists zoom level per file path in `localStorage`.
- **Auto port switching**: Backend tries ports 3001–3020, reports actual port via IPC.
- **Localhost auto-auth**: Local requests skip JWT verification entirely.

### Adding a New API Endpoint

1. Add the route handler in `backend/src/routes/*.ts`
2. Auth is already applied — routes are mounted under `authMiddleware`
3. Add the typed call in `frontend/src/lib/api.ts`
4. Call it from your component

### Adding a New Frontend Page

1. Create `frontend/src/pages/YourPage.tsx`
2. Add a route in `frontend/src/App.tsx`
3. Use existing UI components from `frontend/src/components/ui/`

### Tech Stack

**Backend**: Node.js, Express, WebSocket (ws), node-pty, TypeScript
**Frontend**: React 18, Vite, Tailwind CSS, shadcn/ui, xterm.js, TypeScript
**Auth**: JWT (bcryptjs for password hashing)

## License

MIT
