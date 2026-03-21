# CC Web

A self-hosted web application that provides a browser-based interface for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI sessions. Create projects, each with a persistent terminal running Claude Code, and interact with them through a real-time chat/terminal UI.

## Features

- **Project Management**: Create, open, start, stop, and delete projects from a dashboard
- **Real-time Terminal**: Full xterm.js terminal in the browser, connected to Claude Code via WebSocket
- **Persistent Sessions**: Conversation history stored locally in each project's `.ccweb/` folder — survives uninstall/reinstall
- **Permission Modes**: Run Claude in limited mode (asks before acting) or unlimited mode (`--dangerously-skip-permissions`)
- **Global Shortcuts**: Define reusable prompt commands with inheritance
- **File Browser**: Browse and select project folders from the browser
- **Auto-restart**: Terminals automatically recover from crashes
- **Usage Tracking**: Monitor Claude Code plan usage directly from the dashboard
- **Dark/Light Theme**: Toggle between themes

## Prerequisites

- **Node.js** >= 18
- **Claude Code CLI** installed and authenticated (`claude` command available in PATH)

## Quick Start

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
Browser (React/Vite :5173)
    |
    |-- REST API -----------> Express (:3001)
    |                             |
    +-- WebSocket ----------> ws server (:3001)
                                  |
                             TerminalManager
                                  |
                             node-pty (PTY)
                                  |
                             claude CLI
```

### Backend (`backend/src/`)

| File | Purpose |
|------|---------|
| `index.ts` | Express + WebSocket server, route mounting |
| `auth.ts` | JWT verification middleware |
| `config.ts` | File-based data store (JSON) |
| `terminal-manager.ts` | PTY lifecycle, I/O handling, auto-restart |
| `session-manager.ts` | Conversation history tracking |
| `routes/auth.ts` | `POST /api/auth/login` |
| `routes/projects.ts` | Project CRUD + start/stop/open |
| `routes/filesystem.ts` | Directory browser for folder selection |
| `routes/shortcuts.ts` | Global shortcut commands CRUD |

### Frontend (`frontend/src/`)

| File/Dir | Purpose |
|----------|---------|
| `pages/DashboardPage.tsx` | Project grid, new/open project |
| `pages/ProjectPage.tsx` | Full-screen terminal + panels |
| `components/WebTerminal.tsx` | xterm.js terminal wrapper |
| `components/NewProjectDialog.tsx` | 3-step new project wizard |
| `components/OpenProjectDialog.tsx` | Open existing project by folder |
| `components/FileBrowser.tsx` | Filesystem navigator |
| `lib/api.ts` | Typed REST API client |
| `lib/websocket.ts` | WebSocket hook with auto-reconnect |
| `components/ui/` | shadcn/ui components (zinc theme) |

### Data Storage

**Application data** (`data/` — gitignored, created at runtime):

```
data/
├── config.json          <- Login credentials & JWT secret
├── projects.json        <- Registered project list
└── global-shortcuts.json <- Shared shortcut commands
```

**Per-project data** (inside each project folder):

```
your-project/
├── .ccweb/
│   ├── project.json     <- Project metadata (id, name, mode, created)
│   └── sessions/        <- Conversation history
│       └── {sessionId}.json
└── .notebook/           <- Structured notes (pages + graph)
    ├── pages/
    └── graph.yaml
```

The `.ccweb/` folder travels with the project. If you uninstall CC Web and reinstall later, just use **Open Project** to point at the folder and all history is restored.

## WebSocket Protocol

**Client -> Server:**

| Type | Payload | Purpose |
|------|---------|---------|
| `auth` | `{ token }` | Authenticate (must be first message) |
| `terminal_subscribe` | `{ cols, rows }` | Subscribe to PTY output + replay scrollback |
| `terminal_input` | `{ data }` | Send keystrokes to PTY |
| `terminal_resize` | `{ cols, rows }` | Resize PTY dimensions |

**Server -> Client:**

| Type | Payload | Purpose |
|------|---------|---------|
| `connected` | `{ projectId }` | Connection established |
| `status` | `{ status }` | Project status update |
| `terminal_data` | `{ data }` | PTY output (scrollback or live) |
| `terminal_subscribed` | `{}` | Subscription confirmed |
| `error` | `{ message }` | Error notification |

## REST API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/auth/login` | Login, returns JWT |
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

## macOS Desktop App (DMG)

CC Web can be packaged as a standalone macOS app using Electron.

```bash
# Prerequisites: install all dependencies first
npm run install:all
npm install

# Build DMG (outputs to release/)
npm run dist:dmg
```

The DMG will be at `release/CC Web-{version}-arm64.dmg`. Double-click to install.

On first launch, the app auto-generates login credentials and displays them in a dialog. You'll need `claude` CLI installed and authenticated on your machine.

### Building for other architectures

Edit the `arch` field in `package.json` under `build.mac.target`:
- `["arm64"]` — Apple Silicon (default)
- `["x64"]` — Intel Mac
- `["arm64", "x64"]` — Universal

## Server Deployment (without Electron)

```bash
# Build everything
npm run build

# Run backend (serves built frontend statically)
cd backend
npm start

# Or use pm2 for process management
pm2 start backend/dist/index.js --name cc-web
pm2 save
pm2 startup
```

The Express server serves the built frontend at `/` when `frontend/dist/` exists.

Environment variables:
- `CCWEB_DATA_DIR` — Override data directory path (default: `data/` relative to backend)
- `CCWEB_PORT` — Override server port (default: `3001`)

## Development Guide

### Project Structure

```
cc-web/
├── package.json         <- Root scripts + Electron build config
├── setup.js             <- Interactive credential setup
├── electron/
│   ├── main.ts          <- Electron main process
│   └── tsconfig.json
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/             <- TypeScript source
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/             <- React + TypeScript source
```

### Key Design Decisions

- **PTY-first**: Spawns the real `claude` CLI binary via `node-pty`, not a custom API integration. This means any Claude Code feature (slash commands, MCP, hooks, etc.) works automatically.
- **File-based storage**: No database — all state is JSON files. Simple to understand, back up, and debug.
- **Per-project `.ccweb/`**: Project data lives in the project folder so it's portable and survives reinstalls.
- **Scrollback buffer**: Up to 5 MB of raw PTY output is kept in memory per project for client reconnects.
- **Session tailing**: Reads Claude Code's native JSONL files (`~/.claude/projects/`) rather than parsing PTY output.
- **strip-ansi v6**: Uses the CommonJS version (v6) because later versions are ESM-only.

### Adding a New API Endpoint

1. Add the route handler in the appropriate `backend/src/routes/*.ts` file
2. If it needs auth, it's already protected (routes are mounted under `authMiddleware`)
3. Add the typed API call in `frontend/src/lib/api.ts`
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
