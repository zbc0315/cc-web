import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { AuthRequest } from '../auth';
import { getProjects, saveProject, deleteProject, getProject, writeProjectConfig, readProjectConfig, getRegisteredUsers, getAdminUsername, isAdminUser, isProjectOwner, getUserWorkspace } from '../config';
import { terminalManager } from '../terminal-manager';
import { sessionManager } from '../session-manager';
import { getAdapter } from '../adapters';
import { Project, CliTool } from '../types';

const VALID_CLI_TOOLS: CliTool[] = ['claude', 'opencode', 'codex', 'qwen', 'gemini', 'terminal'];

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

  // Prevent duplicate registration of the same folder (two projects pointing at the
  // same directory creates ambiguity for hook resolution, chat-history discovery,
  // and .ccweb/project.json overwrites). Use realpath where possible so two
  // symlink-aliased paths also collide.
  const canonicalize = (p: string): string => {
    const resolved = path.resolve(p);
    try { return fs.realpathSync(resolved); } catch { return resolved; }
  };
  const resolved = canonicalize(folderPath);
  const duplicate = getProjects().find((p) => canonicalize(p.folderPath) === resolved);
  if (duplicate) {
    res.status(409).json({
      error: 'A project already exists for this folder',
      existingProjectId: duplicate.id,
    });
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
  if (!isProjectOwner(project, req.user?.username) && !isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Forbidden' }); return;
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
  if (!isProjectOwner(project, req.user?.username) && !isAdminUser(req.user?.username)) {
    const share = project.shares?.find(s => s.username === req.user?.username && s.permission === 'edit');
    if (!share) { res.status(403).json({ error: 'Forbidden' }); return; }
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
  if (!isProjectOwner(project, req.user?.username) && !isAdminUser(req.user?.username)) {
    const share = project.shares?.find(s => s.username === req.user?.username && s.permission === 'edit');
    if (!share) { res.status(403).json({ error: 'Forbidden' }); return; }
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
  if (!isProjectOwner(project, req.user?.username) && !isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

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
  if (!isProjectOwner(project, req.user?.username) && !isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  project.archived = false;
  saveProject(project);

  res.json(getProject(id) ?? project);
});

// GET /api/projects/usage  →  CLI tool usage via adapter
// Pass ?tool=claude|codex|... and ?refresh=true to bust the cache
router.get('/usage', (req: AuthRequest, res: Response): void => {
  const tool = (req.query['tool'] as string) || 'claude';
  const adapter = getAdapter(VALID_CLI_TOOLS.includes(tool as CliTool) ? (tool as CliTool) : 'claude');
  if (req.query['refresh'] === 'true') adapter.clearUsageCache();
  adapter.queryUsage()
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

  if (shares.length > 50) {
    res.status(400).json({ error: 'Maximum 50 shares per project' }); return;
  }
  project.shares = shares;
  saveProject(project);
  res.json(project);
});

// PATCH /api/projects/:id/rename   body: { name: string }
router.patch('/:id/rename', (req: AuthRequest, res: Response): void => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  if (!isProjectOwner(project, req.user?.username) && !isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const { name } = req.body as { name?: unknown };
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name must be a non-empty string' }); return;
  }
  if (name.trim().length > 255) {
    res.status(400).json({ error: 'name must be 255 characters or fewer' }); return;
  }

  project.name = name.trim();
  saveProject(project);
  // Also update .ccweb/project.json inside the project folder
  try { writeProjectConfig(project.folderPath, project); } catch { /* non-critical */ }

  res.json(project);
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

// GET /api/projects/:id/disk-size — folder size in bytes (async, uses du)
router.get('/:id/disk-size', (req: AuthRequest, res: Response): void => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  if (!isProjectOwner(project, req.user?.username) &&
      !project.shares?.some((s) => s.username === req.user?.username) &&
      !isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const { execFile } = require('child_process');
  execFile('du', ['-sk', project.folderPath], { timeout: 10000 }, (err: Error | null, stdout: string) => {
    if (err) { res.status(500).json({ error: 'Failed to calculate size' }); return; }
    const kb = parseInt(stdout.split('\t')[0], 10);
    if (isNaN(kb)) { res.status(500).json({ error: 'Failed to parse size' }); return; }
    res.json({ bytes: kb * 1024 });
  });
});

// GET /api/projects/:id/chat-history?limit=N&before=<blockId>
//   returns { blocks: ChatBlock[], hasMore: boolean }
//   - no `before`: return the latest `limit` blocks (chronological order)
//   - with `before`: return up to `limit` blocks strictly before that id
//   Intended for the unified chat UI (useChatHistory). Reads directly from
//   the CLI's JSONL file via sessionManager.getChatHistory.
router.get('/:id/chat-history', (req: AuthRequest, res: Response): void => {
  const project = getProject(req.params.id);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  if (!isProjectOwner(project, req.user?.username) &&
      !project.shares?.some((s) => s.username === req.user?.username) &&
      !isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 20, 200);
  const before = typeof req.query.before === 'string' ? req.query.before : undefined;

  const all = sessionManager.getChatHistory(req.params.id);
  // Trim to the slice the client asked for
  let endExclusive = all.length;
  if (before) {
    const idx = all.findIndex((b) => b.id === before);
    if (idx === -1) {
      // Cursor stale (JSONL file switched?) — return nothing; client will refetch from head
      res.json({ blocks: [], hasMore: false });
      return;
    }
    endExclusive = idx;
  }
  const startInclusive = Math.max(0, endExclusive - limit);
  const blocks = all.slice(startInclusive, endExclusive);
  res.json({ blocks, hasMore: startInclusive > 0 });
});

export default router;
