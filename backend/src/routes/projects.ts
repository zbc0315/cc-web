import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { AuthRequest } from '../auth';
import { getProjects, saveProject, deleteProject, getProject, writeProjectConfig, readProjectConfig, getRegisteredUsers, getAdminUsername, isAdminUser, isProjectOwner, getUserWorkspace } from '../config';
import { terminalManager } from '../terminal-manager';
import { usageTerminal } from '../usage-terminal';
import { sessionManager } from '../session-manager';
import { Project, CliTool } from '../types';

const VALID_CLI_TOOLS: CliTool[] = ['claude', 'opencode', 'codex', 'qwen'];

/** Validate project ID is a UUID to prevent log injection. */
function isValidProjectId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Check if a folder path is within the user's workspace. Admin has no restriction. */
function isWithinUserWorkspace(folderPath: string, username?: string): boolean {
  if (isAdminUser(username)) return true;
  const workspace = getUserWorkspace(username);
  const resolved = path.resolve(folderPath);
  return resolved === workspace || resolved.startsWith(workspace + path.sep);
}

const router = Router();

// Validate :id param is a UUID on all /:id routes
router.param('id', (req, res, next, id: string) => {
  if (!isValidProjectId(id)) {
    res.status(400).json({ error: 'Invalid project ID' });
    return;
  }
  next();
});

/** Initialize .notebook/ directory structure in a project folder */
function initNotebook(folderPath: string): void {
  try {
    const notebookDir = path.join(folderPath, '.notebook', 'pages');
    if (!fs.existsSync(notebookDir)) {
      fs.mkdirSync(notebookDir, { recursive: true });
    }
    const graphFile = path.join(folderPath, '.notebook', 'graph.yaml');
    if (!fs.existsSync(graphFile)) {
      fs.writeFileSync(graphFile, 'pages: []\nrelations: []\n', 'utf-8');
    }
  } catch (err) {
    console.error('[Projects] Failed to init .notebook/:', err);
  }
}

// GET /api/projects
router.get('/', (req: AuthRequest, res: Response): void => {
  const username = req.user?.username;
  const result: (Project & { _sharedPermission?: 'view' | 'edit' })[] = [];
  for (const p of getProjects()) {
    if (isProjectOwner(p, username)) {
      result.push(p);
      continue;
    }
    const share = p.shares?.find((s) => s.username === username);
    if (share) {
      result.push({ ...p, _sharedPermission: share.permission });
    }
  }
  res.json(result);
});

// GET /api/projects/workspace — returns the user's workspace root path
router.get('/workspace', (req: AuthRequest, res: Response): void => {
  res.json({ workspace: getUserWorkspace(req.user?.username) });
});

// GET /api/projects/activity  →  { [projectId]: { lastActivityAt, semantic? } }
router.get('/activity', (_req: AuthRequest, res: Response): void => {
  const ptyActivity = terminalManager.getAllActivity();
  const semanticAll = sessionManager.getAllSemanticStatus();
  const now = Date.now();
  const SEMANTIC_STALE_MS = 30_000; // discard semantic status older than 30s

  const result: Record<string, { lastActivityAt: number; semantic?: { phase: string; detail?: string; updatedAt: number } }> = {};
  for (const [id, ts] of Object.entries(ptyActivity)) {
    result[id] = { lastActivityAt: ts };
    const sem = semanticAll[id];
    if (sem && now - sem.updatedAt < SEMANTIC_STALE_MS) {
      result[id].semantic = sem;
    }
  }
  res.json(result);
});

// POST /api/projects
router.post('/', (req: AuthRequest, res: Response): void => {
  const { name, folderPath, permissionMode, cliTool } = req.body as {
    name?: string; folderPath?: string; permissionMode?: 'limited' | 'unlimited'; cliTool?: CliTool;
  };

  if (!name || !folderPath || !permissionMode) {
    res.status(400).json({ error: 'name, folderPath, and permissionMode are required' });
    return;
  }

  if (permissionMode !== 'limited' && permissionMode !== 'unlimited') {
    res.status(400).json({ error: 'permissionMode must be "limited" or "unlimited"' });
    return;
  }

  if (cliTool && !VALID_CLI_TOOLS.includes(cliTool)) {
    res.status(400).json({ error: `cliTool must be one of: ${VALID_CLI_TOOLS.join(', ')}` });
    return;
  }

  if (!isWithinUserWorkspace(folderPath, req.user?.username)) {
    const workspace = getUserWorkspace(req.user?.username);
    res.status(403).json({ error: `Project folder must be within your workspace: ${workspace}` });
    return;
  }

  const project: Project = {
    id: uuidv4(),
    name,
    folderPath,
    permissionMode,
    cliTool: cliTool ?? 'claude',
    createdAt: new Date().toISOString(),
    status: 'running',
    owner: req.user?.username,
  };

  saveProject(project);

  // Write .ccweb/project.json into the project folder
  try {
    writeProjectConfig(folderPath, project);
  } catch (err) {
    console.error('[Projects] Failed to write .ccweb/project.json:', err);
  }

  initNotebook(folderPath);

  // Start terminal; broadcast is a no-op until a WS client connects
  terminalManager.getOrCreate(project);

  res.status(201).json(project);
});

// POST /api/projects/open — open an existing project from its folder (.ccweb/project.json)
router.post('/open', (req: AuthRequest, res: Response): void => {
  const { folderPath } = req.body as { folderPath?: string };

  if (!folderPath) {
    res.status(400).json({ error: 'folderPath is required' });
    return;
  }

  if (!isWithinUserWorkspace(folderPath, req.user?.username)) {
    const workspace = getUserWorkspace(req.user?.username);
    res.status(403).json({ error: `Project folder must be within your workspace: ${workspace}` });
    return;
  }

  if (!fs.existsSync(folderPath)) {
    res.status(400).json({ error: 'Folder does not exist' });
    return;
  }

  const config = readProjectConfig(folderPath);
  if (!config) {
    res.status(400).json({ error: 'No .ccweb/project.json found in this folder. This folder has not been used as a CC Web project before.' });
    return;
  }

  // Check if this project is already registered
  const existing = getProjects().find((p) => p.folderPath === folderPath);
  if (existing) {
    res.status(409).json({ error: 'This project is already open', project: existing });
    return;
  }

  const project: Project = {
    id: config.id,
    name: config.name,
    folderPath,
    permissionMode: config.permissionMode,
    cliTool: config.cliTool ?? 'claude',
    createdAt: config.createdAt,
    status: 'running',
    owner: req.user?.username,
  };

  saveProject(project);

  initNotebook(folderPath);

  // Start terminal with --continue to restore previous conversation history
  terminalManager.getOrCreate(project, () => {}, true);

  res.status(200).json(project);
});

// DELETE /api/projects/:id
router.delete('/:id', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  terminalManager.stop(id);
  deleteProject(id);

  res.json({ success: true });
});

// PATCH /api/projects/:id/stop
router.patch('/:id/stop', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  terminalManager.stop(id);
  // terminalManager.stop() already sets status='stopped' and saves

  // Re-read the project to return fresh state
  res.json(getProject(id) ?? project);
});

// PATCH /api/projects/:id/start
router.patch('/:id/start', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  project.status = 'running';
  saveProject(project);

  terminalManager.getOrCreate(project, () => {}, true);

  res.json(project);
});

// PATCH /api/projects/:id/archive
router.patch('/:id/archive', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  // Stop terminal before archiving
  terminalManager.stop(id);

  project.archived = true;
  project.status = 'stopped';
  saveProject(project);

  res.json(getProject(id) ?? project);
});

// PATCH /api/projects/:id/unarchive
router.patch('/:id/unarchive', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  project.archived = false;
  saveProject(project);

  res.json(getProject(id) ?? project);
});


// GET /api/projects/:id/sessions
router.get('/:id/sessions', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const username = req.user?.username;
  if (!isProjectOwner(project, username) && !project.shares?.some((s) => s.username === username)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  res.json(sessionManager.listSessions(id));
});

// GET /api/projects/:id/sessions/:sessionId
router.get('/:id/sessions/:sessionId', (req: AuthRequest, res: Response): void => {
  const { id, sessionId } = req.params;
  const project = getProject(id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const username = req.user?.username;
  if (!isProjectOwner(project, username) && !project.shares?.some((s) => s.username === username)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  const session = sessionManager.getSession(id, sessionId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  res.json(session);
});

// GET /api/projects/usage  →  Claude Code usage via OAuth API
// Pass ?refresh=true to bust the cache (e.g. after plan upgrade)
router.get('/usage', (req: AuthRequest, res: Response): void => {
  if (req.query['refresh'] === 'true') usageTerminal.clearUsageCache();
  usageTerminal.queryUsage()
    .then((data) => res.json(data))
    .catch(() => res.json(null));
});

// ── Sharing ──────────────────────────────────────────────────────────────────

// GET /api/projects/users — list all usernames (for share picker)
router.get('/users', (_req: AuthRequest, res: Response): void => {
  const names: string[] = [];
  const admin = getAdminUsername();
  if (admin) names.push(admin);
  for (const u of getRegisteredUsers()) {
    if (!names.includes(u.username)) names.push(u.username);
  }
  res.json(names);
});

// PUT /api/projects/:id/shares — set shares (owner only)
router.put('/:id/shares', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  // Only owner (or admin for legacy projects) can manage shares
  const username = req.user?.username;
  if (!isProjectOwner(project, username)) {
    res.status(403).json({ error: 'Only the project owner can manage sharing' });
    return;
  }

  const { shares } = req.body as { shares?: { username: string; permission: 'view' | 'edit' }[] };
  if (!Array.isArray(shares)) {
    res.status(400).json({ error: 'shares must be an array' });
    return;
  }

  // Validate
  for (const s of shares) {
    if (!s.username || !['view', 'edit'].includes(s.permission)) {
      res.status(400).json({ error: 'Each share must have username and permission (view/edit)' });
      return;
    }
    if (s.username === (project.owner || getAdminUsername())) {
      res.status(400).json({ error: 'Cannot share with the project owner' });
      return;
    }
  }

  project.shares = shares;
  saveProject(project);
  res.json(project);
});

// GET /api/projects/sessions/search?q=<keyword>
// Returns matching message snippets across all projects the caller can access
router.get('/sessions/search', async (req: AuthRequest, res: Response): Promise<void> => {
  const rawQ = req.query.q;
  const q = (typeof rawQ === 'string' ? rawQ : undefined)?.trim();
  if (!q || q.length < 2) {
    res.json([]);
    return;
  }

  const projects = getProjects();
  const lowerQ = q.toLowerCase();

  interface SearchResult {
    projectId: string;
    projectName: string;
    sessionId: string;
    startedAt: string;
    snippet: string;
    role: 'user' | 'assistant';
  }

  const results: SearchResult[] = [];

  for (const project of projects) {
    // Permission check: owner or shares member
    if (!isProjectOwner(project, req.user?.username) &&
        !project.shares?.some((s) => s.username === req.user?.username)) {
      // Admin can see all
      if (!isAdminUser(req.user?.username)) continue;
    }

    const sessionDir = path.join(project.folderPath, '.ccweb', 'sessions');
    if (!fs.existsSync(sessionDir)) continue;

    let files: string[];
    try {
      files = fs.readdirSync(sessionDir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }

    for (const file of files) {
      try {
        if (fs.statSync(path.join(sessionDir, file)).size > 2 * 1024 * 1024) continue;
        const raw = fs.readFileSync(path.join(sessionDir, file), 'utf-8');
        const session = JSON.parse(raw) as {
          id: string;
          startedAt: string;
          messages: Array<{ role: 'user' | 'assistant'; content: string | Array<{ type?: string; text?: string }>; timestamp: string }>;
        };

        if (!session.id) continue;

        let sessionSnippets = 0;
        for (const msg of session.messages ?? []) {
          const contentStr = typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
              ? (msg.content as Array<{ type?: string; text?: string }>)
                  .filter((b) => b.type === 'text' && b.text)
                  .map((b) => b.text!)
                  .join(' ')
              : '';
          if (!contentStr.toLowerCase().includes(lowerQ)) continue;

          // Extract snippet: up to 120 chars around the first match
          const idx = contentStr.toLowerCase().indexOf(lowerQ);
          const start = Math.max(0, idx - 40);
          const end = Math.min(contentStr.length, idx + 80);
          const snippet = (start > 0 ? '…' : '') + contentStr.slice(start, end) + (end < contentStr.length ? '…' : '');

          results.push({
            projectId: project.id,
            projectName: project.name,
            sessionId: session.id,
            startedAt: session.startedAt,
            snippet,
            role: msg.role,
          });

          // At most 50 results total
          if (results.length >= 50) break;

          // At most 3 snippets per session
          sessionSnippets++;
          if (sessionSnippets >= 3) break;
        }

        // At most 50 results total
        if (results.length >= 50) break;
      } catch {
        // skip corrupt session files
      }
    }

    if (results.length >= 50) break;
  }

  res.json(results);
});

// PATCH /api/projects/:id/tags   body: { tags: string[] }
router.patch('/:id/tags', (req: AuthRequest, res: Response): void => {
  const projects = getProjects();
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  if (!isProjectOwner(project, req.user?.username) && !isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const { tags } = req.body as { tags?: unknown };
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) {
    res.status(400).json({ error: 'tags must be string[]' }); return;
  }

  // Deduplicate and trim
  project.tags = [...new Set((tags as string[]).map((t) => t.trim()).filter(Boolean))];
  saveProject(project);
  res.json(project);
});

// GET /api/projects/:id/todos
// Reads the most recent session JSON and returns the latest TodoWrite tool_use input.todos
router.get('/:id/todos', (req: AuthRequest, res: Response): void => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  if (!isProjectOwner(project, req.user?.username) &&
      !project.shares?.some((s) => s.username === req.user?.username) &&
      !isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  interface TodoItem {
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority?: 'low' | 'medium' | 'high';
  }

  // Find session files, newest first (files are timestamp-prefixed)
  const sessionDir = path.join(project.folderPath, '.ccweb', 'sessions');
  if (!fs.existsSync(sessionDir)) { res.json([]); return; }

  let files: string[];
  try {
    files = fs.readdirSync(sessionDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
  } catch {
    res.json([]); return;
  }

  // Search last 5 sessions for most recent TodoWrite
  for (const file of files.slice(0, 5)) {
    try {
      if (fs.statSync(path.join(sessionDir, file)).size > 2 * 1024 * 1024) continue;
      const raw = fs.readFileSync(path.join(sessionDir, file), 'utf-8');
      const session = JSON.parse(raw) as {
        messages: Array<{
          role: string;
          blocks?: Array<{ type: string; name?: string; input?: { todos?: TodoItem[] } }>;
        }>;
      };

      const messages = session.messages ?? [];
      // Walk messages in reverse to find latest TodoWrite
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'assistant' || !Array.isArray(msg.blocks)) continue;
        for (const block of msg.blocks) {
          if (block.type === 'tool_use' && block.name === 'TodoWrite' && Array.isArray(block.input?.todos)) {
            res.json(block.input.todos);
            return;
          }
        }
      }
    } catch {
      // skip corrupt session
    }
  }

  res.json([]);
});

export default router;
